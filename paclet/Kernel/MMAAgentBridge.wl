BeginPackage["MMAAgentBridge`"];

StartMMAAgentPalette::usage = "StartMMAAgentPalette[] opens the MMA Agent Bridge palette.";
StartMMAAgentHiddenAgent::usage = "StartMMAAgentHiddenAgent[] starts the hidden Wolfram agent loop.";
StartMMAAgentControlKernel::usage = "StartMMAAgentControlKernel[] starts the hidden Wolfram agent in a dedicated FrontEnd evaluator.";
StopMMAAgentHiddenAgent::usage = "StopMMAAgentHiddenAgent[] stops the hidden Wolfram agent loop in the current kernel.";
StopMMAAgentControlKernel::usage = "StopMMAAgentControlKernel[] closes the hidden control-kernel notebook if this kernel created it.";
AttachCurrentNotebook::usage = "AttachCurrentNotebook[] attaches the current input notebook to the local MCP bridge.";
PollBridge::usage = "PollBridge[] polls the local bridge for one pending request and executes it.";
ExecuteRequest::usage = "ExecuteRequest[assoc] executes one bridge request.";
PostResult::usage = "PostResult[requestId, result] posts a successful result to the bridge.";
PostFailure::usage = "PostFailure[requestId, code, message] posts a failure result to the bridge.";
CancelCurrentRequest::usage = "CancelCurrentRequest[] cancels the current request and attempts to abort evaluation.";
PollCancellations::usage = "PollCancellations[] polls palette-originated cancellation notices.";

Begin["`Private`"];

$BridgeBaseURL = "http://127.0.0.1:19791";
$BridgeNotebooks = <||>;
$ActiveNotebookId = None;
$PaletteId = CreateUUID["palette-"];
$AttachedNotebook = None;
$AttachedNotebookInfo = <||>;
$CellMap = <||>;
$NextCellId = 1;
$CurrentRequestId = None;
$RunningRequestId = None;
$RunningCellId = None;
$RunningNotebookId = None;
$RunningNotebookObject = None;
$RunningCellObject = None;
$RunningCellOriginalEpilogRule = HoldComplete[CellEpilog -> Inherited];
$RunningCellRestoreEpilogRule = HoldComplete[CellEpilog -> Inherited];
$RunningStartedAt = None;
$RunningStatusGraceSeconds = 2.0;
$RunningTimeoutAt = None;
$LastRunStatusCellId = None;
$LastRunStatusNotebookId = None;
$LastRunStatus = None;
$LastStatus = <||>;
$LastError = None;
$PollingInProgress = False;
$MaxArtifactScanCells = 20;
$BridgeHTTPTimeoutSeconds = 10;
$BridgeHTTPRetryCount = 3;
$BridgeHTTPRetryDelaySeconds = 0.25;
$BridgeInbox = {};
$ExecutorInProgress = False;
$BridgeExecutorTask = None;
$LastPollTime = None;
$LastResultStatus = None;
$DiagnosticsOpen = False;
$AgentSessionId = CreateUUID["agent-"];
$HiddenAgentTask = None;
$NotebookObjectKeys = <||>;
$AgentExecutionInProgress = False;
$HiddenAgentInProgress = False;
$MMAAgentBridgeSourceFile = If[StringQ[$InputFileName] && StringLength[$InputFileName] > 0, $InputFileName, None];
$ControlAgentNotebook = None;
$ControlAgentEvaluatorName = "MMAAgentControl";

UnixTimeMilliseconds[] := Round[1000 UnixTime[]];

(* $BridgePermissions replaces the plan's $Permissions name because *)
(* $Permissions is a protected Wolfram built-in symbol (Set::wrsym). *)
(* Task 7 Palette UI must bind to $BridgePermissions.              *)
$DefaultBridgePermissions = <|
  "ReadNotebook" -> True,
  "InsertCell" -> False,
  "ModifyCell" -> False,
  "DeleteCell" -> False,
  "RunCell" -> False,
  "SaveNotebook" -> False
|>;

If[!AssociationQ[Quiet @ Check[$BridgePermissions, None]],
  $BridgePermissions = $DefaultBridgePermissions
];

PalettePermissionRow[label_String, key_String] := Row[{
  Checkbox[Dynamic[$BridgePermissions[key], ($BridgePermissions[key] = #; Quiet @ Check[PostPermissions[], Null]) &]],
  Spacer[8],
  Style[label, 11]
}];

PaletteStatusSummary[] := Module[{server, paletteConnected, notebookAttached, pendingRequests, attachedNotebook, error},
  server = Lookup[$LastStatus, "server", "unknown"];
  paletteConnected = TrueQ @ Lookup[$LastStatus, "paletteConnected", False];
  notebookAttached = TrueQ @ Lookup[$LastStatus, "notebookAttached", False];
  pendingRequests = Max[Lookup[$LastStatus, "pendingRequests", 0], Length[$BridgeInbox]];
  attachedNotebook = Lookup[$LastStatus, "attachedNotebook", <||>];
  error = If[StringQ[$LastError] && StringLength[$LastError] > 0, $LastError, None];
  Column[
    DeleteCases[
      {
        Style["Server: " <> ToString[server], Bold],
        Style["Palette connected: " <> If[paletteConnected, "yes", "no"], 11],
        Style["Notebook attached: " <> If[notebookAttached, "yes", "no"], 11],
        Style["Pending requests: " <> ToString[pendingRequests], 11],
        If[AssociationQ[attachedNotebook] && attachedNotebook =!= <||>,
          Style[
            "Attached notebook: " <> ToString[Lookup[attachedNotebook, "notebookTitle", ""]],
            11
          ],
          Nothing
        ],
        If[error =!= None, Style["Last error: " <> ToString[error], Darker[Red]], Nothing]
      },
      Nothing
    ],
    Spacings -> 0.35
  ]
];

PaletteStatusPill[label_String, state_String:"neutral"] := Module[{background, foreground, border},
  {background, foreground, border} = Which[
    state === "connected", {RGBColor[0.13, 0.47, 0.27], White, RGBColor[0.20, 0.58, 0.34]},
    state === "running", {RGBColor[0.16, 0.32, 0.60], White, RGBColor[0.23, 0.42, 0.76]},
    state === "degraded", {RGBColor[0.72, 0.48, 0.10], White, RGBColor[0.84, 0.57, 0.14]},
    state === "disconnected", {RGBColor[0.62, 0.18, 0.20], White, RGBColor[0.80, 0.26, 0.29]},
    True, {RGBColor[0.24, 0.24, 0.28], White, RGBColor[0.36, 0.36, 0.40]}
  ];
  Framed[
    Style[label, 10, Bold, foreground],
    Background -> background,
    FrameStyle -> border,
    FrameMargins -> {{10, 10}, {4, 4}},
    RoundingRadius -> 14
  ]
];

NotebookDisplayName[record_Association] := Module[{info, title, path, notebookId},
  info = Lookup[record, "info", record];
  notebookId = Lookup[info, "notebookId", Lookup[record, "notebookId", ""]];
  title = StringTrim[ToString[Lookup[info, "notebookTitle", ""]]];
  path = StringTrim[ToString[Lookup[info, "notebookPath", ""]]];
  If[title === "" && path === "",
    If[StringQ[notebookId] && StringLength[notebookId] > 0, notebookId, "Untitled notebook"],
    If[path === "", title, title <> " — " <> FileNameTake[path]]
  ]
];

NotebookSelectorChoices[] := Module[{notebookIds = Keys[$BridgeNotebooks], record, display},
  If[Length[notebookIds] > 0,
    Map[
      Function[notebookId,
        record = NotebookRecord[notebookId];
        display = NotebookDisplayName[record];
        notebookId -> display
      ],
      notebookIds
    ],
    {}
  ]
];

RefreshNotebooks[] := Module[{payload, notebooks, activeNotebookId, notebookId, existing},
  payload = Quiet @ Check[BridgeGet["/notebooks"], $Failed];
  If[AssociationQ[payload],
    notebooks = Lookup[payload, "notebooks", {}];
    activeNotebookId = Lookup[payload, "activeNotebookId", $ActiveNotebookId];
    If[ListQ[notebooks],
      Do[
        If[AssociationQ[notebook],
          notebookId = Lookup[notebook, "notebookId", None];
          If[StringQ[notebookId] && StringLength[notebookId] > 0,
            existing = NotebookRecord[notebookId];
            $BridgeNotebooks[notebookId] = Join[existing, notebook]
          ]
        ],
        {notebook, notebooks}
      ]
    ];
    If[StringQ[activeNotebookId] && KeyExistsQ[$BridgeNotebooks, activeNotebookId], $ActiveNotebookId = activeNotebookId]
  ];
  payload
];

UseSelectedNotebook[] := Module[{notebookId = $ActiveNotebookId},
  If[StringQ[notebookId] && StringLength[notebookId] > 0,
    Quiet @ Check[BridgePost["/notebooks/select", <|"notebookId" -> notebookId|>], Null];
    notebookId,
    None
  ]
];

EnqueueBridgeRequest[request_Association] := Module[{requestId, existingRequestIds, status},
  requestId = Lookup[request, "requestId", None];
  If[!StringQ[requestId] || StringLength[requestId] == 0,
    Return[<|"status" -> "rejected", "reason" -> "missing_requestId"|>]
  ];
  existingRequestIds = Lookup[$BridgeInbox, "requestId", None];
  If[MemberQ[existingRequestIds, requestId],
    Return[<|"status" -> "duplicate", "requestId" -> requestId, "inboxSize" -> Length[$BridgeInbox]|>]
  ];
  AppendTo[$BridgeInbox, request];
  status = <|"status" -> "queued", "requestId" -> requestId, "inboxSize" -> Length[$BridgeInbox]|>;
  status
];

DequeueBridgeRequest[] := Module[{request},
  If[Length[$BridgeInbox] == 0, Return[None]];
  request = First[$BridgeInbox];
  $BridgeInbox = Rest[$BridgeInbox];
  request
];

SafeExecutePendingRequest[] := Module[{request = None, result = None},
  If[TrueQ[$ExecutorInProgress], Return[$LastResultStatus]];
  request = DequeueBridgeRequest[];
  If[request === None, Return[None]];
  Internal`WithLocalSettings[
    $ExecutorInProgress = True;
    $CurrentRequestId = Lookup[request, "requestId", None];
    result = Quiet @ Check[ExecuteRequest[request], $Failed];,
    $CurrentRequestId = None;
    $ExecutorInProgress = False
  ];
  result
];

StartBridgeExecutor[] := Module[{task = $BridgeExecutorTask},
  If[task === None || Not @ TrueQ @ Quiet @ Check[ScheduledTaskActiveQ[task], False],
    $BridgeExecutorTask = RunScheduledTask[SafeExecutePendingRequest[], {0.25}]
  ];
  $BridgeExecutorTask
];

RuntimeStatusCard[] := Module[{paletteConnected, transportMode, executorState, pendingRequests, runningRequest, statusState, runningRequestLabel, elapsedSeconds, runningIndicator},
  paletteConnected = TrueQ @ Lookup[$LastStatus, "paletteConnected", False];
  transportMode = Lookup[$LastStatus, "transportMode", "unknown"];
  executorState = If[TrueQ[$ExecutorInProgress], "running", If[$BridgeExecutorTask === None, Lookup[$LastStatus, "executorState", "idle"], "idle"]];
  pendingRequests = Length[$BridgeInbox];
  runningRequest = Lookup[$LastStatus, "runningRequest", None];
  statusState = Which[
    Not[paletteConnected], "disconnected",
    executorState === "running", "running",
    executorState === "blocked" || executorState === "error" || pendingRequests > 0, "degraded",
    True, "connected"
  ];
  elapsedSeconds = If[AssociationQ[runningRequest] && NumberQ[Lookup[runningRequest, "claimedAt", None]], Round[AbsoluteTime[] - Lookup[runningRequest, "claimedAt", None]], None];
  runningRequestLabel = If[
    AssociationQ[runningRequest],
    Row[DeleteCases[
      {
        Style["Running request: ", Bold],
        ToString[Lookup[runningRequest, "tool", "request"]],
        If[StringQ[Lookup[runningRequest, "requestId", ""]], " (" <> Lookup[runningRequest, "requestId", ""] <> ")", Nothing],
        If[NumberQ[elapsedSeconds], " • " <> ToString[elapsedSeconds] <> "s", Nothing]
      },
      Nothing
    ]],
    Style["Running request: none", 11]
  ];
  runningIndicator = If[statusState === "running", ProgressIndicator[Indeterminate, Appearance -> "Necklace"], ProgressIndicator[0, Appearance -> "Necklace"]];
  Panel[
    Column[
      {
        Grid[
          {{
            PaletteStatusPill[If[paletteConnected, "Connected", "Disconnected"], statusState],
            PaletteStatusPill["Transport: " <> ToString[transportMode], If[transportMode === "subkernel", "connected", If[paletteConnected, "degraded", "disconnected"]]],
            PaletteStatusPill["Executor: " <> ToString[executorState], statusState]
          }},
          Alignment -> Left,
          Spacings -> {1.1, 0.8}
        ],
        Grid[
          {{
            Style["Pending requests: " <> ToString[pendingRequests], 11],
            runningIndicator,
            Button["Cancel Running Request", CancelCurrentRequest[], Method -> "Queued"]
          }},
          Alignment -> Left,
          Spacings -> {2, 1}
        ],
        runningRequestLabel
      },
      Spacings -> 0.7
    ],
    FrameMargins -> 10,
    RoundingRadius -> 8
  ]
];

PermissionsPanel[] := Panel[
  Column[
    {
      Style["Permissions", Bold],
      Grid[
        {
          {PalettePermissionRow["Read notebook", "ReadNotebook"]},
          {PalettePermissionRow["Insert cell", "InsertCell"]},
          {PalettePermissionRow["Modify cell", "ModifyCell"]},
          {PalettePermissionRow["Delete cell", "DeleteCell"]},
          {PalettePermissionRow["Run cell", "RunCell"]},
          {PalettePermissionRow["Save notebook", "SaveNotebook"]}
        },
        Alignment -> Left,
        Spacings -> {1, 0.35}
      ]
    },
    Spacings -> 0.5
  ],
  FrameMargins -> 10,
  RoundingRadius -> 8
];

DiagnosticsPanel[] := OpenerView[
  {
    Style["Diagnostics", Bold],
    Dynamic[
      Framed[
        Grid[
          {
            {Style["Last error", Bold], Style[If[StringQ[$LastError] && StringLength[$LastError] > 0, $LastError, "None"], 11]},
            {Style["Palette id", Bold], Style[ToString[$PaletteId], 11]},
            {Style["Active notebook id", Bold], Style[If[StringQ[$ActiveNotebookId], $ActiveNotebookId, "None"], 11]},
            {Style["Transport", Bold], Style[ToString[Lookup[$LastStatus, "transportMode", "unknown"]], 11]},
            {Style["Executor", Bold], Style[ToString[Lookup[$LastStatus, "executorState", "idle"]], 11]},
            {Style["Pending requests", Bold], Style[ToString[Lookup[$LastStatus, "pendingRequests", 0]], 11]},
            {Style["Running request", Bold], Style[ToString[Lookup[$LastStatus, "runningRequest", None]], 11]},
            {Style["Last poll", Bold], Style[If[NumberQ[$LastPollTime], DateString[$LastPollTime], "None"], 11]},
            {Style["Last result", Bold], Style[ToString[$LastResultStatus], 11]},
            {Style["Inbox size", Bold], Style[ToString[Length[$BridgeInbox]], 11]}
          },
          Alignment -> Left,
          Spacings -> {2, 0.6}
        ],
        FrameMargins -> 10,
        RoundingRadius -> 8
      ],
      TrackedSymbols :> {$LastError, $PaletteId, $ActiveNotebookId, $LastStatus, $LastPollTime, $LastResultStatus, $BridgeInbox},
      SynchronousUpdating -> False
    ]
  },
  Dynamic[$DiagnosticsOpen]
];

NotebookSelectorView[] := Module[{choices, selectedRecord, selectedInfo, selectorSetter},
  selectedRecord = ActiveNotebookRecord[];
  selectedInfo = Lookup[selectedRecord, "info", selectedRecord];
  choices = NotebookSelectorChoices[];
  selectorSetter = Function[value,
    If[StringQ[value] && StringLength[value] > 0,
      $ActiveNotebookId = value;
      Quiet @ Check[BridgePost["/notebooks/select", <|"notebookId" -> value|>], Null]
    ]
  ];
  Panel[
    Column[
      {
        Grid[
          {{
            Style["Active notebook", Bold],
            If[AssociationQ[selectedRecord] && selectedRecord =!= <||>,
              PaletteStatusPill[NotebookDisplayName[selectedRecord], "connected"],
              PaletteStatusPill["No notebook selected", "disconnected"]
            ]
          }},
          Alignment -> Left,
          Spacings -> {2, 0.5}
        ],
        If[AssociationQ[selectedRecord] && selectedRecord =!= <||>,
          Grid[
            {
              {Style["Notebook id", Bold], Style[Lookup[selectedInfo, "notebookId", ""], 11]},
              {Style["Path", Bold], Style[Lookup[selectedInfo, "notebookPath", ""], 11]}
            },
            Alignment -> Left,
            Spacings -> {2, 0.5}
          ],
          Nothing
        ],
        If[Length[choices] > 0,
          PopupMenu[Dynamic[$ActiveNotebookId, selectorSetter],
            choices,
            FieldSize -> Medium
          ],
          Style["No notebooks registered", 11, Gray]
        ],
        Grid[
          {{
            Button["Register Current Window", AttachCurrentNotebook[], Method -> "Queued"],
            Button["Refresh Notebooks", RefreshNotebooks[], Method -> "Queued"],
            Button["Use Selected Notebook", UseSelectedNotebook[], Method -> "Queued"],
            Button["Poll now", PollBridge[], Method -> "Queued"]
          }},
          Alignment -> Left,
          Spacings -> {1, 0.5}
        ]
      },
      Spacings -> 0.7
    ],
    FrameMargins -> 10,
    RoundingRadius -> 8
  ]
];

SafePollBridge[] := Module[{result = $Failed},
  If[TrueQ[$PollingInProgress], Return[$LastStatus]];
  Internal`WithLocalSettings[
    $PollingInProgress = True,
    result = Quiet @ Check[PollBridge[], $Failed],
    $PollingInProgress = False
  ];
  result
];

PollHeartbeat[] := Dynamic[
  Refresh[
    SafePollBridge[];
    "",
    UpdateInterval -> 1
  ],
  TrackedSymbols :> {},
  SynchronousUpdating -> False
];

PaletteView[] := DynamicModule[{},
  Column[
    {
      PollHeartbeat[],
      Grid[
        {{
          Style["MMA Agent Bridge", 16, Bold],
          Dynamic[
            PaletteStatusPill[
              If[TrueQ @ Lookup[$LastStatus, "paletteConnected", False], "Connected", "Disconnected"],
              If[TrueQ @ Lookup[$LastStatus, "paletteConnected", False], "connected", "disconnected"]
            ],
            TrackedSymbols :> {$LastStatus},
            SynchronousUpdating -> False
          ]
        }},
        Alignment -> Left,
        Spacings -> {2, 0.5}
      ],
      Framed[
        Column[
          {
            Dynamic[NotebookSelectorView[], TrackedSymbols :> {$BridgeNotebooks, $ActiveNotebookId}, SynchronousUpdating -> False],
            Dynamic[RuntimeStatusCard[], TrackedSymbols :> {$LastStatus, $BridgeInbox, $ExecutorInProgress, $BridgeExecutorTask}, SynchronousUpdating -> False],
            PermissionsPanel[],
            DiagnosticsPanel[]
          },
          Spacings -> 1.1
        ],
        FrameMargins -> 12,
        RoundingRadius -> 10
      ]
    },
    Spacings -> 1
  ]
];

BridgeURL[path_String] := $BridgeBaseURL <> path;

URLComponentEncodeString[None] := "";
URLComponentEncodeString[value_] := StringReplace[
  ToString[value],
  {
    " " -> "%20",
    "!" -> "%21",
    "\"" -> "%22",
    "#" -> "%23",
    "$" -> "%24",
    "%" -> "%25",
    "&" -> "%26",
    "'" -> "%27",
    "(" -> "%28",
    ")" -> "%29",
    "*" -> "%2A",
    "+" -> "%2B",
    "," -> "%2C",
    "/" -> "%2F",
    ":" -> "%3A",
    ";" -> "%3B",
    "<" -> "%3C",
    "=" -> "%3D",
    ">" -> "%3E",
    "?" -> "%3F",
    "@" -> "%40",
    "[" -> "%5B",
    "\\" -> "%5C",
    "]" -> "%5D",
    "^" -> "%5E",
    "`" -> "%60",
    "{" -> "%7B",
    "|" -> "%7C",
    "}" -> "%7D"
  }
];

BridgeRequestWithRetries[request_] := Module[{attempt, response = $Failed},
  For[attempt = 1, attempt <= $BridgeHTTPRetryCount, attempt++,
    response = Quiet @ Check[
      URLRead[request, {"StatusCode", "BodyByteArray"}, TimeConstraint -> $BridgeHTTPTimeoutSeconds],
      $Failed
    ];
    If[response =!= $Failed, Return[response]];
    If[attempt < $BridgeHTTPRetryCount, Pause[$BridgeHTTPRetryDelaySeconds]]
  ];
  $Failed
];

PayloadToJsonBytes[payload_Association] := ExportByteArray[payload, "RawJSON"];

JsonByteArrayToPayload[body_ByteArray] := Module[{text},
  text = Quiet @ Check[ByteArrayToString[body], $Failed];
  If[text === $Failed || StringLength[text] == 0, Return[<||>]];
  Quiet @ Check[ImportString[text, "RawJSON"], $Failed]
];

BridgeGet[path_String] := Module[{response},
  response = BridgeRequestWithRetries[HTTPRequest[BridgeURL[path], <|"Method" -> "GET"|>]];
  If[response === $Failed, Return[$Failed]];
  JsonByteArrayToPayload[response["BodyByteArray"]]
];

BridgePost[path_String, payload_Association] := Module[{response},
  response = BridgeRequestWithRetries[
    HTTPRequest[
      BridgeURL[path],
      <|
        "Method" -> "POST",
        "ContentType" -> "application/json; charset=utf-8",
        "Body" -> PayloadToJsonBytes[payload]
      |>
    ]
  ];
  If[response === $Failed, Return[$Failed]];
  JsonByteArrayToPayload[response["BodyByteArray"]]
];

PostPermissions[] := Module[{payload = <|"permissions" -> $BridgePermissions|>},
  Quiet @ Check[BridgePost["/permissions", payload], $Failed]
];

NeedsConfirmationQ[action_String] := Not @ TrueQ[$BridgePermissions[action]];

ConfirmAction[action_String, message_String] := If[
  NeedsConfirmationQ[action],
  ChoiceDialog[message, {"Allow" -> True, "Deny" -> False}],
  True
];

BridgeFailure[code_String, message_String] := Failure[code, <|"Message" -> message|>];

FailedRequestCode[failure_Failure] := Module[{code = failure[[1]]},
  If[StringQ[code] && StringLength[code] > 0, code, "WOLFRAM_ERROR"]
];

FailedRequestMessage[failure_Failure] := Lookup[failure[[2]], "Message", Lookup[failure[[2]], "message", "The Wolfram bridge rejected the request."]];

RequireReadPermission[] := If[
  Not @ ConfirmAction["ReadNotebook", "AI requests reading the notebook. Allow?"],
  $Canceled,
  True
];

NotebookIdFor[nb_NotebookObject] := Module[{existing},
  existing = SelectFirst[
    Keys[$BridgeNotebooks],
    Function[notebookId, AssociationQ[NotebookRecord[notebookId]] && Lookup[NotebookRecord[notebookId], "notebook", None] === nb],
    None
  ];
  If[StringQ[existing] && StringLength[existing] > 0, existing, CreateUUID["notebook-"]]
];

NotebookInfo[nb_NotebookObject, notebookId_String] := <|
  "notebookId" -> notebookId,
  "notebookTitle" -> ToString @ CurrentValue[nb, WindowTitle],
  "notebookPath" -> ToString @ Replace[NotebookFileName[nb], $Failed -> ""],
  "wolframVersion" -> ToString @ $VersionNumber,
  "platform" -> $OperatingSystem,
  "paletteId" -> $PaletteId,
  "permissions" -> $BridgePermissions
|>;

NotebookRecord[notebookId_String] := Lookup[$BridgeNotebooks, notebookId, <||>];

FrontendObjectKey[nb_NotebookObject] := Module[{existing},
  existing = SelectFirst[Keys[$NotebookObjectKeys], Lookup[$NotebookObjectKeys, #, None] === nb &, None];
  If[StringQ[existing] && StringLength[existing] > 0, existing, With[{key = CreateUUID["fe-"]}, $NotebookObjectKeys[key] = nb; key]]
];

MeaningfulNotebookTitleQ[title_] := Module[{text = StringTrim[ToString[title]]},
  StringLength[text] > 0 && !MemberQ[{"Automatic", "None", "Null"}, text]
];

NotebookWindowTitle[nb_NotebookObject] := Module[{title},
  title = Quiet @ Check[CurrentValue[nb, WindowTitle], ""];
  If[MeaningfulNotebookTitleQ[title], StringTrim[ToString[title]], ""]
];

NotebookDisplayNameForHeartbeat[nb_NotebookObject, savedPath_String, frontendObjectKey_String] := Module[{windowTitle},
  windowTitle = NotebookWindowTitle[nb];
  Which[
    StringLength[StringTrim[savedPath]] > 0, FileNameTake[savedPath],
    StringLength[windowTitle] > 0, windowTitle,
    True, "Untitled notebook " <> StringTake[frontendObjectKey, -8]
  ]
];

NotebookIdForObject[nb_NotebookObject] := SelectFirst[
  Keys[$BridgeNotebooks],
  Function[notebookId, AssociationQ[NotebookRecord[notebookId]] && Lookup[NotebookRecord[notebookId], "notebook", None] === nb],
  None
];

ActiveNotebookRecord[] := If[StringQ[$ActiveNotebookId] && StringLength[$ActiveNotebookId] > 0, NotebookRecord[$ActiveNotebookId], <||>];

TargetNotebookId[args_Association] := Module[{explicit = Lookup[args, "notebookId", None]},
  Which[
    StringQ[explicit] && StringLength[explicit] > 0, explicit,
    StringQ[$ActiveNotebookId] && StringLength[$ActiveNotebookId] > 0, $ActiveNotebookId,
    True, None
  ]
];

RegisterCurrentNotebook[] := Module[{nb, notebookId, info, record, cellMap, nextCellId},
  nb = InputNotebook[];
  If[Head[nb] =!= NotebookObject, Return[$Failed]];
  notebookId = NotebookIdFor[nb];
  info = NotebookInfo[nb, notebookId];
  record = NotebookRecord[notebookId];
  cellMap = Lookup[record, "cellMap", <||>];
  nextCellId = Lookup[record, "nextCellId", 1];
  $AttachedNotebook = nb;
  $AttachedNotebookInfo = info;
  $ActiveNotebookId = notebookId;
  $CellMap = cellMap;
  $NextCellId = nextCellId;
  $BridgeNotebooks[notebookId] = Join[
    record,
    <|
      "notebook" -> nb,
      "info" -> info,
      "cellMap" -> cellMap,
      "nextCellId" -> nextCellId,
      "closed" -> False
    |>
  ];
  Quiet @ Check[BridgePost["/notebooks/upsert", info], Null];
  Quiet @ Check[BridgePost["/notebooks/select", <|"notebookId" -> notebookId|>], Null];
  info
];

AttachCurrentNotebook[] := RegisterCurrentNotebook[];

PostResult[requestId_String, result_Association] := Module[{payload},
  payload = <|"requestId" -> requestId, "ok" -> True, "response" -> result|>;
  $LastResultStatus = payload;
  If[TrueQ[$AgentExecutionInProgress],
    AgentPostResult[requestId, result],
    BridgePost[
      "/result",
      <|"requestId" -> requestId, "ok" -> True, "result" -> result|>
    ]
  ]
];

PostFailure[requestId_String, code_String, message_String] := Module[{payload},
  payload = <|"requestId" -> requestId, "ok" -> False, "response" -> <|"code" -> code, "message" -> message|>|>;
  $LastResultStatus = payload;
  If[TrueQ[$AgentExecutionInProgress],
    AgentPostFailure[requestId, code, message],
    BridgePost[
      "/result",
      <|"requestId" -> requestId, "ok" -> False, "error" -> <|"code" -> code, "message" -> message|>|>
    ]
  ]
];

CancelCurrentRequest[] := Module[{requestId = $CurrentRequestId, runningId = $RunningRequestId, runningCellId = $RunningCellId, runningNotebook = $RunningNotebookObject, activeId},
  activeId = Which[StringQ[requestId], requestId, StringQ[runningId], runningId, True, None];
  If[Head[$RunningNotebookObject] === NotebookObject,
    Quiet @ Check[FrontEndTokenExecute[$RunningNotebookObject, "EvaluatorAbort"], Null],
    If[$AttachedNotebook =!= None, Quiet @ Check[FrontEndTokenExecute[$AttachedNotebook, "EvaluatorAbort"], Null]]
  ];
  If[StringQ[activeId],
    BridgePost["/cancel", <|"requestId" -> activeId, "reason" -> "USER_CANCELLED_IN_PALETTE"|>]
  ]
  ; If[StringQ[runningCellId] && Head[runningNotebook] === NotebookObject,
      If[CellEvaluationCompleteQ[runningNotebook, runningCellId],
        FinishRunningCell["finished"],
        FinishRunningCell["aborted"]
      ],
      ClearRunningEvaluationState[];
      $LastRunStatusCellId = None;
      $LastRunStatusNotebookId = None;
      $LastRunStatus = None;
    ]
];

StartMMAAgentPalette[] := Module[{},
  StartBridgeExecutor[];
  CreatePalette[PaletteView[], WindowTitle -> "MMA Agent Bridge", Saveable -> False]
];

CellContentString[cell_CellObject] := Module[{expr, content},
  expr = Quiet @ Check[NotebookRead[cell], $Failed];
  If[expr === $Failed, Return[""]];
  content = Replace[
    expr,
    {
      Cell[BoxData[s_String], ___] :> s,
      Cell[BoxData[boxes_], ___] :> Module[{made = Quiet @ Check[MakeExpression[boxes, StandardForm], $Failed]},
        If[made === $Failed, ToString[boxes, InputForm], ToString[made, InputForm]]
      ],
      Cell[text_String, ___] :> text,
      Cell[other_, ___] :> ToString[other, InputForm]
    },
    {0}
  ];
  If[StringQ[content], content, ToString[content, InputForm]]
];

CellStyleName[cell_CellObject] := Module[{expr, style},
  expr = Quiet @ Check[NotebookRead[cell], $Failed];
  If[expr === $Failed, Return["Unknown"]];
  style = Replace[expr, Cell[_, style_String, ___] :> style, {0}];
  If[StringQ[style], style, "Unknown"]
];

CellTagsList[cell_CellObject] := Module[{expr, tags},
  expr = Quiet @ Check[NotebookRead[cell], $Failed];
  If[expr === $Failed, Return[{}]];
  tags = Replace[
    expr,
    {
      Cell[___, CellTags -> raw_, ___] :> raw
    },
    {0}
  ];
  Replace[tags, {s_String :> {s}, l_List :> Cases[l, _String], _ -> {}}]
];

CellPayload[cell_CellObject, id_String, index_Integer] := <|
  "cellId" -> id,
  "index" -> index,
  "style" -> CellStyleName[cell],
  "contentPreview" -> StringTake[CellContentString[cell], UpTo[240]],
  "hasOutput" -> False,
  "tags" -> CellTagsList[cell]
|>;

CellGeneratedBoundaryQ[style_String] := MemberQ[{"Input", "Code", "Text", "Section", "Subsection", "Subsubsection", "Title", "Chapter"}, style];

CellArtifactStyleQ[style_String] := MemberQ[{"Output", "Print", "Message"}, style];

CellEvaluationTaggingPath[cellId_String] := {TaggingRules, "MMAAgentBridge", "evaluations", cellId, "complete"};

MarkCellEvaluationComplete[cellId_String] := Quiet @ Check[
  CurrentValue[EvaluationNotebook[], CellEvaluationTaggingPath[cellId]] = True,
  Null
];

ClearCellEvaluationComplete[notebook_NotebookObject, cellId_String] := Quiet @ Check[
  CurrentValue[notebook, CellEvaluationTaggingPath[cellId]] = Inherited,
  Null
];

CellEvaluationCompleteQ[notebook_NotebookObject, cellId_String] := TrueQ @ Quiet @ Check[
  CurrentValue[notebook, CellEvaluationTaggingPath[cellId]],
  False
];

CellEpilogOptionRule[cell_CellObject] := Module[{heldOptions, matches},
  heldOptions = Apply[HoldComplete, Quiet @ Check[Options[cell, CellEpilog], {}]];
  matches = Cases[heldOptions, HoldPattern[rule : ((CellEpilog -> _) | (CellEpilog :> _))] :> HoldComplete[rule], Infinity, 1];
  If[Length[matches] > 0, First[matches], HoldComplete[CellEpilog -> Inherited]]
];

CellEffectiveEpilogOptionRule[cell_CellObject] := Module[{restoreRule, effective},
  restoreRule = CellEpilogOptionRule[cell];
  If[restoreRule =!= HoldComplete[CellEpilog -> Inherited], Return[restoreRule]];
  (* Inherited CellEpilog is captured as an effective value before installing the bridge epilog. *)
  effective = Quiet @ Check[CurrentValue[cell, CellEpilog], Inherited];
  HoldComplete[CellEpilog :> effective]
];

RunOriginalCellEpilog[HoldComplete[CellEpilog -> None]] := Null;
RunOriginalCellEpilog[HoldComplete[CellEpilog -> Inherited]] := Null;
RunOriginalCellEpilog[HoldComplete[CellEpilog :> None]] := Null;
RunOriginalCellEpilog[HoldComplete[CellEpilog :> Inherited]] := Null;
RunOriginalCellEpilog[HoldComplete[CellEpilog -> value_]] := value;
RunOriginalCellEpilog[HoldComplete[CellEpilog :> value_]] := value;
RunOriginalCellEpilog[_] := Null;

RestoreCellEpilogOption[cell_CellObject, HoldComplete[CellEpilog -> Inherited]] := Quiet @ Check[SetOptions[cell, CellEpilog -> Inherited], Null];
RestoreCellEpilogOption[cell_CellObject, HoldComplete[CellEpilog -> None]] := Quiet @ Check[SetOptions[cell, CellEpilog -> None], Null];
RestoreCellEpilogOption[cell_CellObject, HoldComplete[CellEpilog :> value_]] := Quiet @ Check[SetOptions[cell, CellEpilog :> value], Null];
(* Immediate CellEpilog rules have already evaluated by the time Options returns them; restore via RuleDelayed to avoid restore-time side effects. *)
RestoreCellEpilogOption[cell_CellObject, HoldComplete[CellEpilog -> value_]] := Quiet @ Check[SetOptions[cell, CellEpilog :> Unevaluated[value]], Null];
RestoreCellEpilogOption[_, _] := Null;

InstallRunningCellEpilog[cell_CellObject, cellId_String] := Module[{originalEpilogRule, restoreEpilogRule, result},
  restoreEpilogRule = CellEpilogOptionRule[cell];
  originalEpilogRule = CellEffectiveEpilogOptionRule[cell];
  result = Quiet @ Check[
    With[{targetCellId = cellId, heldOriginalEpilogRule = originalEpilogRule},
      SetOptions[cell, CellEpilog :> Internal`WithLocalSettings[
        Null,
        RunOriginalCellEpilog[heldOriginalEpilogRule],
        MarkCellEvaluationComplete[targetCellId]
      ]]
    ],
    $Failed
  ];
  If[result === $Failed, Return[BridgeFailure["RUN_FAILED", "The FrontEnd failed to install the completion tracker."]]];
  $RunningCellObject = cell;
  $RunningCellOriginalEpilogRule = originalEpilogRule;
  $RunningCellRestoreEpilogRule = restoreEpilogRule;
  True
];

RestoreRunningCellEpilog[] := Module[{},
  If[Head[$RunningCellObject] === CellObject,
    RestoreCellEpilogOption[$RunningCellObject, $RunningCellRestoreEpilogRule]
  ];
  $RunningCellObject = None;
  $RunningCellOriginalEpilogRule = HoldComplete[CellEpilog -> Inherited];
  $RunningCellRestoreEpilogRule = HoldComplete[CellEpilog -> Inherited];
];

ClearRunningEvaluationState[] := Module[{cellId = $RunningCellId, notebook = $RunningNotebookObject},
  RestoreRunningCellEpilog[];
  If[Head[notebook] === NotebookObject && StringQ[cellId], ClearCellEvaluationComplete[notebook, cellId]];
  $RunningCellId = None;
  $RunningRequestId = None;
  $RunningNotebookId = None;
  $RunningNotebookObject = None;
  $RunningStartedAt = None;
  $RunningTimeoutAt = None
];

FinishRunningCell[status_String] := Module[{cellId = $RunningCellId, notebookId = $RunningNotebookId},
  ClearRunningEvaluationState[];
  $LastRunStatusCellId = cellId;
  $LastRunStatusNotebookId = notebookId;
  $LastRunStatus = status
];

CellGeneratedArtifactQ[cell_CellObject] := TrueQ[Quiet @ Check[CurrentValue[cell, GeneratedCell], False]] && CellArtifactStyleQ[CellStyleName[cell]];

CellOwnsGeneratedArtifactsQ[style_String] := MemberQ[{"Input", "Code"}, style];

GeneratedArtifactsAfterCell[cell_CellObject, notebook_:Automatic] := Module[{nb, cells, position, following},
  nb = If[notebook === Automatic, $AttachedNotebook, notebook];
  If[nb === None, Return[{}]];
  If[!CellOwnsGeneratedArtifactsQ[CellStyleName[cell]], Return[{}]];
  cells = Cells[nb];
  position = FirstPosition[cells, cell, Missing["NotFound"]];
  If[MissingQ[position], Return[{}]];
  following = Take[cells, {First[position] + 1, Min[Length[cells], First[position] + $MaxArtifactScanCells]}];
  TakeWhile[following, CellGeneratedArtifactQ]
];

CheckRunningTimeout[] := Module[{},
  If[
    StringQ[$RunningCellId] && NumberQ[$RunningTimeoutAt] && AbsoluteTime[] >= $RunningTimeoutAt,
    Quiet @ Check[
      If[Head[$RunningNotebookObject] === NotebookObject,
        FrontEndTokenExecute[$RunningNotebookObject, "EvaluatorAbort"],
        If[$AttachedNotebook =!= None, FrontEndTokenExecute[$AttachedNotebook, "EvaluatorAbort"], Null]
      ],
      Null
    ];
    FinishRunningCell["timeout"]
  ]
];

CellArtifactScan[cell_CellObject, cellId_String:"", notebook_:Automatic] := Module[{nb, cells, position, following, artifacts, outputs = {}, messages = {}, current, style, content, status, sameRunningCellQ, hasArtifactsQ, hasFinalOutputQ, evaluationCompleteQ},
  CheckRunningTimeout[];
  nb = If[notebook === Automatic, $AttachedNotebook, notebook];
  If[nb === None, Return[<|"outputs" -> {}, "messages" -> {}, "status" -> "unknown"|>]];
  If[!CellOwnsGeneratedArtifactsQ[CellStyleName[cell]], Return[<|"outputs" -> {}, "messages" -> {}, "status" -> "unknown"|>]];
  cells = Cells[nb];
  position = FirstPosition[cells, cell, Missing["NotFound"]];
  If[MissingQ[position], Return[<|"outputs" -> {}, "messages" -> {}, "status" -> "unknown"|>]];
  following = Take[cells, {First[position] + 1, Min[Length[cells], First[position] + $MaxArtifactScanCells]}];
  artifacts = TakeWhile[following, CellArtifactStyleQ[CellStyleName[#]] &];
  Do[
    current = artifacts[[i]];
    style = CellStyleName[current];
    content = CellContentString[current];
    Which[
      style === "Output" || style === "Print", AppendTo[outputs, content],
      style === "Message", AppendTo[messages, content]
    ];
    , {i, Length[artifacts]}
  ];
  sameRunningCellQ = StringQ[cellId] && StringQ[$RunningCellId] && cellId === $RunningCellId && (notebook === Automatic || nb === $RunningNotebookObject);
  hasArtifactsQ = Length[outputs] > 0 || Length[messages] > 0;
  hasFinalOutputQ = MemberQ[CellStyleName /@ artifacts, "Output"];
  evaluationCompleteQ = StringQ[cellId] && CellEvaluationCompleteQ[nb, cellId];
  status = Which[
    StringQ[cellId] && StringQ[$LastRunStatusCellId] && cellId === $LastRunStatusCellId && StringQ[$LastRunStatusNotebookId] && NotebookIdForObject[nb] === $LastRunStatusNotebookId && $LastRunStatus === "timeout",
      "timeout",
    StringQ[cellId] && StringQ[$LastRunStatusCellId] && cellId === $LastRunStatusCellId && StringQ[$LastRunStatusNotebookId] && NotebookIdForObject[nb] === $LastRunStatusNotebookId && $LastRunStatus === "finished",
      "finished",
    StringQ[cellId] && StringQ[$LastRunStatusCellId] && cellId === $LastRunStatusCellId && StringQ[$LastRunStatusNotebookId] && NotebookIdForObject[nb] === $LastRunStatusNotebookId && $LastRunStatus === "aborted",
      "aborted",
    sameRunningCellQ && NumberQ[$RunningStartedAt] && (AbsoluteTime[] - $RunningStartedAt < $RunningStatusGraceSeconds),
      "running",
    sameRunningCellQ && (evaluationCompleteQ || hasFinalOutputQ),
      (FinishRunningCell["finished"]; "finished"),
    sameRunningCellQ,
      "running",
    evaluationCompleteQ || hasFinalOutputQ || hasArtifactsQ, "finished",
    True, "unknown"
  ];
  <|
    "outputs" -> outputs,
    "messages" -> messages,
    "status" -> status
  |>
];

RefreshCellMap[notebookId_String] := Module[{record, nb, cells, idByCell, previousIds, id, payload, cellMap, nextCellId},
  record = NotebookRecord[notebookId];
  If[!AssociationQ[record] || record === <||>, Return[BridgeFailure["BAD_REQUEST", "No notebook is registered."]]];
  nb = Lookup[record, "notebook", None];
  If[Head[nb] =!= NotebookObject, Return[BridgeFailure["BAD_REQUEST", "Notebook is unavailable."]]];
  cells = Quiet @ Check[Cells[nb], $Failed];
  If[cells === $Failed, Return[BridgeFailure["BAD_REQUEST", "Notebook is unavailable."]]];
  previousIds = AssociationThread[Values[Lookup[record, "cellMap", <||>]], Keys[Lookup[record, "cellMap", <||>]]];
  idByCell = Association[];
  nextCellId = Lookup[record, "nextCellId", 1];
  Do[
    id = Lookup[previousIds, cell, Missing["NotFound"]];
    If[MissingQ[id], id = "cell_" <> ToString[nextCellId++]];
    AssociateTo[idByCell, cell -> id];
    , {cell, cells}
  ];
  cellMap = AssociationThread[Values[idByCell], Keys[idByCell]];
  payload = MapIndexed[CellPayload[#1, Lookup[idByCell, #1], First[#2]] &, cells];
  $BridgeNotebooks[notebookId] = Join[record, <|"cellMap" -> cellMap, "nextCellId" -> nextCellId, "closed" -> False|>];
  If[$ActiveNotebookId === notebookId,
    $AttachedNotebook = nb;
    $AttachedNotebookInfo = Lookup[$BridgeNotebooks[notebookId], "info", <||>];
    $CellMap = cellMap;
    $NextCellId = nextCellId;
  ];
  payload
];

ReadCellById[args_Association] := Module[{notebookId, record, cellId, cell},
  If[RequireReadPermission[] === $Canceled, Return[$Canceled]];
  notebookId = TargetNotebookId[args];
  If[!StringQ[notebookId] || StringLength[notebookId] == 0, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  record = NotebookRecord[notebookId];
  If[!AssociationQ[record] || record === <||>, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  cellId = Lookup[args, "cellId", ""];
  If[StringLength[cellId] == 0, Return[Failure["BAD_REQUEST", <|"message" -> "cellId is required."|>]]];
  cell = Lookup[Lookup[record, "cellMap", <||>], cellId, Missing["NotFound"]];
  If[MissingQ[cell], Return[Failure["BAD_REQUEST", <|"message" -> "Requested cell was not found."|>]]];
  With[{notebook = Lookup[record, "notebook", None], artifacts = CellArtifactScan[cell, cellId, Lookup[record, "notebook", None]]},
  <|
    "cellId" -> cellId,
    "style" -> CellStyleName[cell],
    "content" -> CellContentString[cell],
    "outputs" -> artifacts["outputs"],
    "messages" -> artifacts["messages"],
    "status" -> artifacts["status"]
  |>
  ]
];

GetCellOutputById[args_Association] := Module[{notebookId, record, cellId, cell, artifacts},
  If[RequireReadPermission[] === $Canceled, Return[$Canceled]];
  notebookId = TargetNotebookId[args];
  If[!StringQ[notebookId] || StringLength[notebookId] == 0, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  record = NotebookRecord[notebookId];
  If[!AssociationQ[record] || record === <||>, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  cellId = Lookup[args, "cellId", ""];
  If[StringLength[cellId] == 0, Return[Failure["BAD_REQUEST", <|"message" -> "cellId is required."|>]]];
  cell = Lookup[Lookup[record, "cellMap", <||>], cellId, Missing["NotFound"]];
  If[MissingQ[cell], Return[Failure["BAD_REQUEST", <|"message" -> "Requested cell was not found."|>]]];
  artifacts = CellArtifactScan[cell, cellId, Lookup[record, "notebook", None]];
  <|
    "cellId" -> cellId,
    "outputs" -> artifacts["outputs"],
    "messages" -> artifacts["messages"],
    "status" -> artifacts["status"]
  |>
];

MakeCellExpression[content_String, style_String] := Module[{cellStyle = If[StringQ[style] && StringLength[style] > 0, style, "Input"]},
  If[cellStyle === "Input",
    Cell[BoxData[content], "Input", CellTags -> {"AI-Generated"}],
    Cell[content, cellStyle, CellTags -> {"AI-Generated"}]
  ]
];

InsertCellAtLocation[notebook_NotebookObject, anchor_CellObject, newCell_] := Module[{beforeCount, writeResult, afterCount},
  beforeCount = Length[Cells[notebook]];
  writeResult = Quiet @ Check[
    If[
      NameQ["System`NotebookLocationSpecifier"],
      NotebookWrite[NotebookLocationSpecifier[anchor, "After"], newCell, None],
      SelectionMove[anchor, After, Cell];
      NotebookWrite[notebook, newCell, None]
    ],
    $Failed
  ];
  If[writeResult === $Failed, Return[BridgeFailure["INSERT_FAILED", "The FrontEnd failed to insert the cell."]]];
  afterCount = Length[Cells[notebook]];
  If[afterCount <= beforeCount,
    Return[BridgeFailure["INSERT_FAILED", "The FrontEnd did not add a new cell; refusing to report a replacement as insertion."]]
  ];
  True
];

InsertCellAtBeginning[notebook_NotebookObject, newCell_] := Module[{beforeCount, writeResult, afterCount},
  beforeCount = Length[Cells[notebook]];
  SelectionMove[notebook, Before, Notebook];
  writeResult = Quiet @ Check[NotebookWrite[notebook, newCell, None], $Failed];
  If[writeResult === $Failed, Return[BridgeFailure["INSERT_FAILED", "The FrontEnd failed to insert the first cell."]]];
  afterCount = Length[Cells[notebook]];
  If[afterCount <= beforeCount,
    Return[BridgeFailure["INSERT_FAILED", "The FrontEnd did not add the first cell."]]
  ];
  True
];

InsertCellRequest[args_Association] := Module[{notebookId, record, afterId, style, content, newCell, notebook, anchor, cells, inserted, refreshed},
  If[Not @ ConfirmAction["InsertCell", "AI requests inserting 1 cell. Allow?"], Return[$Canceled]];
  notebookId = TargetNotebookId[args];
  If[!StringQ[notebookId] || StringLength[notebookId] == 0, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  record = NotebookRecord[notebookId];
  If[!AssociationQ[record] || record === <||>, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  notebook = Lookup[record, "notebook", None];
  If[Head[notebook] =!= NotebookObject, Return[Failure["BAD_REQUEST", <|"message" -> "Notebook is unavailable."|>]]];
  afterId = Lookup[args, "afterCellId", None];
  If[afterId === "__end__", afterId = None];
  style = Lookup[args, "style", "Input"];
  content = Lookup[args, "content", ""];
  If[!StringQ[content], Return[Failure["BAD_REQUEST", <|"Message" -> "Cell content must be a string."|>]]];
  newCell = MakeCellExpression[content, style];
  cells = Cells[notebook];
  If[StringQ[afterId] && Length[cells] == 0,
    inserted = InsertCellAtBeginning[notebook, newCell],
    If[StringQ[afterId],
      If[!KeyExistsQ[Lookup[record, "cellMap", <||>], afterId], Return[Failure["BAD_REQUEST", <|"Message" -> StringTemplate["Unknown afterCellId ``."][afterId]|>]]];
      anchor = Lookup[record, "cellMap", <||>][afterId];
      inserted = InsertCellAtLocation[notebook, anchor, newCell],
      If[Length[cells] > 0,
        inserted = InsertCellAtLocation[notebook, Last[cells], newCell],
        inserted = InsertCellAtBeginning[notebook, newCell]
      ]
    ]
  ];
  If[MatchQ[inserted, _Failure], Return[inserted]];
  refreshed = Quiet @ Check[RefreshCellMap[notebookId], $Failed];
  If[refreshed === $Failed,
    $BridgeNotebooks[notebookId] = Join[record, <|"closed" -> False|>];
    <|"status" -> "inserted"|>,
    <|"status" -> "inserted", "cells" -> refreshed|>
  ]
];

ModifyCellRequest[args_Association] := Module[{notebookId, record, notebook, cellId, cellMap, cell, content, style, newCell, cells, cellIndex, updatedCells, updatedCell, writeResult},
  If[Not @ ConfirmAction["ModifyCell", "AI requests modifying 1 cell. Allow?"], Return[$Canceled]];
  notebookId = TargetNotebookId[args];
  If[!StringQ[notebookId] || StringLength[notebookId] == 0, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  record = NotebookRecord[notebookId];
  If[!AssociationQ[record] || record === <||>, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  notebook = Lookup[record, "notebook", None];
  If[Head[notebook] =!= NotebookObject, Return[Failure["BAD_REQUEST", <|"message" -> "Notebook is unavailable."|>]]];
  cellId = Lookup[args, "cellId", ""];
  If[!StringQ[cellId] || StringLength[cellId] == 0, Return[Failure["BAD_REQUEST", <|"message" -> "cellId is required."|>]]];
  cellMap = Lookup[record, "cellMap", <||>];
  cell = Lookup[cellMap, cellId, Missing["NotFound"]];
  If[MissingQ[cell], Return[Failure["BAD_REQUEST", <|"message" -> "Requested cell was not found."|>]]];
  cells = Cells[notebook];
  cellIndex = FirstPosition[cells, cell, Missing["NotFound"]];
  If[MissingQ[cellIndex], Return[Failure["BAD_REQUEST", <|"message" -> "Requested cell was not found."|>]]];
  style = CellStyleName[cell];
  content = Lookup[args, "content", ""];
  If[!StringQ[content], Return[Failure["BAD_REQUEST", <|"message" -> "Cell content must be a string."|>]]];
  newCell = MakeCellExpression[content, style];
  writeResult = Quiet @ Check[NotebookWrite[cell, newCell], $Failed];
  If[writeResult === $Failed, Return[Failure["MODIFY_FAILED", <|"message" -> "The FrontEnd failed to modify the cell."|>]]];
  updatedCells = Cells[notebook];
  If[First[cellIndex] > Length[updatedCells], Return[Failure["MODIFY_FAILED", <|"message" -> "The FrontEnd did not return the modified cell."|>]]];
  updatedCell = updatedCells[[First[cellIndex]]];
  AssociateTo[cellMap, cellId -> updatedCell];
  $BridgeNotebooks[notebookId] = Join[record, <|"cellMap" -> cellMap, "closed" -> False|>];
  If[$ActiveNotebookId === notebookId, $CellMap = cellMap];
  <|"status" -> "modified", "cellId" -> cellId|>
];

DeleteCellRequest[args_Association] := Module[{notebookId, record, notebook, cellId, cell, cellMap, artifacts, artifactIds, newCellMap},
  If[Not @ ConfirmAction["DeleteCell", "AI requests deleting 1 cell. Allow?"], Return[$Canceled]];
  notebookId = TargetNotebookId[args];
  If[!StringQ[notebookId] || StringLength[notebookId] == 0, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  record = NotebookRecord[notebookId];
  If[!AssociationQ[record] || record === <||>, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  notebook = Lookup[record, "notebook", None];
  If[Head[notebook] =!= NotebookObject, Return[Failure["BAD_REQUEST", <|"message" -> "Notebook is unavailable."|>]]];
  cellId = Lookup[args, "cellId", ""];
  If[!StringQ[cellId] || StringLength[cellId] == 0, Return[Failure["BAD_REQUEST", <|"message" -> "cellId is required."|>]]];
  cellMap = Lookup[record, "cellMap", <||>];
  cell = Lookup[cellMap, cellId, Missing["NotFound"]];
  If[MissingQ[cell], Return[Failure["BAD_REQUEST", <|"message" -> "Requested cell was not found."|>]]];
  artifacts = GeneratedArtifactsAfterCell[cell, notebook];
  artifactIds = Keys @ Select[cellMap, MemberQ[artifacts, #] &];
  Scan[NotebookDelete, Reverse[artifacts]];
  NotebookDelete[cell];
  newCellMap = KeyDrop[cellMap, Join[{cellId}, artifactIds]];
  $BridgeNotebooks[notebookId] = Join[record, <|"cellMap" -> newCellMap, "closed" -> False|>];
  If[$ActiveNotebookId === notebookId, $CellMap = newCellMap];
  <|"status" -> "deleted", "cellId" -> cellId, "deletedArtifactCount" -> Length[artifacts]|>
];

RunCellRequest[args_Association] := Module[{notebookId, record, notebook, cellId, cell, timeoutSec = Lookup[args, "timeoutSec", 120], installedEpilog, evaluateResult},
  If[Not @ ConfirmAction["RunCell", "AI requests running 1 cell. Allow?"], Return[$Canceled]];
  notebookId = TargetNotebookId[args];
  If[!StringQ[notebookId] || StringLength[notebookId] == 0, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  record = NotebookRecord[notebookId];
  If[!AssociationQ[record] || record === <||>, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  notebook = Lookup[record, "notebook", None];
  If[Head[notebook] =!= NotebookObject, Return[Failure["BAD_REQUEST", <|"message" -> "Notebook is unavailable."|>]]];
  cellId = Lookup[args, "cellId", ""];
  If[!StringQ[cellId] || StringLength[cellId] == 0, Return[Failure["BAD_REQUEST", <|"message" -> "cellId is required."|>]]];
  cell = Lookup[Lookup[record, "cellMap", <||>], cellId, Missing["NotFound"]];
  If[MissingQ[cell], Return[Failure["BAD_REQUEST", <|"message" -> "Requested cell was not found."|>]]];
  ClearCellEvaluationComplete[notebook, cellId];
  installedEpilog = InstallRunningCellEpilog[cell, cellId];
  If[MatchQ[installedEpilog, _Failure], Return[installedEpilog]];
  $LastRunStatusCellId = None;
  $LastRunStatusNotebookId = None;
  $LastRunStatus = None;
  $RunningRequestId = Lookup[args, "requestId", $CurrentRequestId];
  $RunningCellId = cellId;
  $RunningNotebookId = notebookId;
  $RunningNotebookObject = notebook;
  $RunningStartedAt = AbsoluteTime[];
  If[!NumericQ[timeoutSec], timeoutSec = 120];
  $RunningTimeoutAt = AbsoluteTime[] + timeoutSec;
  SelectionMove[cell, All, Cell];
  (* RunCell returns immediately; Palette-local cancellation can still abort the running evaluation. *)
  evaluateResult = Quiet @ Check[FrontEndTokenExecute[notebook, "EvaluateCells"], $Failed];
  If[evaluateResult === $Failed,
    ClearRunningEvaluationState[];
    Return[BridgeFailure["RUN_FAILED", "The FrontEnd failed to start evaluating the cell."]]
  ];
  $BridgeNotebooks[notebookId] = Join[record, <|"closed" -> False|>];
  <|"status" -> "started", "cellId" -> cellId|>
];

AbortEvaluationRequest[args_Association] := Module[{notebookId, record, notebook, runningCellId, runningRequestId, wasRunning},
  If[Not @ ConfirmAction["RunCell", "AI requests aborting the running evaluation. Allow?"], Return[$Canceled]];
  notebookId = TargetNotebookId[args];
  If[!StringQ[notebookId] || StringLength[notebookId] == 0, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  record = NotebookRecord[notebookId];
  If[!AssociationQ[record] || record === <||>, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  notebook = Lookup[record, "notebook", None];
  If[Head[notebook] =!= NotebookObject, Return[Failure["BAD_REQUEST", <|"message" -> "Notebook is unavailable."|>]]];
  runningCellId = $RunningCellId;
  runningRequestId = $RunningRequestId;
  wasRunning = StringQ[$RunningCellId] && ($RunningNotebookId === notebookId || $RunningNotebookObject === notebook);
  If[wasRunning && StringQ[runningCellId] && CellEvaluationCompleteQ[notebook, runningCellId],
    FinishRunningCell["finished"];
    Return[<|"status" -> "finished", "cellId" -> runningCellId, "requestId" -> runningRequestId|>]
  ];
  Quiet @ Check[FrontEndTokenExecute[notebook, "EvaluatorAbort"], Null];
  If[wasRunning,
    FinishRunningCell["aborted"];
    <|"status" -> "aborted", "cellId" -> runningCellId, "requestId" -> runningRequestId|>,
    <|"status" -> "idle"|>
  ]
];

SaveNotebookRequest[args_Association] := Module[{notebookId, record, notebook},
  If[Not @ ConfirmAction["SaveNotebook", "AI requests saving the notebook. Allow?"], Return[$Canceled]];
  notebookId = TargetNotebookId[args];
  If[!StringQ[notebookId] || StringLength[notebookId] == 0, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  record = NotebookRecord[notebookId];
  If[!AssociationQ[record] || record === <||>, Return[Failure["BAD_REQUEST", <|"message" -> "No notebook is selected."|>]]];
  notebook = Lookup[record, "notebook", None];
  If[Head[notebook] =!= NotebookObject, Return[Failure["BAD_REQUEST", <|"message" -> "Notebook is unavailable."|>]]];
  NotebookSave[notebook];
  <|"status" -> "saved"|>
];

SelectNotebookRequest[args_Association] := Module[{notebookId, record, info, response},
  notebookId = Lookup[args, "notebookId", None];
  If[!StringQ[notebookId] || StringLength[notebookId] == 0, Return[Failure["BAD_REQUEST", <|"message" -> "notebookId is required."|>]]];
  record = NotebookRecord[notebookId];
  If[!AssociationQ[record] || record === <||>, Return[Failure["BAD_REQUEST", <|"message" -> "Requested notebook was not found."|>]]];
  info = Lookup[record, "info", <||>];
  $ActiveNotebookId = notebookId;
  $AttachedNotebook = Lookup[record, "notebook", None];
  $AttachedNotebookInfo = info;
  $CellMap = Lookup[record, "cellMap", <||>];
  $NextCellId = Lookup[record, "nextCellId", 1];
  response = Quiet @ Check[BridgePost["/notebooks/select", <|"notebookId" -> notebookId|>], Null];
  If[response === Null, <|"status" -> "selected", "notebookId" -> notebookId|>, <|"status" -> "selected", "notebookId" -> notebookId, "bridge" -> response|>]
];

PollCancellations[] := Module[{payload, requests},
  payload = BridgeGet["/cancellations"];
  If[payload === $Failed, Return[$Failed]];
  requests = Lookup[payload, "cancelRequests", {}];
  If[
    ListQ[requests] && (MemberQ[Lookup[#, "requestId", None] & /@ requests, $CurrentRequestId] || MemberQ[Lookup[#, "requestId", None] & /@ requests, $RunningRequestId]),
    CancelCurrentRequest[]
  ];
  payload
];

RegisterAgent[] := BridgePost[
  "/agents/register",
  <|
    "agentSessionId" -> $AgentSessionId,
    "wolframVersion" -> ToString[$VersionNumber],
    "platform" -> $OperatingSystem,
    "seenAt" -> UnixTimeMilliseconds[]
  |>
];

AgentHeartbeat[] := BridgePost[
  "/agents/heartbeat",
  <|
    "agentSessionId" -> $AgentSessionId,
    "seenAt" -> UnixTimeMilliseconds[]
  |>
];

NotebookHeartbeatPayload[nb_NotebookObject] := Module[{savedPath, windowTitle, displayName, frontendObjectKey},
  savedPath = Quiet @ Check[ToString[Replace[NotebookFileName[nb], $Failed -> ""]], ""];
  frontendObjectKey = FrontendObjectKey[nb];
  windowTitle = NotebookWindowTitle[nb];
  displayName = NotebookDisplayNameForHeartbeat[nb, savedPath, frontendObjectKey];
  <|
    "agentSessionId" -> $AgentSessionId,
    "frontendObjectKey" -> frontendObjectKey,
    "displayName" -> displayName,
    "windowTitle" -> windowTitle,
    "notebookPath" -> savedPath,
    "savedPath" -> savedPath,
    "wolframVersion" -> ToString[$VersionNumber],
    "platform" -> $OperatingSystem,
    "permissions" -> $BridgePermissions,
    "seenAt" -> UnixTimeMilliseconds[]
  |>
];

AgentNotebookCandidateQ[nb_NotebookObject] := Module[{frame, visible},
  frame = Quiet @ Check[CurrentValue[nb, WindowFrame], "Normal"];
  visible = Quiet @ Check[CurrentValue[nb, Visible], True];
  visible =!= False && !MemberQ[{"Palette", "ModalDialog", "ModelessDialog"}, frame]
];

AgentVisibleNotebooks[] := Module[{candidates},
  candidates = DeleteDuplicates @ Cases[
    Quiet @ Check[Notebooks[], {}],
    _NotebookObject
  ];
  Select[candidates, AgentNotebookCandidateQ]
];

AgentPostResult[requestId_String, result_Association] := BridgePost[
  "/requests/" <> URLComponentEncodeString[requestId] <> "/result",
  <|"requestId" -> requestId, "ok" -> True, "result" -> result|>
];

AgentPostFailure[requestId_String, code_String, message_String] := BridgePost[
  "/requests/" <> URLComponentEncodeString[requestId] <> "/result",
  <|"requestId" -> requestId, "ok" -> False, "error" -> <|"code" -> code, "message" -> message|> |>
];

AgentHeartbeatNotebookClosure[notebookId_String] := Module[{record = Lookup[$BridgeNotebooks, notebookId, <||>], response},
  If[!AssociationQ[record] || TrueQ[Lookup[record, "closed", False]] || Head[Lookup[record, "notebook", None]] =!= NotebookObject || !StringQ[Lookup[record, "frontendObjectKey", None]], Return[$Failed]];
  response = Quiet @ Check[BridgePost["/notebooks/" <> URLComponentEncodeString[notebookId] <> "/closed", <|"agentSessionId" -> $AgentSessionId|>], $Failed];
  If[AssociationQ[record] && AssociationQ[response] && TrueQ[Lookup[response, "ok", False]],
    If[!TrueQ[Lookup[record, "closed", False]],
      $BridgeNotebooks[notebookId] = Join[record, <|"closed" -> True|>]
    ]
  ];
  response
];

HeartbeatNotebooks[] := Module[{notebooks = AgentVisibleNotebooks[], visibleNotebookIds = {}, trackedNotebookIds, staleNotebookIds},
    trackedNotebookIds = Select[
      Keys[$BridgeNotebooks],
      Function[notebookId, Module[{record = Lookup[$BridgeNotebooks, notebookId, <||>]},
        AssociationQ[record] && !TrueQ[Lookup[record, "closed", False]] && Lookup[record, "agentSessionId", $AgentSessionId] === $AgentSessionId && Head[Lookup[record, "notebook", None]] === NotebookObject && StringQ[Lookup[record, "frontendObjectKey", None]]
      ]]
    ];
    Scan[
      Function[nb,
        Module[{payload, response, notebookId, existing, frontendObjectKey, info, cellMap, nextCellId, localNotebookId},
          localNotebookId = SelectFirst[
            Keys[$BridgeNotebooks],
            Function[candidateId, Module[{record = Lookup[$BridgeNotebooks, candidateId, <||>]},
              AssociationQ[record] && !TrueQ[Lookup[record, "closed", False]] && Lookup[record, "agentSessionId", $AgentSessionId] === $AgentSessionId && Lookup[record, "notebook", None] === nb && Head[Lookup[record, "notebook", None]] === NotebookObject && StringQ[Lookup[record, "frontendObjectKey", None]]
            ]],
            None
          ];
          If[StringQ[localNotebookId] && StringLength[localNotebookId] > 0, AppendTo[visibleNotebookIds, localNotebookId]];
          payload = NotebookHeartbeatPayload[nb];
          response = Quiet @ Check[BridgePost["/notebooks/heartbeat", payload], $Failed];
          If[AssociationQ[response],
            notebookId = Lookup[Lookup[response, "notebook", <||>], "notebookId", Lookup[response, "notebookId", None]];
            frontendObjectKey = Lookup[response, "frontendObjectKey", Lookup[payload, "frontendObjectKey", FrontendObjectKey[nb]]];
            info = Lookup[response, "info", Lookup[response, "notebookInfo", Lookup[response, "notebook", <||>]]];
            existing = Lookup[$BridgeNotebooks, notebookId, <||>];
            cellMap = Lookup[Lookup[response, "notebook", <||>], "cellMap", Lookup[response, "cellMap", Lookup[existing, "cellMap", <||>]]];
            nextCellId = Lookup[Lookup[response, "notebook", <||>], "nextCellId", Lookup[response, "nextCellId", Lookup[existing, "nextCellId", 1]]];
            If[StringQ[notebookId] && StringLength[notebookId] > 0,
              $BridgeNotebooks[notebookId] = Join[
                existing,
                <|
                  "notebook" -> nb,
                  "frontendObjectKey" -> frontendObjectKey,
                  "agentSessionId" -> $AgentSessionId,
                  "info" -> info,
                  "cellMap" -> cellMap,
                  "nextCellId" -> nextCellId,
                  "closed" -> False
                |>
              ];
              If[!MemberQ[visibleNotebookIds, notebookId], AppendTo[visibleNotebookIds, notebookId]]
            ]
          ]
        ]
      ],
      notebooks
    ];
    staleNotebookIds = Complement[trackedNotebookIds, visibleNotebookIds];
    Scan[AgentHeartbeatNotebookClosure, staleNotebookIds];
];

PollAgentRequest[] := BridgeGet["/agents/" <> URLComponentEncodeString[$AgentSessionId] <> "/next-request"];

EnsureAgentRegisteredForVisibleNotebooks[] := Module[{notebooks, heartbeat, reason},
  notebooks = AgentVisibleNotebooks[];
  If[Length[notebooks] == 0, Return[notebooks]];
  heartbeat = Quiet @ Check[AgentHeartbeat[], $Failed];
  reason = If[AssociationQ[heartbeat], Lookup[Lookup[heartbeat, "error", <||>], "reason", None], None];
  If[reason === "superseded", Return[notebooks]];
  If[!AssociationQ[heartbeat] || AssociationQ[Lookup[heartbeat, "error", None]],
    RegisterAgent[]
  ];
  notebooks
];

ExecuteAgentRequest[request_Association] := Module[{args = Lookup[request, "arguments", <||>], targetNotebookId, normalizedRequest},
  targetNotebookId = Lookup[request, "targetNotebookId", None];
  If[!AssociationQ[args], args = <||>];
  If[StringQ[targetNotebookId] && StringLength[targetNotebookId] > 0, AssociateTo[args, "notebookId" -> targetNotebookId]];
  normalizedRequest = Join[request, <|"arguments" -> args|>];
  Internal`WithLocalSettings[
    $AgentExecutionInProgress = True,
    ExecuteRequest[normalizedRequest],
    $AgentExecutionInProgress = False
  ]
];

SafeHiddenAgentTick[] := Module[{payload, request},
  If[TrueQ[$HiddenAgentInProgress], Return[$LastResultStatus]];
  Internal`WithLocalSettings[
    $HiddenAgentInProgress = True,
    (
    Block[{$BridgeHTTPTimeoutSeconds = 1, $BridgeHTTPRetryCount = 1},
      Quiet @ Check[EnsureAgentRegisteredForVisibleNotebooks[], Null];
      Quiet @ Check[HeartbeatNotebooks[], Null];
      payload = Quiet @ Check[PollAgentRequest[], $Failed];
    ];
    If[AssociationQ[payload],
      If[ListQ[Lookup[payload, "cancelRequests", {}]],
        Scan[
          Function[cancelRequest,
            If[StringQ[Lookup[cancelRequest, "requestId", None]] && (Lookup[cancelRequest, "requestId", None] === $CurrentRequestId || Lookup[cancelRequest, "requestId", None] === $RunningRequestId),
              CancelCurrentRequest[]
            ]
          ],
          Lookup[payload, "cancelRequests", {}]
        ]
      ];
      request = Lookup[payload, "request", None];
      If[AssociationQ[request], ExecuteAgentRequest[request]]
    ];
    Null
    ),
    $HiddenAgentInProgress = False
  ]
];

ControlNotebookOpenQ[nb_] := Head[nb] === NotebookObject && MemberQ[Quiet @ Check[Notebooks[], {}], nb];

ControlAgentFlagPath[key_String] := {TaggingRules, "MMAAgentBridge", key};

SetControlAgentFlag[key_String, value_] := Quiet @ Check[CurrentValue[$FrontEndSession, ControlAgentFlagPath[key]] = value, Null];

ClearControlAgentFlag[key_String] := SetControlAgentFlag[key, Inherited];

StopMMAAgentHiddenAgent[] := Module[{task = $HiddenAgentTask},
  If[task =!= None,
    Quiet @ Check[RemoveScheduledTask[task], Null]
  ];
  $HiddenAgentTask = None;
  $HiddenAgentInProgress = False;
  <|"status" -> "stopped"|>
];

StopMMAAgentControlKernel[] := Module[{nb = $ControlAgentNotebook},
  If[ControlNotebookOpenQ[nb], Quiet @ Check[NotebookClose[nb], Null]];
  $ControlAgentNotebook = None;
  ClearControlAgentFlag["AgentRunning"];
  <|"status" -> "closed"|>
];

EnsureControlEvaluator[evaluatorName_String] := Module[{before, beforeAssoc, localSpec, controlSpec, afterAssoc},
  before = Quiet @ Check[CurrentValue[$FrontEnd, EvaluatorNames], $Failed];
  If[before === $Failed, Return[BridgeFailure["EVALUATOR_CONFIG_FAILED", "Could not read FrontEnd evaluator configuration."]]];
  beforeAssoc = Association[before];
  If[KeyExistsQ[beforeAssoc, evaluatorName],
    Return[<|"status" -> "exists", "evaluatorName" -> evaluatorName, "spec" -> Lookup[beforeAssoc, evaluatorName]|>]
  ];
  localSpec = Lookup[beforeAssoc, "Local", {"AutoStartOnLaunch" -> False}];
  controlSpec = Append[DeleteCases[localSpec, HoldPattern["AutoStartOnLaunch" -> _]], "AutoStartOnLaunch" -> False];
  Quiet @ Check[
    CurrentValue[$FrontEnd, {EvaluatorNames, evaluatorName}] = controlSpec,
    Return[BridgeFailure["EVALUATOR_CONFIG_FAILED", "Failed to configure the control evaluator."]]
  ];
  afterAssoc = Association[CurrentValue[$FrontEnd, EvaluatorNames]];
  If[!KeyExistsQ[afterAssoc, evaluatorName],
    Return[BridgeFailure["EVALUATOR_CONFIG_FAILED", "The control evaluator was not present after configuration."]]
  ];
  <|"status" -> "created", "evaluatorName" -> evaluatorName, "spec" -> Lookup[afterAssoc, evaluatorName]|>
];

ControlAgentInitCode[permissions_Association] := Module[{source = $MMAAgentBridgeSourceFile},
  StringJoin[
    "Quiet @ Check[CurrentValue[$FrontEndSession, {TaggingRules, \"MMAAgentBridge\", \"ControlKernelBooting\"}] = Inherited, Null];\n",
    "If[StringQ[", ToString[source, InputForm], "] && FileExistsQ[", ToString[source, InputForm], "], Get[ToString[", ToString[source, InputForm], "]], Needs[\"MMAAgentBridge`\"]];\n",
    "MMAAgentBridge`Private`$BridgePermissions = ", ToString[permissions, InputForm], ";\n",
    "MMAAgentBridge`StartMMAAgentHiddenAgent[]"
  ]
];

StartMMAAgentControlKernel[evaluatorName_String:$ControlAgentEvaluatorName, stopCurrentAgent_:True] := Module[{evaluatorStatus, permissions, initCode},
  If[ControlNotebookOpenQ[$ControlAgentNotebook],
    Return[<|"status" -> "already_running", "evaluatorName" -> evaluatorName|>]
  ];
  SetControlAgentFlag["ControlKernelBooting", True];
  evaluatorStatus = EnsureControlEvaluator[evaluatorName];
  If[MatchQ[evaluatorStatus, _Failure],
    ClearControlAgentFlag["ControlKernelBooting"];
    Return[evaluatorStatus]
  ];
  permissions = $BridgePermissions;
  initCode = ControlAgentInitCode[permissions];
  If[TrueQ[stopCurrentAgent], StopMMAAgentHiddenAgent[]];
  $ControlAgentEvaluatorName = evaluatorName;
  $ControlAgentNotebook = CreateDocument[{Cell[BoxData[initCode], "Input", CellTags -> {"MMAAgentControlInit"}]}, Visible -> False, WindowTitle -> "MMA Agent Control Kernel", Saveable -> False, Evaluator -> evaluatorName];
  SelectionMove[$ControlAgentNotebook, All, Notebook];
  Quiet @ Check[FrontEndTokenExecute[$ControlAgentNotebook, "EvaluateCells"],
    Quiet @ Check[NotebookClose[$ControlAgentNotebook], Null];
    $ControlAgentNotebook = None;
    ClearControlAgentFlag["ControlKernelBooting"];
    Return[BridgeFailure["CONTROL_AGENT_START_FAILED", "Failed to evaluate the control agent initialization cell."]]
  ];
  SetControlAgentFlag["AgentRunning", True];
  <|"status" -> "started", "evaluatorName" -> evaluatorName, "evaluator" -> evaluatorStatus|>
];

StartMMAAgentHiddenAgent[] := Module[{},
  Block[{$BridgeHTTPTimeoutSeconds = 1, $BridgeHTTPRetryCount = 1},
    EnsureAgentRegisteredForVisibleNotebooks[];
    HeartbeatNotebooks[];
  ];
  If[$HiddenAgentTask === None || Not @ TrueQ @ Quiet @ Check[ScheduledTaskActiveQ[$HiddenAgentTask], False],
    $HiddenAgentTask = RunScheduledTask[SafeHiddenAgentTick[], 1]
  ];
  $HiddenAgentTask
];

usageString[sym_Symbol] := Quiet @ Check[ToString[sym::usage], "No usage information available."];

optionList[sym_Symbol] := Quiet @ Check[Map[<|"name" -> ToString[#[[1]]], "default" -> ToString[#[[2]]]|> &, Options[sym]], {}];

syntaxSummary[sym_Symbol] := Quiet @ Check[
  Replace[WolframLanguageData[SymbolName[sym], "SyntaxInformation"], _Missing -> <||>],
  <||>
];

relatedSymbols[sym_Symbol] := Quiet @ Check[
  Replace[
    Take[
      ToString /@ (WolframLanguageData[SymbolName[sym], "RelatedSymbols"] /. e_Entity :> e[[2]]),
      UpTo[10]
    ],
    _Missing -> {}
  ],
  {}
];

documentationURL[sym_Symbol] := Quiet @ Check["https://reference.wolfram.com/language/ref/" <> SymbolName[sym] <> ".html", ""];

SymbolDetail[sym_Symbol] := <|
  "status" -> "found",
  "symbol" -> SymbolName[sym],
  "usage" -> usageString[sym],
  "options" -> optionList[sym],
  "attributes" -> ToString /@ Attributes[sym],
  "syntax" -> syntaxSummary[sym],
  "related" -> relatedSymbols[sym],
  "url" -> documentationURL[sym]
|>;

SymbolCandidate[sym_String] := Module[{s},
  s = ToExpression[sym, StandardForm, Hold];
  <|"symbol" -> sym,
    "usage" -> StringTake[usageString[ReleaseHold[s]], UpTo[200]]
  |>
];

SymbolLookup[query_String] := Module[{sym, candidates, exactName},
  If[StringLength[StringTrim[query]] == 0,
    Return[<|"status" -> "bad_request", "message" -> "Query must not be empty."|>]
  ];
  exactName = "System`" <> query;
  If[Length[Names[exactName]] === 1,
    sym = ToExpression[exactName];
    Return @ SymbolDetail[sym]
  ];

  candidates = Names["System`*" <> query <> "*"];
  If[candidates === {},
    Return[<|"status" -> "not_found", "query" -> query,
      "message" -> "No System` symbols match '" <> query <> "'"|>]
  ];

  <|"status" -> "ambiguous", "query" -> query,
    "candidates" -> Map[SymbolCandidate, Take[candidates, UpTo[20]]]
  |>
];

ExecuteRequest[request_Association] := Module[{requestId, tool, args, result},
  requestId = Lookup[request, "requestId", None];
  If[!StringQ[requestId] || StringLength[requestId] == 0, Return[PostFailure["unknown", "BAD_REQUEST", "Request missing valid requestId."]]];
  tool = Lookup[request, "tool", None];
  args = Lookup[request, "arguments", <||>];
  Internal`WithLocalSettings[
    $CurrentRequestId = requestId,
    result = Quiet @ Check[
      Which[
        !StringQ[tool], Failure["BAD_REQUEST", <|"Message" -> "Request missing valid tool."|>],
        !AssociationQ[args], Failure["BAD_REQUEST", <|"Message" -> "Request arguments must be an association."|>],
        True,
        Switch[tool,
          "mma_list_cells", If[RequireReadPermission[] === $Canceled, $Canceled, Module[{notebookId = TargetNotebookId[args], refresh}, If[!StringQ[notebookId] || StringLength[notebookId] == 0, Failure["BAD_REQUEST", <|"Message" -> "No notebook is selected."|>], refresh = RefreshCellMap[notebookId]; If[MatchQ[refresh, _Failure], refresh, <|"cells" -> refresh|>]]]],
          "mma_read_cell", ReadCellById[args],
          "mma_insert_cell", InsertCellRequest[args],
          "mma_modify_cell", ModifyCellRequest[args],
          "mma_delete_cell", DeleteCellRequest[args],
          "mma_run_cell", RunCellRequest[args],
          "mma_abort_evaluation", AbortEvaluationRequest[args],
          "mma_get_cell_output", GetCellOutputById[args],
          "mma_save_notebook", SaveNotebookRequest[args],
          "mma_select_notebook", SelectNotebookRequest[args],
          "mma_symbol_lookup", SymbolLookup[Lookup[args, "query", ""]],
          _, Failure["BAD_REQUEST", <|"Message" -> StringTemplate["Unknown tool ``."][tool]|>]
        ]
      ],
      $Failed
    ];
    Which[
      result === $Canceled,
        PostFailure[requestId, "USER_DENIED", "User denied or cancelled the operation."],
      MatchQ[result, Failure[_, _Association]],
        PostFailure[requestId, FailedRequestCode[result], FailedRequestMessage[result]],
      result === $Failed,
        PostFailure[requestId, "WOLFRAM_ERROR", "The Wolfram bridge failed to execute the request."],
      True,
        PostResult[requestId, result]
    ],
    $CurrentRequestId = None
  ]
];

PollBridge[] := Module[{payload, request, status, cancelRequests, requestIds, queueResult},
  payload = BridgeGet["/poll?paletteId=" <> URLComponentEncodeString[$PaletteId] <> "&activeNotebookId=" <> URLComponentEncodeString[$ActiveNotebookId]];
  $LastPollTime = AbsoluteTime[];
  If[payload === $Failed,
    $LastError = "Bridge unavailable";
    Return[$Failed]
  ];
  $LastError = None;
  CheckRunningTimeout[];
  If[AssociationQ[payload],
    status = Lookup[payload, "status", None];
    If[AssociationQ[status], $LastStatus = status];
    cancelRequests = Lookup[payload, "cancelRequests", {}];
    If[ListQ[cancelRequests],
      requestIds = Lookup[#, "requestId", None] & /@ cancelRequests;
      If[MemberQ[requestIds, $CurrentRequestId] || MemberQ[requestIds, $RunningRequestId], CancelCurrentRequest[]]
    ];
    request = Lookup[payload, "request", None];
    If[AssociationQ[request],
      queueResult = EnqueueBridgeRequest[request];
      AssociateTo[payload, "status" -> "queued", "queueResult" -> queueResult],
      payload
    ],
    payload
  ]
];

End[];

EndPackage[];
