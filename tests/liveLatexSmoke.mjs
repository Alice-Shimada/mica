// Opt-in integration test against a visible, disposable Mathematica notebook.
// Run: node tests/liveLatexSmoke.mjs <frontendObjectKey>
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const frontendKey = process.argv[2];
assert(frontendKey, "Pass the frontendObjectKey of a disposable, visible notebook.");
const client = new Client({ name: "mica-latex-smoke", version: "1.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "dist/src/cli/index.js"), "mcp"],
  cwd: root,
  stderr: "pipe",
});
transport.stderr?.resume();
const checks = [];
const resultDir = path.join(tmpdir(), "mica-latex-smoke");
await mkdir(resultDir, { recursive: true });
const pass = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 90_000 });
  return result.structuredContent ?? JSON.parse(result.content[0].text);
};

try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert(tools.tools.find((tool) => tool.name === "mma_insert_cell").inputSchema.properties.format);
  pass("fresh MCP client advertises the LaTeX format parameter");
  const status = await call("mma_list_notebooks", {});
  const notebook = status.notebooks.find((entry) => entry.frontendObjectKey === frontendKey);
  assert(notebook, "The requested notebook must be connected.");
  const target = { notebookId: notebook.notebookId };
  const formulas = [
    "\\frac{a^2+b^2}{c^2}", "\\sqrt{x}+x_i^2", "\\alpha+\\beta=\\gamma",
    "\\int_0^1 x^2\\,dx", "\\sum_{n=1}^{N} n^2", "1+1",
  ];
  const inserted = [];
  for (const content of formulas) {
    const result = await call("mma_insert_cell", { ...target, afterCellId: "__end__", format: "latex", content });
    assert.equal(result.ok, true, JSON.stringify(result));
    const cellId = result.cells.at(-1).cellId;
    const read = await call("mma_read_cell", { ...target, cellId });
    assert.equal(read.style, "DisplayFormula");
    assert.equal(read.format, "latex");
    assert.equal(read.content, content);
    inserted.push(cellId);
    pass(`render and read ${content}`);
  }
  const replacement = "\\frac{x}{1+x^2}";
  const modified = await call("mma_modify_cell", { ...target, cellId: inserted[0], content: replacement });
  assert.equal(modified.ok, true, JSON.stringify(modified));
  const read = await call("mma_read_cell", { ...target, cellId: inserted[0] });
  assert.equal(read.content, replacement);
  assert.equal(read.format, "latex");
  assert.equal(read.style, "DisplayFormula");
  pass("modify preserves formula format and updates source");
  const before = (await call("mma_list_cells", target)).cells.length;
  for (const [content, error] of [
    ["", "INVALID_LATEX"], ["\\frac{", "INVALID_LATEX"],
    ["\\notacommand{x}", "UNSUPPORTED_LATEX"],
    ["\\begin{align}x\\end{align}", "UNSUPPORTED_LATEX"],
  ]) {
    const result = await call("mma_insert_cell", { ...target, format: "latex", content });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, error, JSON.stringify(result));
    assert.equal(result.error.retryable, false);
    pass(`reject ${JSON.stringify(content)} with ${error}`);
  }
  assert.equal((await call("mma_list_cells", target)).cells.length, before);
  const badEdit = await call("mma_modify_cell", { ...target, cellId: inserted[0], content: "\\frac{" });
  assert.equal(badEdit.error.code, "INVALID_LATEX");
  assert.equal((await call("mma_read_cell", { ...target, cellId: inserted[0] })).content, replacement);
  pass("invalid inserts and edits leave the notebook unchanged");
  const input = await call("mma_insert_cell", { ...target, style: "Input", content: "2 + 2" });
  assert.equal(input.cells.at(-1).style, "Input");
  const text = await call("mma_insert_cell", { ...target, style: "Text", content: "Simple LaTeX formulas verified through MICA." });
  assert.equal(text.cells.at(-1).style, "Text");
  pass("ordinary Input and Text insertion remain available");
  const imagePath = path.join(resultDir, "latex-formulas.png").replaceAll("\\", "/");
  const nativeCode = `micaFormulaCells = Take[Select[Cells[EvaluationNotebook[]], CurrentValue[#, {TaggingRules, "MICA", "format"}] === "latex" &], -${formulas.length}];
micaFormulaExpressions = NotebookRead /@ micaFormulaCells;
micaFormulaChecks = <|
  "formulaCount" -> Length[micaFormulaCells],
  "nonEvaluating" -> And @@ (CurrentValue[#, Evaluatable] === False & /@ micaFormulaCells),
  "fractions" -> !FreeQ[micaFormulaExpressions, _FractionBox],
  "roots" -> !FreeQ[micaFormulaExpressions, _SqrtBox],
  "scripts" -> !FreeQ[micaFormulaExpressions, _SubsuperscriptBox],
  "uncomputedAddition" -> !FreeQ[micaFormulaExpressions, RowBox[{"1", "+", "1"}]],
  "symbolValueNotSubstituted" -> Block[{Global\`x = 123}, FreeQ[MMAAgentBridge\`Private\`MakeLatexCellExpression["x^2"], "123"]]
|>;
Export[${JSON.stringify(imagePath)}, Rasterize[Notebook[micaFormulaExpressions, StyleDefinitions -> "Default.nb"], "Image", ImageResolution -> 120]];
ExportString[micaFormulaChecks, "RawJSON"]`;
  const nativeInsert = await call("mma_insert_cell", { ...target, style: "Input", content: nativeCode });
  const nativeCellId = nativeInsert.cells.at(-1).cellId;
  await call("mma_run_cell", { ...target, cellId: nativeCellId, timeoutSec: 60 });
  let nativeResult;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const output = await call("mma_get_cell_output", { ...target, cellId: nativeCellId });
    if (output.outputs?.length) {
      nativeResult = JSON.parse(output.outputs.at(-1));
      if (typeof nativeResult === "string") nativeResult = JSON.parse(nativeResult);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert(nativeResult, "Native notebook inspection did not produce a result.");
  assert.equal(nativeResult.formulaCount, formulas.length);
  for (const [name, result] of Object.entries(nativeResult)) {
    if (name !== "formulaCount") assert.equal(result, true, name);
  }
  pass("native boxes are rendered, non-evaluating, and preserve symbolic values");
  await writeFile(path.join(resultDir, "latex-smoke-results.json"), JSON.stringify({
    notebookId: notebook.notebookId, frontendObjectKey: frontendKey,
    wolframVersion: notebook.wolframVersion, checks, formulaCellIds: inserted, nativeResult, imagePath,
  }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, notebookId: notebook.notebookId }));
} finally {
  await client.close();
}
