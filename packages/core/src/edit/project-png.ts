import type { OptionListAst } from "../options/types.js";

export type ProjectPng = { key: string; width: number; height: number };

export const PROJECT_PNG_KEY = /^[0-9a-f]{64}\.(?:png|pdf)$/u;
export const PNG_LOCK_MARKER = "tikzbench locked/.try";
export function isProjectPngLocked(options: OptionListAst | undefined): boolean {
  return options?.entries.some((entry) => entry.raw.trim() === PNG_LOCK_MARKER) ?? false;
}

/** The editable subset emitted by the project PNG tool. Dimensions are in TeX pt. */
export function parseProjectPng(text: string): ProjectPng | null {
  const match = /^\s*\\includegraphics\s*\[\s*width\s*=\s*(\d+(?:\.\d+)?)pt\s*,\s*height\s*=\s*(\d+(?:\.\d+)?)pt\s*\]\s*\{assets\/([0-9a-f]{64}\.(?:png|pdf))\}\s*$/u.exec(text);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 && width <= 16_000 && height <= 16_000 ? { key: match[3], width, height } : null;
}

export function projectPngText({ key, width, height }: ProjectPng): string {
  if (!PROJECT_PNG_KEY.test(key) || ![width, height].every((value) => Number.isFinite(value) && value > 0 && value <= 16_000)) throw new Error("Invalid project PNG geometry.");
  return `\\includegraphics[width=${Math.max(0.001, width).toFixed(3)}pt,height=${Math.max(0.001, height).toFixed(3)}pt]{assets/${key}}`;
}
