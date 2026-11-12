import type { EditActionResultLike } from "../result-types.js";
import { replaceSpan } from "../patch.js";
import { resolvePropertyTarget } from "../property-target.js";
import type { EditParseOptions } from "../parse-options.js";
import { parseMatrixRowsForEdit, resolveMatrixMode } from "../../semantic/nodes/matrix.js";
import type { Span } from "../../ast/types.js";
import { arrayGridBorderSource, ARRAY_EMPTY_CELL, isArrayGrid, MATH_MATRIX_MARKER } from "../matrix-grid-source.js";
import { applyTextReplacements } from "../statement-ops.js";


type MatrixStructureTarget = {
  matrixSourceId: string;
  matrixText: string;
  matrixTextSpan: Span;
  cellSeparator: string;
  arrayGrid: boolean;
  mathPreset: boolean;
  gridBorderSpan?: Span | null;
};

export type AddMatrixRowAction = {
  matrixSourceId: string;
  rowIndex: number;
};

export type RemoveMatrixRowAction = {
  matrixSourceId: string;
  rowIndex: number;
};

export type AddMatrixColumnAction = {
  matrixSourceId: string;
  columnIndex: number;
};

export type RemoveMatrixColumnAction = {
  matrixSourceId: string;
  columnIndex: number;
};

export type TransposeMatrixAction = {
  matrixSourceId: string;
};

export function applyAddMatrixRowAction(
  source: string,
  action: AddMatrixRowAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const target = resolveMatrixStructureTarget(source, action.matrixSourceId, parseOptions);
  if (target.kind !== "ok") {
    return target;
  }
  const { rows, rowCount, colCount } = parseMatrixGrid(target.value);
  if (!Number.isInteger(action.rowIndex) || action.rowIndex < 1 || action.rowIndex > rowCount + 1) {
    return { kind: "unsupported", reason: `addMatrixRow rowIndex must be in 1..${rowCount + 1}.` };
  }
  rows.splice(action.rowIndex - 1, 0, Array.from<string>({ length: colCount }).fill(""));
  return rewriteMatrixText(source, target.value, rows);
}

export function applyRemoveMatrixRowAction(
  source: string,
  action: RemoveMatrixRowAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const target = resolveMatrixStructureTarget(source, action.matrixSourceId, parseOptions);
  if (target.kind !== "ok") {
    return target;
  }
  const { rows, rowCount } = parseMatrixGrid(target.value);
  if (rowCount <= 1) {
    return { kind: "unsupported", reason: "Cannot remove the last matrix row." };
  }
  if (!Number.isInteger(action.rowIndex) || action.rowIndex < 1 || action.rowIndex > rowCount) {
    return { kind: "unsupported", reason: `removeMatrixRow rowIndex must be in 1..${rowCount}.` };
  }
  rows.splice(action.rowIndex - 1, 1);
  return rewriteMatrixText(source, target.value, rows);
}

export function applyAddMatrixColumnAction(
  source: string,
  action: AddMatrixColumnAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const target = resolveMatrixStructureTarget(source, action.matrixSourceId, parseOptions);
  if (target.kind !== "ok") {
    return target;
  }
  const { rows, colCount } = parseMatrixGrid(target.value);
  if (!Number.isInteger(action.columnIndex) || action.columnIndex < 1 || action.columnIndex > colCount + 1) {
    return { kind: "unsupported", reason: `addMatrixColumn columnIndex must be in 1..${colCount + 1}.` };
  }
  for (const row of rows) {
    row.splice(action.columnIndex - 1, 0, "");
  }
  return rewriteMatrixText(source, target.value, rows);
}

export function applyRemoveMatrixColumnAction(
  source: string,
  action: RemoveMatrixColumnAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const target = resolveMatrixStructureTarget(source, action.matrixSourceId, parseOptions);
  if (target.kind !== "ok") {
    return target;
  }
  const { rows, colCount } = parseMatrixGrid(target.value);
  if (colCount <= 1) {
    return { kind: "unsupported", reason: "Cannot remove the last matrix column." };
  }
  if (!Number.isInteger(action.columnIndex) || action.columnIndex < 1 || action.columnIndex > colCount) {
    return { kind: "unsupported", reason: `removeMatrixColumn columnIndex must be in 1..${colCount}.` };
  }
  for (const row of rows) {
    row.splice(action.columnIndex - 1, 1);
  }
  return rewriteMatrixText(source, target.value, rows);
}

export function applyTransposeMatrixAction(
  source: string,
  action: TransposeMatrixAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const target = resolveMatrixStructureTarget(source, action.matrixSourceId, parseOptions);
  if (target.kind !== "ok") {
    return target;
  }
  const { rows, rowCount, colCount } = parseMatrixGrid(target.value);
  const transposed: string[][] = [];
  for (let column = 0; column < colCount; column += 1) {
    const nextRow: string[] = [];
    for (let row = 0; row < rowCount; row += 1) {
      nextRow.push(rows[row][column]);
    }
    transposed.push(target.value.arrayGrid ? nextRow : trimTrailingEmptyCells(nextRow));
  }

  return rewriteMatrixText(source, target.value, transposed);
}

function resolveMatrixStructureTarget(
  source: string,
  matrixSourceId: string,
  parseOptions: EditParseOptions
): { kind: "ok"; value: MatrixStructureTarget } | { kind: "unsupported"; reason: string } {
  const resolved = resolvePropertyTarget(source, matrixSourceId, parseOptions);
  if (resolved.kind === "not-found" || resolved.target.kind !== "matrix-statement") {
    return { kind: "unsupported", reason: `Could not resolve matrix statement ${matrixSourceId}.` };
  }

  const matrixTextSpan = resolved.target.matrixTextSpan;
  if (!matrixTextSpan || matrixTextSpan.to <= matrixTextSpan.from) {
    return { kind: "unsupported", reason: "Matrix text span is unavailable for structural editing." };
  }

  const mode = resolveMatrixMode(resolved.target.options);
  if (!mode.enabled) {
    return { kind: "unsupported", reason: "Matrix structural actions require a matrix statement target." };
  }

  const arrayGrid = isArrayGrid(resolved.target.options);
  const gridBorder = resolved.target.options?.entries.find((entry) => entry.kind === "kv" && entry.key === "append after command");
  return {
    kind: "ok",
    value: {
      matrixSourceId,
      matrixText: source.slice(matrixTextSpan.from, matrixTextSpan.to),
      matrixTextSpan,
      cellSeparator: mode.cellSeparator,
      arrayGrid,
      mathPreset: resolved.target.options?.entries.some((entry) => entry.raw.trim() === MATH_MATRIX_MARKER) ?? false,
      gridBorderSpan: gridBorder?.kind === "kv" ? gridBorder.valueSpan : undefined
    }
  };
}

function parseMatrixGrid(target: MatrixStructureTarget): { rows: string[][]; rowCount: number; colCount: number } {
  const parsed = parseMatrixRowsForEdit(target.matrixText, target.cellSeparator, target.matrixTextSpan.from);
  const rowCount = Math.max(1, parsed.rows.length);
  const colCount = Math.max(
    1,
    parsed.rows.reduce((max, row) => Math.max(max, row.cells.length), 0)
  );
  const rows = parsed.rows.map((row) => {
    const values = row.cells.map((cell) => cell.raw);
    while (values.length < colCount) {
      values.push("");
    }
    return values;
  });
  while (rows.length < rowCount) {
    rows.push(Array.from<string>({ length: colCount }).fill(""));
  }
  return { rows, rowCount, colCount };
}

function trimTrailingEmptyCells(row: string[]): string[] {
  let lastNonEmpty = -1;
  for (let index = row.length - 1; index >= 0; index -= 1) {
    if ((row[index] ?? "").trim().length > 0) {
      lastNonEmpty = index;
      break;
    }
  }
  if (lastNonEmpty < 0) {
    return [""];
  }
  return row.slice(0, lastNonEmpty + 1);
}

function serializeMatrixRows(rows: ReadonlyArray<ReadonlyArray<string>>, separator: string): string {
  const joiner = ` ${separator} `;
  return rows
    .map((row) => [...row].join(joiner))
    .join(" \\\\\n");
}

function rewriteMatrixText(
  source: string,
  target: MatrixStructureTarget,
  rows: string[][]
): EditActionResultLike {
  const matrixTextSpan = target.matrixTextSpan;
  const body = serializeMatrixRows(target.arrayGrid ? rows.map((row) => row.map((cell) => cell.trim() || ARRAY_EMPTY_CELL)) : rows, target.cellSeparator);
  const replacement = target.arrayGrid || target.mathPreset ? `\n  ${body} \\\\\n` : body;
  const changedSourceIds = [target.matrixSourceId];
  if (target.arrayGrid) {
    if (!target.gridBorderSpan || !source.slice(target.gridBorderSpan.from, target.gridBorderSpan.to).startsWith("{\\pgfextra{\\begin{pgfinterruptpath}")) {
      return { kind: "unsupported", reason: "数组边框已手动修改，不能安全重排行列。" };
    }
    const columns = Math.max(1, ...rows.map((row) => row.length));
    const updated = applyTextReplacements(source, [
      { span: target.gridBorderSpan, text: arrayGridBorderSource(rows.length, columns) },
      { span: matrixTextSpan, text: replacement }
    ]);
    return { kind: "success", newSource: updated.source, patches: updated.patches, changedSourceIds };
  }
  const updated = replaceSpan(source, matrixTextSpan, replacement);
  if (updated.source === source) {
    return { kind: "unsupported", reason: "Matrix structural edit would not change the source." };
  }
  return {
    kind: "success",
    newSource: updated.source,
    patches: [
      {
        oldSpan: matrixTextSpan,
        newSpan: updated.changedSpan,
        replacement
      }
    ],
    changedSourceIds
  };
}
