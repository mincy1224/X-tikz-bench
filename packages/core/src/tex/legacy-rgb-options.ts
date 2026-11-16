import { parseOptionListRaw } from "../options/parse.js";
import { readTexGroup } from "./environment.js";

// Exact RGB as previously emitted by the visual color picker.
export const LEGACY_BARE_RGB = /^\{\s*rgb\s*,\s*255\s*:\s*red\s*,\s*\d{1,3}\s*;\s*green\s*,\s*\d{1,3}\s*;\s*blue\s*,\s*\d{1,3}\s*\}$/iu;

export function repairLegacyRgbOptions(source: string): string {
  if (!/rgb\s*,\s*255\s*:/iu.test(source)) return source;
  const edits: { offset: number; text: string }[] = [];
  const command = /\\[%\\]|%[^\r\n]*|\\(draw|fill)(?![a-zA-Z@])(?=\s*\[)/gu;
  for (const match of source.matchAll(command)) {
    const key = match[1];
    if (!key) continue;
    const start = source.indexOf("[", match.index + match[0].length);
    const group = readTexGroup(source, start, "[", "]");
    if (!group) continue;
    const options = parseOptionListRaw(source.slice(start, group.end), start);
    for (const option of options.entries) {
      if (option.kind === "unknown" && LEGACY_BARE_RGB.test(option.raw)) {
        edits.push({ offset: option.span.from, text: key + "=" });
      }
    }
  }
  let output = source;
  for (const { offset, text } of edits.reverse()) {
    output = output.slice(0, offset) + text + output.slice(offset);
  }
  return output;
}
