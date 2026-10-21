import { z } from "zod";

export const noArgsSchema = z.object({}).strict();

const notebookIdField = z.string().min(1);
const notebookSelectorFields = {
  notebookId: notebookIdField.optional(),
  displayName: z.string().min(1).optional()
};
const maxBytesField = z.number().int().positive().max(1024 * 1024);
const cellFormatField = z.enum(["plain", "latex"]).optional().describe("Use latex for a simple math formula rendered as a non-evaluating DisplayFormula cell; plain preserves existing code/text behavior.");

export const selectNotebookSchema = z.object({
  notebookId: notebookIdField.optional(),
  displayName: z.string().min(1).optional()
}).strict();

export const readCellSchema = z.object({
  ...notebookSelectorFields,
  cellId: z.string().min(1),
  maxBytes: maxBytesField.optional()
}).strict();

export const insertCellSchema = z.object({
  ...notebookSelectorFields,
  afterCellId: z.string().min(1).optional(),
  style: z.string().min(1).default("Input"),
  format: cellFormatField,
  content: z.string()
}).strict();

export const modifyCellSchema = z.object({
  ...notebookSelectorFields,
  cellId: z.string().min(1),
  format: cellFormatField.describe("Use latex to render a simple formula; omitted format preserves an existing MICA LaTeX cell's format."),
  content: z.string()
}).strict();

export const deleteCellSchema = z.object({
  ...notebookSelectorFields,
  cellId: z.string().min(1)
}).strict();

export const runCellSchema = z.object({
  ...notebookSelectorFields,
  cellId: z.string().min(1),
  timeoutSec: z.number().int().positive().optional()
}).strict();

export const abortEvaluationSchema = z.object({
  ...notebookSelectorFields
}).strict();

export const killKernelSchema = z.object({
  ...notebookSelectorFields
}).strict();

export const restartKernelSchema = z.object({
  ...notebookSelectorFields
}).strict();

export const createNotebookSchema = z.object({
  title: z.string().min(1).describe("Window title for the new notebook")
}).strict();

export const openNotebookSchema = z.object({
  path: z.string().min(1).describe("Absolute path to an existing .nb file"),
  visible: z.boolean().optional().describe("Open hidden in the Wolfram FrontEnd without showing a window (default true; hidden opens require a live agent)")
}).strict();

export const setNotebookVisibleSchema = z.object({
  ...notebookSelectorFields,
  visible: z.boolean().describe("Whether the notebook window should be visible in the Wolfram FrontEnd")
}).strict();

export const getCellOutputSchema = z.object({
  ...notebookSelectorFields,
  cellId: z.string().min(1),
  maxBytes: maxBytesField.optional()
}).strict();

export const readArtifactSchema = z.object({
  ...notebookSelectorFields,
  artifactId: z.string().min(1),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().max(1024 * 1024).default(65_536)
}).strict();

export const listCellsSchema = z.object({
  ...notebookSelectorFields
}).strict();

export const saveNotebookSchema = z.object({
  ...notebookSelectorFields
}).strict();

export const symbolLookupSchema = z.object({
  query: z.string().min(1).describe("Symbol name or partial search term")
}).strict();
