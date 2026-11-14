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

export function withoutProjectPalette(source: string): string {
  return source.replace(new RegExp(PROJECT_PALETTE_BLOCK.source, "gmu"), "");
}

export function projectPaletteColors(palette: string): Readonly<Record<string, string>> {
  const definitions = PROJECT_PALETTE_BLOCK.exec(palette)?.[1] ?? "";
  return Object.fromEntries(Array.from(
    definitions.matchAll(/^\\definecolor\{([a-z][a-z0-9]*-[a-z][a-z0-9]*)\}\{HTML\}\{([0-9a-f]{6})\}\s*$/gimu),
    ([, name, hex]) => [name, `#${hex}`]
  ));
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
