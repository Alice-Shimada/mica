import { describe, expect, it } from "vitest";
import { symbolLookupToolSuccess } from "../src/mcp/symbolLookupResults.js";

describe("symbol lookup MCP results", () => {
  it("renders an exact symbol as readable Markdown and preserves structured fields", () => {
    const result = symbolLookupToolSuccess({
      status: "found",
      symbol: "Plot",
      usage: "Plot[f, {x, xmin, xmax}] generates a plot of f as a function of x.",
      options: [
        { name: "PlotRange", default: "Automatic" },
        { name: "PlotStyle", default: "Automatic" },
      ],
      attributes: ["HoldAll", "Protected"],
      url: "https://reference.wolfram.com/language/ref/Plot.html",
    });

    expect(result.structuredContent).toMatchObject({
      ok: true,
      status: "found",
      symbol: "Plot",
      options: expect.any(Array),
    });
    expect(result.content[0]!.text).toContain("## `Plot`");
    expect(result.content[0]!.text).toContain("**Attributes:** `HoldAll`, `Protected`");
    expect(result.content[0]!.text).toContain("### Options (2)");
    expect(result.content[0]!.text).toContain("- `PlotRange -> Automatic`");
    expect(result.content[0]!.text).toContain("[Wolfram Language reference]");
    expect(result.content[0]!.text.trimStart()).not.toMatch(/^\{/);
  });

  it("renders ambiguous matches as a compact numbered list with a next step", () => {
    const result = symbolLookupToolSuccess({
      status: "ambiguous",
      query: "integrate",
      candidates: [
        { symbol: "System`Integrate", usage: "Integrate[f, x] gives an indefinite integral." },
        { symbol: "System`NIntegrate", usage: "NIntegrate[f, {x, xmin, xmax}] gives a numerical integral." },
      ],
    });

    expect(result.content[0]!.text).toContain("## Symbols matching `integrate`");
    expect(result.content[0]!.text).toContain("1. ``System`Integrate``");
    expect(result.content[0]!.text).toContain("2. ``System`NIntegrate``");
    expect(result.content[0]!.text).toContain("Call `mma_symbol_lookup` again with an exact symbol name");
    expect(result.structuredContent).toMatchObject({
      ok: true,
      status: "ambiguous",
      query: "integrate",
    });
  });

  it("gives a useful retry hint when no symbol matches", () => {
    const result = symbolLookupToolSuccess({
      status: "not_found",
      query: "ListPlto",
      message: "No System` symbols match 'ListPlto'",
    });

    expect(result.content[0]!.text).toContain("## No symbol found for `ListPlto`");
    expect(result.content[0]!.text).toContain("check the symbol's spelling and capitalization");
    expect(result.structuredContent).toMatchObject({
      ok: true,
      status: "not_found",
      query: "ListPlto",
    });
  });
});
