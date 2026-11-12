import { scanTikzFigures } from "../parser/figure-scan.js";
import { readTexGroup, skipTexSpace } from "./environment.js";

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
