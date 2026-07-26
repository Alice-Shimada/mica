import { toolSuccess, type StructuredToolResult } from "./toolResults.js";

export function symbolLookupToolSuccess(value: unknown): StructuredToolResult {
  const result = toolSuccess(value);
  return {
    ...result,
    content: [{ type: "text", text: formatSymbolLookupText(result.structuredContent) }],
  };
}

export function formatSymbolLookupText(payload: Record<string, unknown>): string {
  switch (readString(payload.status)) {
    case "found":
      return formatFoundSymbol(payload);
    case "ambiguous":
      return formatSymbolCandidates(payload);
    case "not_found":
      return formatNotFound(payload);
    case "bad_request":
      return `## Invalid symbol lookup\n\n${readString(payload.message) ?? "The query is invalid."}`;
    default:
      return JSON.stringify(payload, null, 2);
  }
}

function formatFoundSymbol(payload: Record<string, unknown>): string {
  const symbol = readString(payload.symbol);
  if (!symbol) return JSON.stringify(payload, null, 2);

  const usage = readString(payload.usage);
  const attributes = readStringArray(payload.attributes);
  const options = readRecordArray(payload.options)
    .map((option) => ({ name: readString(option.name), defaultValue: readString(option.default) }))
    .filter((option): option is { name: string; defaultValue: string } => Boolean(option.name && option.defaultValue));
  const url = readString(payload.url);
  const lines = [`## ${inlineCode(symbol)}`];

  if (usage) lines.push("", usage);
  if (attributes.length > 0) {
    lines.push("", `**Attributes:** ${attributes.map(inlineCode).join(", ")}`);
  }
  if (options.length > 0) {
    lines.push("", `### Options (${options.length})`, "");
    lines.push(...options.map((option) => `- ${inlineCode(`${option.name} -> ${option.defaultValue}`)}`));
  }
  if (url) lines.push("", `**Documentation:** [Wolfram Language reference](${url})`);

  return lines.join("\n");
}

function formatSymbolCandidates(payload: Record<string, unknown>): string {
  const query = readString(payload.query) ?? "";
  const candidates = readRecordArray(payload.candidates);
  if (candidates.length === 0) return JSON.stringify(payload, null, 2);

  const lines = [`## Symbols matching ${inlineCode(query)}`, ""];
  candidates.forEach((candidate, index) => {
    const symbol = readString(candidate.symbol) ?? "Unknown symbol";
    const usage = readString(candidate.usage);
    lines.push(`${index + 1}. ${inlineCode(symbol)}${usage ? ` — ${singleLine(usage)}` : ""}`);
  });
  lines.push("", "Call `mma_symbol_lookup` again with an exact symbol name for complete usage, options, and attributes.");
  return lines.join("\n");
}

function formatNotFound(payload: Record<string, unknown>): string {
  const query = readString(payload.query) ?? "";
  const message = readString(payload.message) ?? `No System symbol matches ${query}.`;
  return [
    `## No symbol found for ${inlineCode(query)}`,
    "",
    message,
    "",
    "Try a shorter search term or check the symbol's spelling and capitalization.",
  ].join("\n");
}

function inlineCode(value: string): string {
  const normalized = singleLine(value);
  let fence = "`";
  while (normalized.includes(fence)) fence += "`";
  return `${fence}${normalized}${fence}`;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(readString).filter((item): item is string => Boolean(item)) : [];
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item))
    : [];
}
