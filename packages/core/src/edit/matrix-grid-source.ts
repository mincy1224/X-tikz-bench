import type { OptionListAst } from "../options/types.js";

export const ARRAY_GRID_MARKER = "tikzbench array grid/.try";
export const MATH_MATRIX_MARKER = "tikzbench math matrix/.try";
export const ARRAY_EMPTY_CELL = "\\relax{}";

export function isArrayGrid(options: OptionListAst | undefined): boolean {
  return options?.entries.some((entry) => entry.raw.trim() === ARRAY_GRID_MARKER) ?? false;
}

/** One stroke after PGF has laid out the cells. Anchors follow matrix moves and transforms. */
export function arrayGridBorderSource(rows: number, columns: number): string {
  const point = (row: number, col: number, side: string) => `{\\pgfpointanchor{\\tikzlastnode-${row}-${col}}{${side}}}`;
  const line = (a: string, b: string) => `\\pgfpathmoveto${a}\\pgfpathlineto${b}`;
  const nw = point(1, 1, "north west"), ne = point(1, columns, "north east");
  const sw = point(rows, 1, "south west"), se = point(rows, columns, "south east");
  const outline = `\\pgfpathmoveto${nw}\\pgfpathlineto${ne}\\pgfpathlineto${se}\\pgfpathlineto${sw}\\pgfpathclose`;
  const vertical = Array.from({ length: columns - 1 }, (_, index) => line(point(1, index + 1, "north east"), point(rows, index + 1, "south east"))).join("");
  const horizontal = Array.from({ length: rows - 1 }, (_, index) => line(point(index + 1, 1, "south west"), point(index + 1, columns, "south east"))).join("");
  return `{\\pgfextra{\\begin{pgfinterruptpath}\\pgfscope\\pgfsetlinewidth{.4pt}\\pgfsetstrokecolor{black}${outline}${vertical}${horizontal}\\pgfusepath{stroke}\\endpgfscope\\end{pgfinterruptpath}}}`;
}
