# Symbol Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mma_symbol_lookup` MCP tool that lets AI agents query Wolfram Language function documentation through the existing MICA bridge.

**Architecture:** Add a `SymbolLookup[]` function and helpers to `MMAAgentBridge.wl`, register it in the existing `Switch[tool, ...]` dispatch. On the Bun/Node side, add the tool schema and register it as a queued notebook tool. The tool uses any available notebook's kernel for execution.

**Tech Stack:** Wolfram Language (paclet), TypeScript (Bun/Node MCP server), Vitest (static source assertions + integration tests).

---

## File Structure

- Modify `paclet/Kernel/MMAAgentBridge.wl`
  - Add `SymbolLookup[query_String]`, `SymbolDetail[sym_Symbol]`, `SymbolCandidate[sym_String]`, `usageString[sym_Symbol]`, `optionList[sym_Symbol]`, `syntaxSummary[sym_Symbol]`, `relatedSymbols[sym_Symbol]`, `documentationURL[sym_Symbol]`.
  - Register `"mma_symbol_lookup"` in the `Switch[tool, ...]` dispatch inside `ExecuteRequest`.
- Modify `src/mcp/toolSchemas.ts`
  - Add `symbolLookupSchema` Zod schema.
- Modify `src/mcp/backendTools.ts`
  - Add `mma_symbol_lookup` to the `QueuedNotebookTool` config array.
- Modify `tests/mmaAgentBridgeWolfram.test.ts`
  - Add static source assertions for `SymbolLookup` and helpers.
- Modify `tests/mcpTools.test.ts`
  - Add integration test verifying tool registration and handler behavior.

No commits should be made unless explicitly requested.

---

### Task 1: Add failing static source tests for Wolfram symbol lookup

**Files:**
- Modify: `tests/mmaAgentBridgeWolfram.test.ts`

- [ ] **Step 1: Add a test block for symbol lookup functions**

Add this `it(...)` block near the end of the existing test file, before the last `});`:

```ts
  it("defines symbol lookup helpers for agent-friendly documentation queries", () => {
    const requiredSnippets = [
      'SymbolLookup[query_String] := Module',
      'SymbolDetail[sym_Symbol] :=',
      'SymbolCandidate[sym_String] := Module',
      'usageString[sym_Symbol] := Quiet @ Check[ToString[sym::usage]',
      'optionList[sym_Symbol] := Quiet @ Check[Map[<|"name" -> ToString[#[[1]]], "default" -> ToString[#[[2]]]|> &, Options[sym]]',
      'syntaxSummary[sym_Symbol] := Quiet @ Check[WolframLanguageData[SymbolName[sym], "SyntaxInformation"]',
      'relatedSymbols[sym_Symbol] := Quiet @ Check[Take[ToString /@ WolframLanguageData[SymbolName[sym], "RelatedSymbols"], UpTo[10]]',
      'documentationURL[sym_Symbol] := Quiet @ Check["https://reference.wolfram.com/language/ref/" <> SymbolName[sym] <> ".html"',
      '"mma_symbol_lookup"',
      'SymbolLookup[Lookup[args, "query", ""]]',
      '"status" -> "found"',
      '"status" -> "ambiguous"',
      '"status" -> "not_found"',
      'Names["System`*" <> query <> "*"]',
      'ToExpression[query, StandardForm, Hold]',
      'Context[ReleaseHold[sym]] === "System`"',
    ];

    for (const snippet of requiredSnippets) {
      expect(source).toContain(snippet);
    }
  });
```

- [ ] **Step 2: Run the failing Wolfram static test**

Run:

```powershell
npm test -- tests/mmaAgentBridgeWolfram.test.ts
```

Expected: fails because `SymbolLookup` and helpers are not yet implemented.

---

### Task 2: Implement Wolfram symbol lookup functions

**Files:**
- Modify: `paclet/Kernel/MMAAgentBridge.wl`

- [ ] **Step 1: Add helper functions before `ExecuteRequest`**

Insert these helpers immediately before `ExecuteRequest[request_Association] := Module`:

```wolfram
usageString[sym_Symbol] := Quiet @ Check[
  ToString[sym::usage],
  "No usage information available."
];

optionList[sym_Symbol] := Quiet @ Check[
  Map[
    <|"name" -> ToString[#[[1]]], "default" -> ToString[#[[2]]]|> &,
    Options[sym]
  ],
  {}
];

syntaxSummary[sym_Symbol] := Quiet @ Check[
  WolframLanguageData[SymbolName[sym], "SyntaxInformation"],
  <||>
];

relatedSymbols[sym_Symbol] := Quiet @ Check[
  Take[
    ToString /@ WolframLanguageData[SymbolName[sym], "RelatedSymbols"],
    UpTo[10]
  ],
  {}
];

documentationURL[sym_Symbol] := Quiet @ Check[
  "https://reference.wolfram.com/language/ref/" <> SymbolName[sym] <> ".html",
  ""
];

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
  s = ToExpression[sym];
  <|"symbol" -> sym,
    "usage" -> StringTake[usageString[s], UpTo[200]]
  |>
];

SymbolLookup[query_String] := Module[{sym, candidates},
  sym = Quiet @ Check[
    ToExpression[query, StandardForm, Hold], $Failed
  ];
  If[MatchQ[sym, Hold[_Symbol]] && Context[ReleaseHold[sym]] === "System`",
    Return @ SymbolDetail[ReleaseHold[sym]]
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
```

- [ ] **Step 2: Register the tool in the dispatch**

In the `Switch[tool, ...]` block inside `ExecuteRequest`, add a new case before the default `_` case:

```wolfram
          "mma_symbol_lookup", SymbolLookup[Lookup[args, "query", ""]],
```

Insert it after the `"mma_select_notebook"` line and before the `_` default case.

- [ ] **Step 3: Run the focused static test**

Run:

```powershell
npm test -- tests/mmaAgentBridgeWolfram.test.ts
```

Expected: pass for the new test and all existing Wolfram static tests.

---

### Task 3: Add Bun/Node tool schema and registration

**Files:**
- Modify: `src/mcp/toolSchemas.ts`
- Modify: `src/mcp/backendTools.ts`

- [ ] **Step 1: Add Zod schema in `toolSchemas.ts`**

Add after the last existing schema export:

```ts
export const symbolLookupSchema = z.object({
  query: z.string().min(1).describe("Symbol name or partial search term")
}).strict();
```

- [ ] **Step 2: Register tool in `backendTools.ts`**

Add to the `QueuedNotebookTool` config array (the array passed to `registerQueuedNotebookTool` calls). Insert after the `mma_select_notebook` entry:

```ts
    {
      name: "mma_symbol_lookup",
      summary: "Look up Wolfram Language symbol documentation. Provide an exact symbol name (e.g. 'Plot') for full details including usage, options, attributes, syntax, related symbols, and documentation URL, or a partial name (e.g. 'integrate') for a list of matching symbols.",
      schema: symbolLookupSchema.shape,
      permission: "ReadNotebook",
      timeoutMs: () => DEFAULT_TIMEOUTS_MS.symbolLookup,
      extraGuidance: "",
    },
```

- [ ] **Step 3: Add timeout constant**

Find the `DEFAULT_TIMEOUTS_MS` object in `backendTools.ts` and add:

```ts
  symbolLookup: 15_000,
```

- [ ] **Step 4: Import the new schema**

At the top of `backendTools.ts`, add `symbolLookupSchema` to the existing import from `./toolSchemas.js`:

```ts
import {
  // ... existing imports ...
  symbolLookupSchema,
} from "./toolSchemas.js";
```

- [ ] **Step 5: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: pass.

---

### Task 4: Add MCP integration test

**Files:**
- Modify: `tests/mcpTools.test.ts`

- [ ] **Step 1: Add `mma_symbol_lookup` to the expected tool list**

In the test `"registers backend tools that return JSON text responses"`, add `"mma_symbol_lookup"` to the expected array after `"mma_select_notebook"`:

```ts
    expect(registrations.map((entry) => entry.name)).toEqual([
      "mma_status",
      "mma_list_notebooks",
      "mma_select_notebook",
      "mma_symbol_lookup",
      "mma_list_cells",
      "mma_read_cell",
      "mma_insert_cell",
      "mma_modify_cell",
      "mma_delete_cell",
      "mma_run_cell",
      "mma_abort_evaluation",
      "mma_get_cell_output",
      "mma_save_notebook"
    ]);
```

- [ ] **Step 2: Add a handler test for `mma_symbol_lookup`**

Add a new test after the existing tool registration test:

```ts
  it("registers mma_symbol_lookup with query parameter", async () => {
    const registrations: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }> = [];
    const server = {
      tool(name: string, _description: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) {
        registrations.push({ name, handler });
      }
    };

    const state = makeBackendState();
    registerBackendMcpTools(server as never, state);

    const lookupHandler = registrations.find((entry) => entry.name === "mma_symbol_lookup")!.handler;

    await expect(lookupHandler({ query: "Plot" })).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ ok: true })
    });
  });
```

- [ ] **Step 3: Run the MCP integration tests**

Run:

```powershell
npm test -- tests/mcpTools.test.ts
```

Expected: pass.

---

### Task 5: Run full automated verification

**Files:**
- No edits.

- [ ] **Step 1: Run the full test suite**

Run:

```powershell
npm test
```

Expected: all Vitest suites pass.

- [ ] **Step 2: Run TypeScript typecheck**

Run:

```powershell
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected: pass and emit `dist/`.