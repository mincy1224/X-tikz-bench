import { scanTikzFigures } from "../parser/figure-scan.js";
import { readTexGroup, skipTexSpace } from "./environment.js";

export const DEFAULT_PROJECT_FONT = String.raw`% x-tikz-bench: font start
\IfPackageLoadedTF{fontspec}{}{\usepackage[no-math]{fontspec}}
\IfFontExistsTF{Times New Roman}{\setmainfont{Times New Roman}}{%
  \IfFontExistsTF{TeX Gyre Termes}{\setmainfont{TeX Gyre Termes}}{}}
% x-tikz-bench: font end`;

export function withoutProjectFontBlock(source: string): string {
  return source.replace(/^% x-tikz-bench: font start\r?\n[\s\S]*?^% x-tikz-bench: font end(?:\r?\n|$)/mu, "");
}

export const PROJECT_PALETTE_BLOCK = /^% x-tikz-bench: palette start\r?\n([\s\S]*?)^% x-tikz-bench: palette end(?:\r?\n|$)/mu;

export function withProjectPalette(source: string, palette: string): string {
  const body = source.replace(PROJECT_PALETTE_BLOCK, "");
  if (!palette) return body;
  const picture = splitProjectSource(body);
  return picture ? `${picture.prefix}\n${palette.trimEnd()}\n${picture.body}\n${picture.suffix}` : `${palette.trimEnd()}\n${body}`;
}

/** Split a single picture at its real environment boundaries. */
export function splitProjectSource(source: string): { body: string; prefix: string; suffix: string } | null {
  const pictures = scanTikzFigures(source).filter((figure) => !figure.isTemplate);
  if (pictures.length !== 1) return null;
  const picture = pictures[0];
  const options = readTexGroup(source, skipTexSpace(source, picture.beginSpan.to), "[", "]");
  const from = options?.end ?? picture.beginSpan.to;
  const body = source.slice(from, picture.endSpan.from).replace(/^[ \t]*\r?\n/u, "").replace(/\r?\n[ \t]*$/u, "");
  return { body, prefix: source.slice(0, from), suffix: source.slice(picture.endSpan.from) };
}
