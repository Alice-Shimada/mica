import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../paclet/Kernel/MMAAgentBridge.wl", import.meta.url), "utf8");
const launcherPath = new URL("../paclet/FrontEnd/Palettes/MMAAgentBridge.nb", import.meta.url);

const countOccurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("MMAAgentBridge Wolfram notebook dispatcher", () => {
  it("defines the notebook registry helpers and routing wiring", () => {
    const requiredSnippets = [
      '$BridgeNotebooks = <||>',
      '$ActiveNotebookId = None',
      '$PaletteId = CreateUUID["palette-"]',
      'NotebookIdFor[nb_NotebookObject]',
      'NotebookInfo[nb_NotebookObject, notebookId_String]',
      'NotebookRecord[notebookId_String]',
      'TargetNotebookId[args_Association]',
      'ActiveNotebookRecord[]',
      'RegisterCurrentNotebook[]',
      'AttachCurrentNotebook[] := RegisterCurrentNotebook[]',
      "CellContentString[cell_CellObject]",
      "CellStyleName[cell_CellObject]",
      "CellTagsList[cell_CellObject]",
      "CellPayload[cell_CellObject, id_String, index_Integer]",
      '"tags" -> CellTagsList[cell]',
      "RefreshCellMap[notebookId_String]",
      "GetCellOutputById[args_Association]",
      "ReadCellById[args_Association]",
      "InsertCellRequest[args_Association]",
      "ModifyCellRequest[args_Association]",
      "DeleteCellRequest[args_Association]",
      "RunCellRequest[args_Association]",
      "SaveNotebookRequest[args_Association]",
      'AgentHeartbeatNotebookClosure[notebookId_String]',
      "PollCancellations[]",
      'ConfirmAction["ReadNotebook"',
      '$NextCellId',
      '$RunningCellId',
      '$RunningNotebookId',
      '$RunningNotebookObject',
      '$RunningCellObject',
      '$RunningCellOriginalEpilogRule',
      '$RunningCellRestoreEpilogRule',
      '$RunningStartedAt',
      '$RunningStatusGraceSeconds',
      '$RunningTimeoutAt',
      '$LastRunStatusCellId',
      '$LastRunStatusNotebookId',
      '$LastRunStatus',
      '$PollingInProgress',
      '$MaxArtifactScanCells',
      'NotebookIdForObject[nb_NotebookObject]',
      'CheckRunningTimeout[]',
      'CellGeneratedBoundaryQ[style_String] := MemberQ[{"Input", "Code", "Text", "Section", "Subsection", "Subsubsection", "Title", "Chapter"}, style]',
      'CellArtifactStyleQ[style_String] := MemberQ[{"Output", "Print", "Message"}, style]',
      'CellArtifactScan[cell_CellObject, cellId_String:"", notebook_:Automatic]',
      'CellEvaluationTaggingPath[cellId_String]',
      'FinishRunningCell[status_String]',
      'AssociationThread[Values[Lookup[record, "cellMap", <||>]], Keys[Lookup[record, "cellMap", <||>]]]',
      'Failure["BAD_REQUEST", <|"Message" ->',
      '$RunningRequestId',
      'status = Which[',
      'following = Take[cells, {First[position] + 1, Min[Length[cells], First[position] + $MaxArtifactScanCells]}]',
      'TakeWhile[following, CellArtifactStyleQ[CellStyleName[#]] &]',
      'AbsoluteTime[] - $RunningStartedAt < $RunningStatusGraceSeconds',
      'NumberQ[$RunningTimeoutAt] && AbsoluteTime[] >= $RunningTimeoutAt',
      '$LastRunStatusNotebookId = notebookId',
      'hasFinalOutputQ',
      'hasArtifactsQ',
      'sameRunningCellQ && (evaluationCompleteQ || hasFinalOutputQ)',
      'NotebookIdForObject[nb] === $LastRunStatusNotebookId',
      'ClearRunningEvaluationState[]',
      '$LastRunStatusCellId = None;',
      '$LastRunStatus = None;',
      'SafePollBridge[] := Module[{result = $Failed}',
      'PollBridge[]',
      'StringQ[cellId] && StringQ[$RunningCellId] && cellId === $RunningCellId',
      'timeoutSec',
      '"finished"',
      'If[MatchQ[refresh, _Failure], refresh, <|"cells" -> refresh|>]',
      'CellArtifactScan[cell, cellId, Lookup[record, "notebook", None]]',
      '$RunningNotebookId = notebookId;',
      '$RunningNotebookObject = notebook;',
      'GetCellOutputById[args]',
      '"mma_insert_cell"',
      '"mma_get_cell_output"',
      '"mma_save_notebook"',
      '"mma_select_notebook"',
      "$CurrentRequestId = None;",
      "$RunningRequestId = None;"
    ];

    for (const snippet of requiredSnippets) {
      expect(source).toContain(snippet);
    }

    expect(source).not.toContain('Internal`WithLocalSettings[$AttachedNotebook = Lookup[record, "notebook", None], CellArtifactScan');
    expect(source).not.toContain('CellArtifactScan[cell, cellId], Null');
    expect(source).not.toContain("HoldForm");
  });

  it("stores and clears notebook-scoped running state", () => {
    expect(source).toContain('$RunningNotebookId = notebookId;');
    expect(source).toContain('$RunningNotebookObject = notebook;');
    expect(source).toContain('$LastRunStatusNotebookId = None;');
    expect(source).toContain('Head[$RunningNotebookObject] === NotebookObject');
    expect(source).toContain('FrontEndTokenExecute[$RunningNotebookObject, "EvaluatorAbort"]');
    expect(source).toContain('If[$AttachedNotebook =!= None, Quiet @ Check[FrontEndTokenExecute[$AttachedNotebook, "EvaluatorAbort"], Null]]');
    expect(source).toContain('$RunningNotebookId = None;');
    expect(source).toContain('$RunningNotebookObject = None;');
    expect(source).toContain('$LastRunStatusNotebookId = None;');
  });

  it("supports abort evaluation requests and marks running cells aborted", () => {
    const abortStart = source.indexOf("AbortEvaluationRequest[args_Association]");
    const abortEnd = source.indexOf("SaveNotebookRequest[args_Association]", abortStart);
    const abortBody = source.slice(abortStart, abortEnd);

    expect(abortStart).toBeGreaterThanOrEqual(0);
    expect(source).toContain("AbortEvaluationRequest[args_Association]");
    expect(source).toContain('FrontEndTokenExecute[notebook, "EvaluatorAbort"]');
    expect(source).toContain('"mma_abort_evaluation", AbortEvaluationRequest[args]');
    expect(abortBody).toContain('CellEvaluationCompleteQ[notebook, runningCellId]');
    expect(abortBody).toContain('FinishRunningCell["finished"]');
    expect(abortBody).toContain('<|"status" -> "finished", "cellId" -> runningCellId, "requestId" -> runningRequestId|>');
    expect(abortBody).toContain('FinishRunningCell["aborted"]');
    expect(abortBody).toContain('<|"status" -> "aborted", "cellId" -> runningCellId, "requestId" -> runningRequestId|>');
    expect(abortBody).toContain('If[wasRunning && StringQ[runningCellId] && CellEvaluationCompleteQ[notebook, runningCellId]');
    expect(abortBody.indexOf('FinishRunningCell["finished"]')).toBeGreaterThanOrEqual(0);
    expect(abortBody.indexOf('FinishRunningCell["aborted"]')).toBeGreaterThan(abortBody.indexOf('FinishRunningCell["finished"]'));
  });

  it("keeps cancellation status when a running cell exists", () => {
    const cancelStart = source.indexOf("CancelCurrentRequest[] := Module");
    const cancelEnd = source.indexOf("StartMMAAgentPalette[] := Module", cancelStart);
    const cancelBody = source.slice(cancelStart, cancelEnd);

    expect(cancelStart).toBeGreaterThanOrEqual(0);
    expect(cancelBody).toContain('FinishRunningCell["aborted"]');
    expect(cancelBody).toContain('FinishRunningCell["finished"]');
    expect(cancelBody).not.toContain('$LastRunStatusCellId = None; $LastRunStatusNotebookId = None; $LastRunStatus = None;');
  });

  it("keeps PollCancellations as a backward-compatible helper", () => {
    const helperStart = source.indexOf("PollCancellations[] := Module");
    const helperEnd = source.indexOf("ExecuteRequest[request_Association] := Module", helperStart);
    const helperBody = source.slice(helperStart, helperEnd);

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperBody).toContain('BridgeGet["/cancellations"]');
    expect(helperBody).toContain('CancelCurrentRequest[]');
    expect(helperBody).not.toContain('BridgeGet["/poll');
  });

  it("retries transient bridge HTTP failures before declaring the bridge unavailable", () => {
    const requiredSnippets = [
      "$BridgeHTTPTimeoutSeconds",
      "$BridgeHTTPRetryCount",
      "$BridgeHTTPRetryDelaySeconds",
      "BridgeRequestWithRetries[request_] :=",
      "TimeConstraint -> $BridgeHTTPTimeoutSeconds",
      "Pause[$BridgeHTTPRetryDelaySeconds]",
      "BridgeRequestWithRetries[HTTPRequest[BridgeURL[path]"
    ];

    for (const snippet of requiredSnippets) {
      expect(source).toContain(snippet);
    }
  });

  it("decodes bridge JSON responses from raw bytes as UTF-8 for Unicode payloads", () => {
    const requestStart = source.indexOf("BridgeRequestWithRetries[request_] :=");
    const getStart = source.indexOf("BridgeGet[path_String] :=");
    const postStart = source.indexOf("BridgePost[path_String, payload_Association] :=");
    const requestBody = source.slice(requestStart, getStart);
    const jsonHelperStart = source.indexOf("JsonByteArrayToPayload[body_ByteArray] :=");
    const jsonHelperEnd = source.indexOf("BridgeGet[path_String] :=", jsonHelperStart);
    const jsonHelperBody = source.slice(jsonHelperStart, jsonHelperEnd);
    const getBody = source.slice(getStart, postStart);
    const postBody = source.slice(postStart, source.indexOf("PostPermissions[]", postStart));

    expect(requestBody).toContain('{"StatusCode", "BodyByteArray"}');
    expect(jsonHelperStart).toBeGreaterThanOrEqual(0);
    expect(jsonHelperBody).toContain('ByteArrayToString[body]');
    expect(jsonHelperBody).toContain('ImportString[text, "RawJSON"]');
    expect(getBody).toContain('JsonByteArrayToPayload[response["BodyByteArray"]]');
    expect(postBody).toContain('JsonByteArrayToPayload[response["BodyByteArray"]]');
    expect(getBody).not.toContain('response["Body"]');
    expect(postBody).not.toContain('response["Body"]');
  });

  it("encodes poll query values without InputForm quoting", () => {
    expect(source).toContain('URLComponentEncodeString[None] := ""');
    expect(source).toContain('URLComponentEncodeString[value_] := StringReplace[');
    expect(source).toContain('ToString[value]');
    expect(source).not.toContain('ToString[value, InputForm]');
  });

  it("clears stale bridge errors after a successful request poll", () => {
    const failureIndex = source.indexOf('$LastError = "Bridge unavailable"');
    const clearIndex = source.indexOf("$LastError = None", failureIndex + 1);
    const requestLookupIndex = source.indexOf('request = Lookup[payload, "request", None]', failureIndex + 1);

    expect(failureIndex).toBeGreaterThanOrEqual(0);
    expect(clearIndex).toBeGreaterThan(failureIndex);
    expect(requestLookupIndex).toBeGreaterThan(clearIndex);
  });

  it("polls the bridge through the consolidated /poll endpoint", () => {
    const pollStart = source.lastIndexOf("PollBridge[] := Module");
    const pollEnd = source.indexOf("End[];", pollStart);
    const pollBody = source.slice(pollStart, pollEnd);

    expect(pollStart).toBeGreaterThanOrEqual(0);
    expect(pollBody).toContain('BridgeGet["/poll?paletteId="');
    expect(pollBody).not.toContain('BridgeGet["/status"]');
    expect(pollBody).not.toContain('BridgeGet["/requests"]');
    expect(pollBody).not.toContain('PollCancellations[]');
  });

  it("inserts cells by notebook location instead of replacing the anchor cell", () => {
    const insertStart = source.indexOf("InsertCellRequest[args_Association]");
    const modifyStart = source.indexOf("ModifyCellRequest[args_Association]");
    const insertBody = source.slice(insertStart, modifyStart);

    expect(insertStart).toBeGreaterThanOrEqual(0);
    expect(modifyStart).toBeGreaterThan(insertStart);
    expect(source).toContain('NotebookWrite[NotebookLocationSpecifier[anchor, "After"], newCell, None]');
    expect(insertBody).toContain("InsertCellAtLocation[notebook, anchor, newCell]");
    expect(insertBody).toContain("InsertCellAtLocation[notebook, Last[cells], newCell]");
    expect(insertBody).toContain("RefreshCellMap[notebookId]");
    expect(insertBody).not.toContain("NotebookWrite[Lookup[record, \"cellMap\", <||>][afterId], newCell, After]");
    expect(insertBody).not.toContain("NotebookWrite[Last[cells], newCell, After]");
  });

  it("uses non-replacing notebook writes and verifies insertion increased cell count", () => {
    const insertLocationStart = source.indexOf("InsertCellAtLocation[notebook_NotebookObject, anchor_CellObject, newCell_]");
    const insertBeginningStart = source.indexOf("InsertCellAtBeginning[notebook_NotebookObject, newCell_]");
    const insertRequestStart = source.indexOf("InsertCellRequest[args_Association]");
    const insertLocationBody = source.slice(insertLocationStart, insertBeginningStart);
    const insertRequestBody = source.slice(insertRequestStart, source.indexOf("ModifyCellRequest[args_Association]"));

    expect(insertLocationStart).toBeGreaterThanOrEqual(0);
    expect(insertBeginningStart).toBeGreaterThan(insertLocationStart);
    expect(insertLocationBody).toContain('NotebookWrite[NotebookLocationSpecifier[anchor, "After"], newCell, None]');
    expect(insertLocationBody).toContain("beforeCount = Length[Cells[notebook]]");
    expect(insertLocationBody).toContain("afterCount = Length[Cells[notebook]]");
    expect(insertLocationBody).toContain("afterCount <= beforeCount");
    expect(insertLocationBody).not.toContain("NotebookWrite[notebook, newCell]");
    expect(insertRequestBody).toContain("inserted = InsertCellAtLocation[notebook, anchor, newCell]");
    expect(insertRequestBody).toContain("If[MatchQ[inserted, _Failure], Return[inserted]]");
  });

  it("keeps insert compatible with Wolfram versions before NotebookLocationSpecifier", () => {
    expect(source).toContain("InsertCellAtLocation[notebook_NotebookObject, anchor_CellObject, newCell_]");
    expect(source).toContain('NameQ["System`NotebookLocationSpecifier"]');
    expect(source).toContain("SelectionMove[anchor, After, Cell]");
    expect(source).toContain("NotebookWrite[notebook, newCell, None]");
  });

  it("posts JSON payloads as explicit UTF-8 bytes for Unicode cell contents", () => {
    const bridgePostStart = source.indexOf("BridgePost[path_String, payload_Association]");
    const bridgePostEnd = source.indexOf("PostPermissions[]", bridgePostStart);
    const bridgePostBody = source.slice(bridgePostStart, bridgePostEnd);

    expect(source).toContain("PayloadToJsonBytes[payload_Association]");
    expect(source).toContain('ExportByteArray[payload, "RawJSON"]');
    expect(source).not.toContain('ToCharacterCode[ExportString[payload, "RawJSON"], "UTF8"]');
    expect(bridgePostBody).toContain('"ContentType" -> "application/json; charset=utf-8"');
    expect(bridgePostBody).toContain('"Body" -> PayloadToJsonBytes[payload]');
  });

  it("allows the MCP-required afterCellId field to request append-at-end", () => {
    const insertStart = source.indexOf("InsertCellRequest[args_Association]");
    const modifyStart = source.indexOf("ModifyCellRequest[args_Association]");
    const insertBody = source.slice(insertStart, modifyStart);

    expect(insertStart).toBeGreaterThanOrEqual(0);
    expect(modifyStart).toBeGreaterThan(insertStart);
    expect(insertBody).toContain('If[afterId === "__end__", afterId = None]');
    expect(insertBody).toContain('If[StringQ[afterId],');
  });

  it("bootstraps the first cell into an empty notebook automatically", () => {
    const insertStart = source.indexOf("InsertCellRequest[args_Association]");
    const modifyStart = source.indexOf("ModifyCellRequest[args_Association]");
    const insertBody = source.slice(insertStart, modifyStart);

    expect(insertStart).toBeGreaterThanOrEqual(0);
    expect(modifyStart).toBeGreaterThan(insertStart);
    expect(source).toContain('InsertCellAtBeginning[notebook_NotebookObject, newCell_]');
    expect(source).toContain('SelectionMove[notebook, Before, Notebook]');
    expect(source).toContain('NotebookWrite[notebook, newCell, None]');
    expect(insertBody).toContain('InsertCellAtBeginning[notebook, newCell]');
    expect(insertBody).toContain('If[Length[cells] > 0,');
    expect(insertBody).not.toContain('Failure["EMPTY_NOTEBOOK"');
    expect(insertBody).not.toContain('Create one placeholder cell manually, then retry insertion.');
  });

  it("hard-detects empty notebooks before validating a provided afterCellId", () => {
    const insertStart = source.indexOf("InsertCellRequest[args_Association]");
    const modifyStart = source.indexOf("ModifyCellRequest[args_Association]");
    const insertBody = source.slice(insertStart, modifyStart);
    const cellsIndex = insertBody.indexOf("cells = Cells[notebook];");
    const stringAfterIndex = insertBody.indexOf("If[StringQ[afterId],");

    expect(insertStart).toBeGreaterThanOrEqual(0);
    expect(modifyStart).toBeGreaterThan(insertStart);
    expect(insertBody).toContain("InsertCellAtBeginning[notebook, newCell]");
    expect(insertBody).toContain("If[StringQ[afterId] && Length[cells] == 0,");
    expect(cellsIndex).toBeGreaterThanOrEqual(0);
    expect(stringAfterIndex).toBeGreaterThan(cellsIndex);
  });

  it("does not synchronously rescan output artifacts after modify/delete operations", () => {
    const insertStart = source.indexOf("InsertCellRequest[args_Association]");
    const modifyStart = source.indexOf("ModifyCellRequest[args_Association]");
    const deleteStart = source.indexOf("DeleteCellRequest[args_Association]");
    const runStart = source.indexOf("RunCellRequest[args_Association]");

    expect(insertStart).toBeGreaterThanOrEqual(0);
    expect(modifyStart).toBeGreaterThan(insertStart);
    expect(deleteStart).toBeGreaterThan(modifyStart);
    expect(runStart).toBeGreaterThan(deleteStart);

    expect(source.slice(modifyStart, deleteStart)).not.toContain("RefreshCellMap[]");
    expect(source.slice(deleteStart, runStart)).not.toContain("RefreshCellMap[]");
  });

  it("keeps modified cells addressable by updating the existing cell id mapping", () => {
    const modifyStart = source.indexOf("ModifyCellRequest[args_Association]");
    const deleteStart = source.indexOf("DeleteCellRequest[args_Association]");
    const modifyBody = source.slice(modifyStart, deleteStart);

    expect(modifyStart).toBeGreaterThanOrEqual(0);
    expect(deleteStart).toBeGreaterThan(modifyStart);
    expect(modifyBody).toContain('cellMap = Lookup[record, "cellMap", <||>]');
    expect(modifyBody).toContain('cellIndex = FirstPosition[cells, cell, Missing["NotFound"]]');
    expect(modifyBody).toContain("updatedCells = Cells[notebook]");
    expect(modifyBody).toContain("AssociateTo[cellMap, cellId -> updatedCell]");
    expect(modifyBody).toContain('"cellMap" -> cellMap');
    expect(modifyBody).not.toContain("RefreshCellMap[notebookId]");
  });

  it("routes notebook operations through notebook ids", () => {
    expect(source).toContain('TargetNotebookId[args_Association]');
    expect(source).toContain('Lookup[args, "notebookId", None]');
    expect(source).toContain('RefreshCellMap[notebookId]');
    expect(source).toContain('NotebookRecord[notebookId]');
    expect(source).toContain('DeleteCellRequest[args_Association] := Module[{notebookId, record');
    expect(source).toContain('mma_select_notebook');
  });

  it("keeps list-cells refresh lightweight by not scanning output artifacts", () => {
    const refreshStart = source.indexOf("RefreshCellMap[notebookId_String] :=");
    const readStart = source.indexOf("ReadCellById[args_Association]");

    expect(refreshStart).toBeGreaterThanOrEqual(0);
    expect(readStart).toBeGreaterThan(refreshStart);
    expect(source.slice(refreshStart, readStart)).not.toContain("CellArtifactScan");
  });

  it("prefers grace before artifact-driven completion", () => {
    const graceIndex = source.indexOf('NumberQ[$RunningStartedAt] && (AbsoluteTime[] - $RunningStartedAt < $RunningStatusGraceSeconds)');
    const outputIndex = source.indexOf('sameRunningCellQ && (evaluationCompleteQ || hasFinalOutputQ)');

    expect(graceIndex).toBeGreaterThanOrEqual(0);
    expect(outputIndex).toBeGreaterThanOrEqual(0);
    expect(graceIndex).toBeLessThan(outputIndex);
  });

  it("uses a CellEpilog completion flag so no-output evaluations can finish", () => {
    const scanStart = source.indexOf("CellArtifactScan[cell_CellObject");
    const refreshStart = source.indexOf("RefreshCellMap[notebookId_String]", scanStart);
    const scanBody = source.slice(scanStart, refreshStart);
    const runStart = source.indexOf("RunCellRequest[args_Association]");
    const saveStart = source.indexOf("SaveNotebookRequest[args_Association]", runStart);
    const runBody = source.slice(runStart, saveStart);

    expect(source).toContain('CellEvaluationTaggingPath[cellId_String] := {TaggingRules, "MMAAgentBridge", "evaluations", cellId, "complete"}');
    expect(source).toContain("MarkCellEvaluationComplete[cellId_String]");
    expect(source).toContain("CellEvaluationCompleteQ[notebook_NotebookObject, cellId_String]");
    expect(source).toContain("InstallRunningCellEpilog[cell_CellObject, cellId_String]");
    expect(source).toContain("CellEffectiveEpilogOptionRule[cell_CellObject]");
    expect(source).toContain("RunOriginalCellEpilog[heldOriginalEpilogRule]");
    expect(source).toContain("Internal`WithLocalSettings[");
    expect(source).toContain("CellEpilog :>");
    expect(source).toContain("MarkCellEvaluationComplete[targetCellId]");
    expect(scanBody).toContain("evaluationCompleteQ");
    expect(scanBody).toContain("sameRunningCellQ && (evaluationCompleteQ || hasFinalOutputQ)");
    expect(runBody).toContain("ClearCellEvaluationComplete[notebook, cellId]");
    expect(runBody).toContain("installedEpilog = InstallRunningCellEpilog[cell, cellId]");
  });

  it("restores temporary CellEpilog state and remembers finished no-output runs", () => {
    const scanStart = source.indexOf("CellArtifactScan[cell_CellObject");
    const refreshStart = source.indexOf("RefreshCellMap[notebookId_String]", scanStart);
    const scanBody = source.slice(scanStart, refreshStart);

    expect(source).toContain("$RunningCellObject = None");
    expect(source).toContain("$RunningCellOriginalEpilogRule = HoldComplete[CellEpilog -> Inherited]");
    expect(source).toContain("$RunningCellRestoreEpilogRule = HoldComplete[CellEpilog -> Inherited]");
    expect(source).toContain("CellEpilogOptionRule[cell_CellObject]");
    expect(source).toContain("RunOriginalCellEpilog[HoldComplete[CellEpilog -> value_]]");
    expect(source).toContain("RunOriginalCellEpilog[HoldComplete[CellEpilog :> value_]]");
    expect(source).not.toContain("RunOriginalCellEpilog[HoldComplete[CellEpilog -> value_]] := Quiet");
    expect(source).toContain("RestoreCellEpilogOption[cell_CellObject, HoldComplete[CellEpilog -> value_]]");
    expect(source).toContain("SetOptions[cell, CellEpilog :> Unevaluated[value]]");
    expect(source).toContain("Immediate CellEpilog rules have already evaluated by the time Options returns them");
    expect(source).toContain("Inherited CellEpilog is captured as an effective value before installing the bridge epilog");
    expect(source).toContain("RestoreRunningCellEpilog[]");
    expect(source).toContain("RestoreCellEpilogOption[$RunningCellObject, $RunningCellRestoreEpilogRule]");
    expect(source).toContain("FinishRunningCell[status_String]");
    expect(source).toContain("$LastRunStatus = status");
    expect(scanBody).toContain('StringQ[cellId] && StringQ[$LastRunStatusCellId] && cellId === $LastRunStatusCellId && StringQ[$LastRunStatusNotebookId] && NotebookIdForObject[nb] === $LastRunStatusNotebookId && $LastRunStatus === "finished"');
    expect(scanBody).toContain('FinishRunningCell["finished"]; "finished"');
  });

  it("deletes generated output artifacts that belong to the deleted input cell", () => {
    const deleteStart = source.indexOf("DeleteCellRequest[args_Association]");
    const runStart = source.indexOf("RunCellRequest[args_Association]", deleteStart);
    const deleteBody = source.slice(deleteStart, runStart);

    expect(source).toContain("CellGeneratedArtifactQ[cell_CellObject]");
    expect(source).toContain("CurrentValue[cell, GeneratedCell]");
    expect(source).toContain("GeneratedArtifactsAfterCell[cell_CellObject, notebook_:Automatic]");
    expect(deleteBody).toContain("artifacts = GeneratedArtifactsAfterCell[cell, notebook]");
    expect(deleteBody).toContain("artifactIds = Keys @ Select[cellMap, MemberQ[artifacts, #] &]");
    expect(deleteBody).toContain("Scan[NotebookDelete, Reverse[artifacts]]");
    expect(deleteBody).toContain("NotebookDelete[cell]");
    expect(deleteBody).toContain("KeyDrop[cellMap, Join[{cellId}, artifactIds]]");
    expect(deleteBody).toContain('"deletedArtifactCount" -> Length[artifacts]');
  });

  it("only deletes generated artifacts for cells that can own generated outputs", () => {
    const artifactOwnerStart = source.indexOf("CellOwnsGeneratedArtifactsQ[style_String]");
    const generatedStart = source.indexOf("GeneratedArtifactsAfterCell[cell_CellObject, notebook_:Automatic]");
    const timeoutStart = source.indexOf("CheckRunningTimeout[]", generatedStart);
    const generatedBody = source.slice(generatedStart, timeoutStart);

    expect(artifactOwnerStart).toBeGreaterThanOrEqual(0);
    expect(source).toContain('CellOwnsGeneratedArtifactsQ[style_String] := MemberQ[{"Input", "Code"}, style]');
    expect(generatedStart).toBeGreaterThan(artifactOwnerStart);
    expect(timeoutStart).toBeGreaterThan(generatedStart);
    expect(generatedBody).toContain("If[!CellOwnsGeneratedArtifactsQ[CellStyleName[cell]], Return[{}]]");
    expect(generatedBody.indexOf("If[!CellOwnsGeneratedArtifactsQ[CellStyleName[cell]], Return[{}]]")).toBeLessThan(generatedBody.indexOf("cells = Cells[nb]"));
  });

  it("only attributes generated output artifacts to cells that can own them", () => {
    const scanStart = source.indexOf("CellArtifactScan[cell_CellObject");
    const refreshStart = source.indexOf("RefreshCellMap[notebookId_String]", scanStart);
    const scanBody = source.slice(scanStart, refreshStart);

    expect(scanStart).toBeGreaterThanOrEqual(0);
    expect(refreshStart).toBeGreaterThan(scanStart);
    expect(scanBody).toContain('If[!CellOwnsGeneratedArtifactsQ[CellStyleName[cell]], Return[<|"outputs" -> {}, "messages" -> {}, "status" -> "unknown"|>]]');
    expect(scanBody.indexOf('If[!CellOwnsGeneratedArtifactsQ[CellStyleName[cell]], Return[<|"outputs" -> {}, "messages" -> {}, "status" -> "unknown"|>]]')).toBeLessThan(scanBody.indexOf("following = Take[cells"));
  });

  it("defines the palette UI and palette launcher", () => {
    const requiredSnippets = [
      'StartMMAAgentPalette[]',
      'CreatePalette[PaletteView[]',
      'WindowTitle -> "MMA Agent Bridge"',
      'Saveable -> False',
      'PaletteView[] :=',
      'PaletteStatusSummary[] := Module[{server, paletteConnected, notebookAttached, pendingRequests, attachedNotebook, error}',
      'PalettePermissionRow["Read notebook", "ReadNotebook"]',
      'PalettePermissionRow["Insert cell", "InsertCell"]',
      'PalettePermissionRow["Modify cell", "ModifyCell"]',
      'PalettePermissionRow["Delete cell", "DeleteCell"]',
      'PalettePermissionRow["Run cell", "RunCell"]',
      'PalettePermissionRow["Save notebook", "SaveNotebook"]',
      'Dynamic[$BridgePermissions[key],',
      '$BridgePermissions[key] = #;',
      'PostPermissions[] := Module[',
      'BridgePost["/permissions"',
      'Style["MMA Agent Bridge", 16, Bold]',
      'Poll now',
      'Cancel Running Request',
      'PollHeartbeat[]',
      'UpdateInterval -> 1',
      'SynchronousUpdating -> False',
      'server = Lookup[$LastStatus, "server", "unknown"]',
      'paletteConnected = TrueQ @ Lookup[$LastStatus, "paletteConnected", False]',
      'notebookAttached = TrueQ @ Lookup[$LastStatus, "notebookAttached", False]',
      'pendingRequests = Max[Lookup[$LastStatus, "pendingRequests", 0], Length[$BridgeInbox]]'
    ];

    for (const snippet of requiredSnippets) {
      expect(source).toContain(snippet);
    }
  });

  it("reports notebook closures from the hidden agent heartbeat", () => {
    const requiredSnippets = [
      'BridgePost["/notebooks/" <> URLComponentEncodeString[notebookId] <> "/closed", <|"agentSessionId" -> $AgentSessionId|>]',
      'visibleNotebookIds = {}',
      'trackedNotebookIds = Select[',
      'Function[notebookId, Module[',
      '!AssociationQ[record] || TrueQ[Lookup[record, "closed", False]] || Head[Lookup[record, "notebook", None]] =!= NotebookObject || !StringQ[Lookup[record, "frontendObjectKey", None]]',
      'Head[Lookup[record, "notebook", None]] === NotebookObject',
      'StringQ[Lookup[record, "frontendObjectKey", None]]',
      'staleNotebookIds = Complement[trackedNotebookIds, visibleNotebookIds];',
      'Scan[AgentHeartbeatNotebookClosure, staleNotebookIds];'
    ];

    for (const snippet of requiredSnippets) {
      expect(source).toContain(snippet);
    }

    expect(source).not.toContain('Complement[Keys[$BridgeNotebooks], seenNotebookIds]');
  });

  it("attaches and posts permissions with notebook updates", () => {
    expect(source).toContain('"permissions" -> $BridgePermissions');
    expect(source).toContain('Quiet @ Check[PostPermissions[], Null]');
    expect(source).toContain('$BridgePermissions[key] = #;');
  });

  it("includes a textual paclet palette launcher notebook", () => {
    const launcher = readFileSync(launcherPath, "utf8");

    expect(launcher).toContain('Notebook[');
    expect(launcher).toContain('ButtonBox');
    expect(launcher).toContain('Open MMA Agent Bridge');
    expect(launcher).toContain('Needs["MMAAgentBridge`"]');
    expect(launcher).toContain('MMAAgentBridge`StartMMAAgentPalette[]');
    expect(launcher).not.toContain('ToBoxes[');
    expect(launcher).toContain('WindowTitle -> "MMA Agent Bridge Launcher"');
  });

  it("defines a hidden agent entrypoint instead of relying on visible palette UI", () => {
    expect(source).toContain("StartMMAAgentHiddenAgent[]");
    expect(source).toContain('$AgentSessionId = CreateUUID["agent-"]');
    expect(source).toContain("RegisterAgent[]");
    expect(source).toContain("HeartbeatNotebooks[]");
    expect(source).toContain('"/notebooks/heartbeat"');
    expect(source).toContain("PollAgentRequest[]");
    expect(source).toContain("ExecuteAgentRequest[request_Association]");
  });

  it("hidden agent heartbeat reports mutable notebook names and stable frontend object keys", () => {
    expect(source).toContain("FrontendObjectKey[nb_NotebookObject]");
    expect(source).toContain("NotebookWindowTitle[nb_NotebookObject]");
    expect(source).toContain("NotebookDisplayNameForHeartbeat[nb_NotebookObject, savedPath_String, frontendObjectKey_String]");
    expect(source).toContain('"Untitled notebook " <> StringTake[frontendObjectKey, -8]');
    expect(source).toContain('"frontendObjectKey"');
    expect(source).toContain('"displayName"');
    expect(source).toContain('"windowTitle"');
    expect(source).toContain('"notebookPath"');
    expect(source).toContain('Replace[NotebookFileName[nb], $Failed -> ""]');
  });

  it("filters hidden-agent notebook discovery without losing open notebooks", () => {
    const visibleStart = source.indexOf("AgentVisibleNotebooks[] := Module");
    const closureStart = source.indexOf("AgentPostResult[requestId_String", visibleStart);
    const visibleBody = source.slice(visibleStart, closureStart);

    expect(visibleStart).toBeGreaterThanOrEqual(0);
    expect(closureStart).toBeGreaterThan(visibleStart);
    expect(source).toContain("AgentNotebookCandidateQ[nb_NotebookObject]");
    expect(source).toContain("CurrentValue[nb, Visible]");
    expect(source).toContain("CurrentValue[nb, WindowFrame]");
    expect(source).toContain("!MemberQ[{\"Palette\", \"ModalDialog\", \"ModelessDialog\"}, frame]");
    expect(visibleBody).toContain("DeleteDuplicates");
    expect(visibleBody).toContain("Notebooks[]");
    expect(visibleBody).toContain("AgentNotebookCandidateQ");
    expect(visibleBody).not.toContain("InputNotebook[]");
    expect(visibleBody).not.toContain("SelectedNotebook[]");
  });

  it("posts closed notebook diffs while keeping live notebooks tracked", () => {
    expect(source).toContain('AgentHeartbeatNotebookClosure[notebookId_String]');
    expect(source).toContain('Lookup[$BridgeNotebooks, notebookId, <||>]');
    expect(source).toContain('"/notebooks/" <> URLComponentEncodeString[notebookId] <> "/closed"');
    expect(source).toContain('"closed" -> True');
    expect(source).toContain('trackedNotebookIds = Select[');
    expect(source).toContain('Keys[$BridgeNotebooks]');
    expect(source).toContain('Function[notebookId, Module[');
    expect(source).toContain('visibleNotebookIds = {}');
    expect(source).toContain('staleNotebookIds = Complement[trackedNotebookIds, visibleNotebookIds];');
    expect(source).not.toContain('Complement[Keys[$BridgeNotebooks], seenNotebookIds]');
  });

  it("normalizes hidden agent requests, cancellation, and result posting", () => {
    expect(source).toContain('AgentVisibleNotebooks[]');
    expect(source).toContain('WindowFrame');
    expect(source).toContain('$HiddenAgentInProgress');
    expect(source).toContain('ExecuteAgentRequest[request_Association] := Module');
    expect(source).toContain('targetNotebookId');
    expect(source).toContain('AssociateTo[args, "notebookId" -> targetNotebookId]');
    expect(source).toContain('Join[request, <|"arguments" -> args|>]');
    expect(source).toContain('cancelRequests');
    expect(source).toContain('/requests/');
    expect(source).toContain('AgentPostResult');
    expect(source).toContain('AgentPostFailure');
    expect(source).toContain('If[$HiddenAgentTask === None || Not @ TrueQ @ Quiet @ Check[ScheduledTaskActiveQ[$HiddenAgentTask], False],');
  });

  it("posts hidden-agent notebook closures with agent ownership metadata", () => {
    expect(source).toContain('AgentHeartbeatNotebookClosure[notebookId_String] := Module');
    expect(source).toContain('"/notebooks/" <> URLComponentEncodeString[notebookId] <> "/closed"');
    expect(source).toContain('<|"agentSessionId" -> $AgentSessionId|>');
    expect(source).toContain('AssociationQ[record] && AssociationQ[response] && TrueQ[Lookup[response, "ok", False]]');
    expect(source).toContain('TrueQ[Lookup[record, "closed", False]]');
  });

  it("parses nested notebook ids from bun heartbeat responses", () => {
    expect(source).toContain('Lookup[response, "notebook", <||>]');
    expect(source).toContain('Lookup[Lookup[response, "notebook", <||>], "notebookId",');
  });

  it("uses unix epoch timestamps for hidden agent payloads", () => {
    expect(source).toContain('UnixTimeMilliseconds[] :=');
    expect(source).toContain('UnixTime[]');
    expect(source).not.toContain('AbsoluteTime[{1970, 1, 1, 0, 0, 0}]');
    expect(source).not.toContain('seenAt" -> Round[1000 AbsoluteTime[]]');
  });

  it("heartbeats the agent without re-registering every tick", () => {
    expect(source).toContain('AgentHeartbeat[] := BridgePost[');
    expect(source).toContain('"/agents/heartbeat"');
    expect(source).toContain('AgentHeartbeat[]');
    expect(source).toContain('RunScheduledTask[SafeHiddenAgentTick[], 1]');
    expect(source).not.toContain('RunScheduledTask[SafeHiddenAgentTick[], {1}]');
    expect(source).not.toContain('{0.5}');
  });

  it("re-registers the hidden agent when visible notebooks exist unless the session was superseded", () => {
    const helperStart = source.indexOf('EnsureAgentRegisteredForVisibleNotebooks[] := Module');
    const tickStart = source.indexOf('SafeHiddenAgentTick[] := Module');
    const tickEnd = source.indexOf('StartMMAAgentHiddenAgent[] := Module', tickStart);
    const helperBody = source.slice(helperStart, tickStart);
    const tickBody = source.slice(tickStart, tickEnd);

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(tickStart).toBeGreaterThan(helperStart);
    expect(helperBody).toContain('notebooks = AgentVisibleNotebooks[]');
    expect(helperBody).toContain('If[Length[notebooks] == 0, Return[notebooks]]');
    expect(helperBody).toContain('heartbeat = Quiet @ Check[AgentHeartbeat[], $Failed]');
    expect(helperBody).toContain('reason = If[AssociationQ[heartbeat], Lookup[Lookup[heartbeat, "error", <||>], "reason", None], None]');
    expect(helperBody).toContain('If[reason === "superseded", Return[notebooks]]');
    expect(helperBody).toContain('RegisterAgent[]');
    expect(helperBody).not.toContain('liveTrackedNotebookIds');
    expect(tickBody).toContain('EnsureAgentRegisteredForVisibleNotebooks[]');
  });

  it("wraps hidden ticks in short HTTP settings and guarantees cleanup", () => {
    const tickStart = source.indexOf('SafeHiddenAgentTick[] := Module');
    const tickEnd = source.indexOf('StartMMAAgentHiddenAgent[] := Module', tickStart);
    const tickBody = source.slice(tickStart, tickEnd);

    expect(tickStart).toBeGreaterThanOrEqual(0);
    expect(tickBody).toContain('Internal`WithLocalSettings[');
    expect(tickBody).toContain('$HiddenAgentInProgress = True,');
    expect(tickBody).toContain('Block[{$BridgeHTTPTimeoutSeconds = 1, $BridgeHTTPRetryCount = 1},');
    expect(tickBody).toMatch(/Internal`WithLocalSettings\[\s*\$HiddenAgentInProgress = True,\s*\(?\s*Block\[/);
    expect(tickBody).toContain('$HiddenAgentInProgress = False');
  });

  it("keeps hidden-agent request execution outside the short polling HTTP timeout", () => {
    const tickStart = source.indexOf('SafeHiddenAgentTick[] := Module');
    const tickEnd = source.indexOf('StartMMAAgentHiddenAgent[] := Module', tickStart);
    const tickBody = source.slice(tickStart, tickEnd);
    const shortHttpBlock = tickBody.match(
      /Block\[\{\$BridgeHTTPTimeoutSeconds = 1, \$BridgeHTTPRetryCount = 1\},\s*Quiet @ Check\[EnsureAgentRegisteredForVisibleNotebooks\[\], Null\];\s*Quiet @ Check\[HeartbeatNotebooks\[\], Null\];\s*payload = Quiet @ Check\[PollAgentRequest\[\], \$Failed\];\s*\];/
    );
    const executeIndex = tickBody.indexOf('ExecuteAgentRequest[request]');

    expect(tickStart).toBeGreaterThanOrEqual(0);
    expect(shortHttpBlock).not.toBeNull();
    expect(executeIndex).toBeGreaterThanOrEqual(0);
    expect(executeIndex).toBeGreaterThan((shortHttpBlock?.index ?? 0) + (shortHttpBlock?.[0].length ?? 0));
  });

  it("uses short HTTP settings during hidden agent startup", () => {
    const start = source.indexOf('StartMMAAgentHiddenAgent[] := Module');
    const end = source.indexOf('ExecuteRequest[request_Association] := Module', start);
    const body = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(body).toContain('Block[{$BridgeHTTPTimeoutSeconds = 1, $BridgeHTTPRetryCount = 1},');
    expect(body).toMatch(/Block\[\{\$BridgeHTTPTimeoutSeconds = 1, \$BridgeHTTPRetryCount = 1\},\s*EnsureAgentRegisteredForVisibleNotebooks\[\];\s*HeartbeatNotebooks\[\];/);
    expect(body).not.toMatch(/Block\[\{\$BridgeHTTPTimeoutSeconds = 1, \$BridgeHTTPRetryCount = 1\},\s*RegisterAgent\[\];\s*HeartbeatNotebooks\[\];/);
  });

  it("defines a dedicated FrontEnd control-kernel bootstrap", () => {
    expect(source).toContain('StartMMAAgentControlKernel::usage = "StartMMAAgentControlKernel[] starts the hidden Wolfram agent in a dedicated FrontEnd evaluator."');
    expect(source).toContain('StopMMAAgentHiddenAgent::usage = "StopMMAAgentHiddenAgent[] stops the hidden Wolfram agent loop in the current kernel."');
    expect(source).toContain('StopMMAAgentControlKernel::usage = "StopMMAAgentControlKernel[] closes the hidden control-kernel notebook if this kernel created it."');
    expect(source).toContain('$MMAAgentBridgeSourceFile');
    expect(source).toContain('$ControlAgentNotebook = None');
    expect(source).toContain('$ControlAgentEvaluatorName = "MMAAgentControl"');
    expect(source).toContain('EnsureControlEvaluator[evaluatorName_String] := Module');
    expect(source).toContain('CurrentValue[$FrontEnd, {EvaluatorNames, evaluatorName}] = controlSpec');
    expect(source).toContain('ControlAgentInitCode[permissions_Association] := Module');
    expect(source).toContain('Get[ToString[');
    expect(source).toContain('MMAAgentBridge`Private`$BridgePermissions = ');
    expect(source).toContain('MMAAgentBridge`StartMMAAgentHiddenAgent[]');
    expect(source).toContain('CreateDocument[{Cell[BoxData[initCode], "Input", CellTags -> {"MMAAgentControlInit"}]}');
    expect(source).toContain('Visible -> False');
    expect(source).toContain('Evaluator -> evaluatorName');
    expect(source).toContain('FrontEndTokenExecute[$ControlAgentNotebook, "EvaluateCells"]');
    expect(source).toContain('If[TrueQ[stopCurrentAgent], StopMMAAgentHiddenAgent[]]');

    // Advisory 1: cleanup on FrontEndTokenExecute failure path
    expect(source).toContain('Quiet @ Check[NotebookClose[$ControlAgentNotebook], Null];');
    expect(source).toContain('$ControlAgentNotebook = None;');
    expect(source).toContain('Return[BridgeFailure["CONTROL_AGENT_START_FAILED", "Failed to evaluate the control agent initialization cell."]]');

    // Advisory 2: guard EnsureControlEvaluator against CurrentValue failure
    expect(source).toContain('before = Quiet @ Check[CurrentValue[$FrontEnd, EvaluatorNames], $Failed];');
    expect(source).toContain('If[before === $Failed, Return[BridgeFailure["EVALUATOR_CONFIG_FAILED", "Could not read FrontEnd evaluator configuration."]]];');

    // Ordering: cleanup must appear between FrontEndTokenExecute and the end of StartMMAAgentControlKernel
    const controlKernelStart = source.indexOf('StartMMAAgentControlKernel[evaluatorName_String:$ControlAgentEvaluatorName');
    const controlKernelEnd = source.indexOf('StartMMAAgentHiddenAgent[] := Module', controlKernelStart);
    const controlKernelBody = source.slice(controlKernelStart, controlKernelEnd);
    const feTokenIndex = controlKernelBody.indexOf('FrontEndTokenExecute[$ControlAgentNotebook, "EvaluateCells"]');
    const cleanupIndex = controlKernelBody.indexOf('Quiet @ Check[NotebookClose[$ControlAgentNotebook], Null];');
    const noneIndex = controlKernelBody.indexOf('$ControlAgentNotebook = None;');
    const returnIndex = controlKernelBody.indexOf('Return[BridgeFailure["CONTROL_AGENT_START_FAILED"');

    expect(controlKernelStart).toBeGreaterThanOrEqual(0);
    expect(controlKernelEnd).toBeGreaterThan(controlKernelStart);
    expect(feTokenIndex).toBeGreaterThanOrEqual(0);
    expect(cleanupIndex).toBeGreaterThan(feTokenIndex);
    expect(noneIndex).toBeGreaterThan(cleanupIndex);
    expect(returnIndex).toBeGreaterThan(noneIndex);

    // Ordering: guard must appear before beforeAssoc in EnsureControlEvaluator
    const ensureStart = source.indexOf('EnsureControlEvaluator[evaluatorName_String] := Module');
    const ensureEnd = source.indexOf('ControlAgentInitCode[permissions_Association] := Module', ensureStart);
    const ensureBody = source.slice(ensureStart, ensureEnd);
    const guardIndex = ensureBody.indexOf('before = Quiet @ Check[CurrentValue[$FrontEnd, EvaluatorNames], $Failed];');
    const failedCheckIndex = ensureBody.indexOf('If[before === $Failed, Return[BridgeFailure["EVALUATOR_CONFIG_FAILED"');
    const beforeAssocIndex = ensureBody.indexOf('beforeAssoc = Association[before];');

    expect(ensureStart).toBeGreaterThanOrEqual(0);
    expect(ensureEnd).toBeGreaterThan(ensureStart);
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(failedCheckIndex).toBeGreaterThan(guardIndex);
    expect(beforeAssocIndex).toBeGreaterThan(failedCheckIndex);
  });

  it("guards control-kernel boot with FE-session TaggingRules flags", () => {
    // Private helpers for flag management
    expect(source).toContain('ControlAgentFlagPath[key_String] := {TaggingRules, "MMAAgentBridge", key}');
    expect(source).toContain('SetControlAgentFlag[key_String, value_]');
    expect(source).toContain('ClearControlAgentFlag[key_String]');
    expect(source).toContain('CurrentValue[$FrontEndSession, ControlAgentFlagPath[key]]');

    // Source contains writes to $FrontEndSession for ControlKernelBooting and AgentRunning
    expect(source).toContain('"ControlKernelBooting"');
    expect(source).toContain('"AgentRunning"');
    expect(source).toContain('$FrontEndSession');

    // ControlAgentInitCode generated string clears ControlKernelBooting before Get/Needs
    const initCodeStart = source.indexOf('ControlAgentInitCode[permissions_Association] := Module');
    const initCodeEnd = source.indexOf('StartMMAAgentControlKernel[evaluatorName_String', initCodeStart);
    const initCodeBody = source.slice(initCodeStart, initCodeEnd);
    expect(initCodeStart).toBeGreaterThanOrEqual(0);
    expect(initCodeEnd).toBeGreaterThan(initCodeStart);
    expect(initCodeBody).toContain('ControlKernelBooting');
    expect(initCodeBody).toContain('Inherited');
    // The clear must appear before Get/Needs in the generated string
    const clearIndex = initCodeBody.indexOf('ControlKernelBooting');
    const getIndex = initCodeBody.indexOf('Get[ToString[');
    expect(clearIndex).toBeGreaterThanOrEqual(0);
    expect(getIndex).toBeGreaterThan(clearIndex);

    // StartMMAAgentControlKernel body sets ControlKernelBooting before CreateDocument
    const controlKernelStart = source.indexOf('StartMMAAgentControlKernel[evaluatorName_String');
    const controlKernelEnd = source.indexOf('StartMMAAgentHiddenAgent[] := Module', controlKernelStart);
    const controlKernelBody = source.slice(controlKernelStart, controlKernelEnd);
    const bootingSetIndex = controlKernelBody.indexOf('SetControlAgentFlag["ControlKernelBooting"');
    const createDocIndex = controlKernelBody.indexOf('CreateDocument');
    expect(controlKernelStart).toBeGreaterThanOrEqual(0);
    expect(controlKernelEnd).toBeGreaterThan(controlKernelStart);
    expect(bootingSetIndex).toBeGreaterThanOrEqual(0);
    expect(createDocIndex).toBeGreaterThan(bootingSetIndex);

    // Failure paths clear ControlKernelBooting before returning
    // EnsureControlEvaluator failure path
    const ensureStart = source.indexOf('EnsureControlEvaluator[evaluatorName_String] := Module');
    const ensureEnd = source.indexOf('ControlAgentInitCode[permissions_Association] := Module', ensureStart);
    const ensureBody = source.slice(ensureStart, ensureEnd);
    // The evaluator failure check in StartMMAAgentControlKernel should clear the flag
    const evaluatorFailCheck = controlKernelBody.indexOf('MatchQ[evaluatorStatus, _Failure]');
    const clearBootingAfterEvalFail = controlKernelBody.indexOf('ClearControlAgentFlag["ControlKernelBooting"]', evaluatorFailCheck);
    expect(evaluatorFailCheck).toBeGreaterThanOrEqual(0);
    expect(clearBootingAfterEvalFail).toBeGreaterThan(evaluatorFailCheck);
    // FrontEndTokenExecute failure path also clears ControlKernelBooting
    const feTokenFailIndex = controlKernelBody.indexOf('FrontEndTokenExecute[$ControlAgentNotebook, "EvaluateCells"]');
    const clearBootingAfterFeFail = controlKernelBody.indexOf('ClearControlAgentFlag["ControlKernelBooting"]', feTokenFailIndex);
    expect(feTokenFailIndex).toBeGreaterThanOrEqual(0);
    expect(clearBootingAfterFeFail).toBeGreaterThan(feTokenFailIndex);

    // After successful FrontEndTokenExecute, set AgentRunning True
    const agentRunningSetIndex = controlKernelBody.indexOf('SetControlAgentFlag["AgentRunning"');
    expect(agentRunningSetIndex).toBeGreaterThan(feTokenFailIndex);

    // StopMMAAgentControlKernel clears AgentRunning
    const stopStart = source.indexOf('StopMMAAgentControlKernel[] := Module');
    const stopEnd = source.indexOf('EnsureControlEvaluator[evaluatorName_String] := Module', stopStart);
    const stopBody = source.slice(stopStart, stopEnd);
    expect(stopStart).toBeGreaterThanOrEqual(0);
    expect(stopEnd).toBeGreaterThan(stopStart);
    expect(stopBody).toContain('ClearControlAgentFlag["AgentRunning"]');
    // Clear must happen after $ControlAgentNotebook = None
    const noneIndexInStop = stopBody.indexOf('$ControlAgentNotebook = None');
    const clearAgentRunningIndex = stopBody.indexOf('ClearControlAgentFlag["AgentRunning"]');
    expect(noneIndexInStop).toBeGreaterThanOrEqual(0);
    expect(clearAgentRunningIndex).toBeGreaterThan(noneIndexInStop);
  });

  it("preserves existing $BridgePermissions across package reloads", () => {
    expect(source).toContain('$DefaultBridgePermissions = <|');
    expect(source).toContain('If[!AssociationQ[Quiet @ Check[$BridgePermissions, None]],');
    expect(source).toContain('$BridgePermissions = $DefaultBridgePermissions');
    expect(source).not.toContain('$BridgePermissions = <|\n  "ReadNotebook" -> True,');
  });

  it("defines the status dashboard palette helpers and controls", () => {
    const requiredSnippets = [
      'PaletteStatusPill',
      'NotebookDisplayName',
      'NotebookSelectorView[]',
      'RuntimeStatusCard[]',
      'PermissionsPanel[]',
      'DiagnosticsPanel[]',
      'PopupMenu[Dynamic[$ActiveNotebookId',
      'Register Current Window',
      'Refresh Notebooks',
      'Use Selected Notebook',
      'Transport',
      'Executor',
      'Cancel Running Request',
      'ProgressIndicator',
      'OpenerView',
      'DynamicModule',
      'Grid[',
      'Framed[',
      'Panel['
    ];

    for (const snippet of requiredSnippets) {
      expect(source).toContain(snippet);
    }

    expect(source).toContain('PaletteView[] := DynamicModule');
    expect(source).toContain('Button["Refresh Notebooks"');
    expect(source).toContain('Button["Use Selected Notebook"');
    expect(source).toContain('Button["Cancel Running Request"');
    expect(source).toContain('Checkbox[Dynamic[$BridgePermissions[key]');
  });

  it("keeps diagnostics opener state stable across status refreshes", () => {
    const diagnosticsStart = source.indexOf("DiagnosticsPanel[] :=");
    const diagnosticsEnd = source.indexOf("NotebookSelectorView[] :=", diagnosticsStart);
    const diagnosticsBody = source.slice(diagnosticsStart, diagnosticsEnd);

    expect(diagnosticsStart).toBeGreaterThanOrEqual(0);
    expect(diagnosticsBody).toContain("$DiagnosticsOpen");
    expect(diagnosticsBody).toContain("Dynamic[$DiagnosticsOpen]");
    expect(diagnosticsBody).not.toMatch(/OpenerView\[[\s\S]*,\s*False\s*\]\s*;/);
  });

  it("uses a lightweight poll heartbeat instead of rebuilding the whole palette", () => {
    const paletteStart = source.indexOf("PaletteView[] := DynamicModule");
    const paletteEnd = source.indexOf("BridgeURL[path_String]", paletteStart);
    const paletteBody = source.slice(paletteStart, paletteEnd);

    expect(paletteStart).toBeGreaterThanOrEqual(0);
    expect(source).toContain("PollHeartbeat[] := Dynamic[");
    expect(paletteBody).toContain("PollHeartbeat[]");
    expect(paletteBody).not.toMatch(/Dynamic\[Refresh\[SafePollBridge\[\];\s*Column\[/);
    expect(paletteBody).not.toMatch(/Dynamic\[Refresh\[SafePollBridge\[\];[\s\S]*NotebookSelectorView\[\]/);
  });

  it("does not duplicate top-level palette action buttons", () => {
    expect(countOccurrences(source, 'Button["Register Current Window"')).toBe(1);
    expect(countOccurrences(source, 'Button["Refresh Notebooks"')).toBe(1);
    expect(countOccurrences(source, 'Button["Use Selected Notebook"')).toBe(1);
    expect(countOccurrences(source, 'Button["Poll now"')).toBe(1);
    expect(countOccurrences(source, 'Button["Cancel Running Request"')).toBe(1);
    expect(source).not.toContain("Allow control of current Notebook");
    expect(source).not.toContain("Cancel current request");
  });

  it("defines the bridge inbox executor helpers", () => {
    const requiredSnippets = [
      '$BridgeInbox = {}',
      '$ExecutorInProgress = False',
      '$BridgeExecutorTask = None',
      '$LastPollTime = None',
      '$LastResultStatus = None',
      'EnqueueBridgeRequest[request_Association]',
      'DequeueBridgeRequest[]',
      'SafeExecutePendingRequest[]',
      'StartBridgeExecutor[]'
    ];

    for (const snippet of requiredSnippets) {
      expect(source).toContain(snippet);
    }
  });

  it("queues polled requests instead of executing them synchronously", () => {
    const pollStart = source.lastIndexOf("PollBridge[] := Module");
    const pollEnd = source.indexOf("End[];", pollStart);
    const pollBody = source.slice(pollStart, pollEnd);

    expect(pollBody).toContain('EnqueueBridgeRequest[request]');
    expect(pollBody).not.toContain('ExecuteRequest[request]');
  });

  it("starts the executor before creating the palette", () => {
    const paletteStart = source.indexOf('StartMMAAgentPalette[] := Module');
    const paletteEnd = source.indexOf('CellContentString[cell_CellObject]', paletteStart);
    const paletteBody = source.slice(paletteStart, paletteEnd);

    expect(paletteStart).toBeGreaterThanOrEqual(0);
    expect(paletteEnd).toBeGreaterThan(paletteStart);
    expect(paletteBody).toContain('StartBridgeExecutor[]');
    expect(paletteBody).toContain('CreatePalette[PaletteView[]');
  });

  it("surfaces last poll and last result status in diagnostics", () => {
    expect(source).toContain('Last poll');
    expect(source).toContain('Last result');
  });

  it("reads nested notebook info when displaying notebook names", () => {
    expect(source).toContain('Lookup[record, "info", record]');
    expect(source).toContain('Lookup[info, "notebookId", Lookup[record, "notebookId", ""]]');
  });

  it("builds notebook selector choices from registered notebook ids", () => {
    const choicesStart = source.indexOf('NotebookSelectorChoices[] :=');
    const choicesEnd = source.indexOf('RefreshNotebooks[] :=', choicesStart);
    const choicesBody = source.slice(choicesStart, choicesEnd);

    expect(choicesStart).toBeGreaterThanOrEqual(0);
    expect(choicesEnd).toBeGreaterThan(choicesStart);
    expect(choicesBody).toContain('Keys[$BridgeNotebooks]');
    expect(choicesBody).toContain('display = NotebookDisplayName[record]');
    expect(choicesBody).toContain('notebookId -> display');
    expect(choicesBody).not.toContain('display -> notebookId');
  });

  it("keeps the dashboard live without wrapping interactive controls in the polling dynamic", () => {
    expect(source).toContain('PaletteView[] := DynamicModule');
    expect(source).toContain('PollHeartbeat[] := Dynamic[');
    expect(source).toContain('PollHeartbeat[]');
    expect(source).toContain('UpdateInterval -> 1');
    expect(source).toContain('SynchronousUpdating -> False');
    expect(source).not.toContain('legacyStatus = Dynamic[');
  });

  it("defines symbol lookup helpers for agent-friendly documentation queries", () => {
    const requiredSnippets = [
      'SymbolLookup[query_String] := Module',
      'SymbolDetail[sym_Symbol] :=',
      'SymbolCandidate[sym_String] := Module',
      'usageString[sym_Symbol] := Quiet @ Check[ToString[sym::usage]',
      'optionList[sym_Symbol] := Quiet @ Check[Map[<|"name" -> ToString[#[[1]]], "default" -> ToString[#[[2]]]|> &, Options[sym]]',
      'syntaxSummary[sym_Symbol] := Quiet @ Check[',
      'Replace[WolframLanguageData[SymbolName[sym], "SyntaxInformation"], _Missing -> <||>]',
      'relatedSymbols[sym_Symbol] := Quiet @ Check[',
      'ToString /@ (WolframLanguageData[SymbolName[sym], "RelatedSymbols"] /. e_Entity :> e[[2]])',
      '_Missing -> {}',
      'documentationURL[sym_Symbol] := Quiet @ Check["https://reference.wolfram.com/language/ref/" <> SymbolName[sym] <> ".html"',
      '"mma_symbol_lookup"',
      'SymbolLookup[Lookup[args, "query", ""]]',
      '"status" -> "found"',
      '"status" -> "ambiguous"',
      '"status" -> "not_found"',
      'Names["System`*" <> query <> "*"]',
      '"System`" <> query',
      'Length[Names[exactName]] === 1',
      'ToExpression[exactName]',
      'WolframLanguageData[SymbolName[sym], "RelatedSymbols"] /. e_Entity :> e[[2]]',
    ];

    for (const snippet of requiredSnippets) {
      expect(source).toContain(snippet);
    }
  });
});
