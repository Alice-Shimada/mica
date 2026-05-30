# MICA Symbol Lookup Design

## Status

Approved design, pending implementation plan.

## Goal

Add a `mma_symbol_lookup` MCP tool that lets AI agents query Wolfram Language function documentation directly through the existing MICA bridge, without requiring internet access or external subscriptions.

## Non-Goals

- Do not implement full-text documentation search (tutorials, guides).
- Do not search Wolfram Function Repository or Data Repository (requires internet).
- Do not depend on Wolfram Chatbook semantic search (requires LLMKit subscription).
- Do not add a separate documentation server or index.

## Architecture

```
Agent → MCP tool call → Bun/Node → HTTP bridge → Wolfram Paclet → Kernel query
```

The lookup runs entirely within the Wolfram kernel through the existing bridge. No new infrastructure.

## Tool: `mma_symbol_lookup`

### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Symbol name or partial search term |

### Behavior

1. **Exact match**: If `query` matches a `System` symbol exactly, return detailed information.
2. **Fuzzy search**: If no exact match, search `Names["System`*query*"]` and return up to 20 candidates with usage summaries.
3. **Not found**: If no candidates, return `not_found` status.

### Response: Exact Match

```json
{
  "status": "found",
  "symbol": "Plot",
  "usage": "Plot[f, {x, xmin, xmax}] generates a plot of f as a function of x from xmin to xmax.",
  "options": [
    {"name": "AlignmentPoint", "default": "Center"},
    {"name": "AspectRatio", "default": "1/GoldenRatio"}
  ],
  "attributes": ["HoldAll", "Protected", "ReadProtected"],
  "syntax": {
    "ArgumentsPattern": "{_, _, _}.",
    "OptionNames": ["AlignmentPoint", "AspectRatio", "Axes"]
  },
  "related": ["ListPlot", "Plot3D", "ParametricPlot", "LogPlot"],
  "url": "https://reference.wolfram.com/language/ref/Plot.html"
}
```

### Response: Fuzzy Match

```json
{
  "status": "ambiguous",
  "query": "integrate",
  "candidates": [
    {
      "symbol": "Integrate",
      "usage": "Integrate[f, x] gives the indefinite integral..."
    },
    {
      "symbol": "NIntegrate",
      "usage": "NIntegrate[f, {x, xmin, xmax}] gives a numerical approximation..."
    }
  ]
}
```

### Response: Not Found

```json
{
  "status": "not_found",
  "query": "xyz",
  "message": "No System` symbols match 'xyz'"
}
```

## Wolfram Implementation

A new function `SymbolLookup[query_String]` in `MMAAgentBridge.wl`:

```wolfram
SymbolLookup[query_String] := Module[{sym, candidates},
  (* 1. Exact match *)
  sym = Quiet @ Check[
    ToExpression[query, StandardForm, Hold], $Failed
  ];
  If[MatchQ[sym, Hold[_Symbol]] && 
     Context[ReleaseHold[sym]] === "System`",
    Return @ SymbolDetail[ReleaseHold[sym]]
  ];

  (* 2. Fuzzy search *)
  candidates = Names["System`*" <> query <> "*"];
  If[candidates === {},
    Return[<|"status" -> "not_found", "query" -> query,
      "message" -> "No System` symbols match '" <> query <> "'"|>]
  ];

  (* 3. Return candidates *)
  <|"status" -> "ambiguous", "query" -> query,
    "candidates" -> Map[SymbolCandidate, Take[candidates, UpTo[20]]]
  |>
]
```

### Helper: `SymbolDetail`

```wolfram
SymbolDetail[sym_Symbol] := <|
  "status" -> "found",
  "symbol" -> SymbolName[sym],
  "usage" -> usageString[sym],
  "options" -> optionList[sym],
  "attributes" -> ToString /@ Attributes[sym],
  "syntax" -> syntaxSummary[sym],
  "related" -> relatedSymbols[sym],
  "url" -> documentationURL[sym]
|>
```

### Helper: `SymbolCandidate`

```wolfram
SymbolCandidate[sym_String] := Module[{s},
  s = ToExpression[sym];
  <|"symbol" -> sym,
    "usage" -> StringTake[usageString[s], UpTo[200]]
  |>
]
```

### Helper: `usageString`

```wolfram
usageString[sym_Symbol] := Quiet @ Check[
  ToString[sym::usage],
  "No usage information available."
]
```

### Helper: `optionList`

Returns all options. Each option is `{name, default}` as strings.

```wolfram
optionList[sym_Symbol] := Quiet @ Check[
  Map[
    <|"name" -> ToString[#[[1]]], "default" -> ToString[#[[2]]]|> &,
    Options[sym]
  ],
  {}
]
```

### Helper: `syntaxSummary`

Uses `WolframLanguageData` for structured syntax information.

```wolfram
syntaxSummary[sym_Symbol] := Quiet @ Check[
  WolframLanguageData[SymbolName[sym], "SyntaxInformation"],
  <||>
]
```

### Helper: `relatedSymbols`

Returns up to 10 related symbols from `WolframLanguageData`.

```wolfram
relatedSymbols[sym_Symbol] := Quiet @ Check[
  Take[
    ToString /@ WolframLanguageData[SymbolName[sym], "RelatedSymbols"],
    UpTo[10]
  ],
  {}
]
```

### Helper: `documentationURL`

```wolfram
documentationURL[sym_Symbol] := Quiet @ Check[
  "https://reference.wolfram.com/language/ref/" <>
    SymbolName[sym] <> ".html",
  ""
]
```

## Request Routing

Register `"mma_symbol_lookup"` in the existing request dispatch in `MMAAgentBridge.wl`:

```wolfram
"mma_symbol_lookup" -> SymbolLookup[Lookup[args, "query", ""]]
```

## Bun/Node Changes

### Tool Schema (`src/mcp/tools.ts`)

```typescript
{
  name: "mma_symbol_lookup",
  description: "Look up Wolfram Language symbol documentation. " +
    "Provide an exact symbol name (e.g. 'Plot') for full details, " +
    "or a partial name (e.g. 'integrate') for a list of matching symbols.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Symbol name or partial search term"
      }
    },
    required: ["query"]
  }
}
```

### Handler (`src/mcp/backendTools.ts`)

Forward to the Wolfram bridge as a standard notebook request targeting the active notebook.

## Wolfram Built-in Functions Used

| Function | Purpose |
|----------|---------|
| `Names["System`*query*"]` | Fuzzy symbol search |
| `sym::usage` | Usage message text |
| `Options[sym]` | All options with defaults |
| `Attributes[sym]` | Symbol attributes |
| `WolframLanguageData[sym, "SyntaxInformation"]` | Structured syntax metadata |
| `WolframLanguageData[sym, "RelatedSymbols"]` | Related function names |
| `SymbolName[sym]` | Symbol name as string |

## Error Handling

- `ToExpression` failures: fall through to fuzzy search.
- `WolframLanguageData` returning `Missing[...]`: return empty `{}` or `""`.
- Empty `Names` result: return `not_found`.
- All kernel calls wrapped in `Quiet @ Check[..., fallback]`.

## Files Changed

| File | Change |
|------|--------|
| `paclet/Kernel/MMAAgentBridge.wl` | Add `SymbolLookup` and helpers; register route |
| `src/mcp/tools.ts` | Add `mma_symbol_lookup` tool schema |
| `src/mcp/backendTools.ts` | Add handler |
| `tests/mmaAgentBridgeWolfram.test.ts` | Static source assertions for new functions |
| `tests/mcpTools.test.ts` | MCP tool integration test |

## Verification

- `npm test` — all existing tests pass.
- `npm run typecheck` — no new errors.
- `npm run build` — builds cleanly.
- Manual: call `mma_symbol_lookup` with `"Plot"`, `"integrate"`, `"xyz"` and verify responses.