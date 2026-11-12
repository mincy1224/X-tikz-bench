import { PT_PER_CM } from "./format.js";

const LENGTH = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:cm|mm|pt|bp)?`;
const POINT = String.raw`\(\s*(${LENGTH})\s*,\s*(${LENGTH})\s*\)`;
const RECTANGLE = new RegExp(String.raw`^\s*\\(draw|filldraw|fill|path)\s*(\[[^\[\]\r\n]*\])?\s*${POINT}\s+rectangle\s+${POINT}\s*;\s*$`, "u");
const UNSAFE_OPTIONS = /(?:^|,)\s*(?:x|y|[xy]?scale|[xy]?shift|shift only|rotate(?: around)?|cm|transform shape|name path)\s*(?:=|,|$)/u;

const ptLength = (raw: string) => Number.parseFloat(raw) * (/mm\s*$/u.test(raw) ? PT_PER_CM / 10 : /bp\s*$/u.test(raw) ? 72.27 / 72 : /pt\s*$/u.test(raw) ? 1 : PT_PER_CM);
const format = (length: number) => `${Number(length.toFixed(4))}pt`;

export function readSimpleRectangle(source: string) {
  const match = RECTANGLE.exec(source);
  if (!match || UNSAFE_OPTIONS.test(match[2]?.slice(1, -1) ?? "")) return null;
  const [x0, y0, x1, y1] = match.slice(3, 7).map(ptLength) as [number, number, number, number];
  if (x0 === x1 || y0 === y1) return null;
  return { command: match[1], options: match[2] ?? "", x0, y0, x1, y1, width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

export function rewriteSimpleRectangle(rectangle: NonNullable<ReturnType<typeof readSimpleRectangle>>, change: { width?: number; height?: number; text?: string }): string {
  const { x0, y0, x1, y1, command, options } = rectangle;
  const width = change.width ?? rectangle.width, height = change.height ?? rectangle.height;
  if (change.text !== undefined) {
    const paint = command === "filldraw" ? "draw,fill," : command === "path" ? "" : `${command},`;
    return `\\node[${paint}${options ? `${options.slice(1, -1)},` : ""}shape=rectangle, transform shape, inner sep=0pt, outer sep=0pt, minimum width=${format(width)}, minimum height=${format(height)}] at (${format((x0 + x1) / 2)},${format((y0 + y1) / 2)}) {${change.text}};`;
  }
  return `\\${command}${options} (${format(x0)},${format(y0)}) rectangle (${format(x0 + Math.sign(x1 - x0) * width)},${format(y0 + Math.sign(y1 - y0) * height)});`;
}
