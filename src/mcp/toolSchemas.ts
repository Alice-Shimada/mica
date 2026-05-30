import { z } from "zod";

export const noArgsSchema = z.object({}).strict();

const notebookIdField = z.string().min(1);
const notebookSelectorFields = {
  notebookId: notebookIdField.optional(),
  displayName: z.string().min(1).optional()
};

export const notebookTargetSchema = z.object(notebookSelectorFields).strict();

export const selectNotebookSchema = z.object({
  notebookId: notebookIdField.optional(),
  displayName: z.string().min(1).optional()
}).strict();

export const readCellSchema = z.object({
  ...notebookSelectorFields,
  cellId: z.string().min(1)
}).strict();

export const insertCellSchema = z.object({
  ...notebookSelectorFields,
  afterCellId: z.string().min(1).optional(),
  style: z.string().min(1).default("Input"),
  content: z.string()
}).strict();

export const modifyCellSchema = z.object({
  ...notebookSelectorFields,
  cellId: z.string().min(1),
  content: z.string()
}).strict();

export const deleteCellSchema = z.object({
  ...notebookSelectorFields,
  cellId: z.string().min(1)
}).strict();

export const runCellSchema = z.object({
  ...notebookSelectorFields,
  cellId: z.string().min(1),
  timeoutSec: z.number().int().positive().max(3600).default(120)
}).strict();

export const abortEvaluationSchema = z.object({
  ...notebookSelectorFields
}).strict();

export const getCellOutputSchema = z.object({
  ...notebookSelectorFields,
  cellId: z.string().min(1)
}).strict();

export const listCellsSchema = z.object({
  ...notebookSelectorFields
}).strict();

export const saveNotebookSchema = z.object({
  ...notebookSelectorFields
}).strict();
