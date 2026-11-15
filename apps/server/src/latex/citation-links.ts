import type { CitationLinks } from "../../../../packages/core/src/tex/citation-links.js";

function readBracedField(source: string, start: number): { text: string; end: number } | null {
  let depth = 1;
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === "\\") { index++; continue; }
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0) return { text: source.slice(start + 1, index), end: index + 1 };
  }
  return null;
}

export function bibliographyUrls(source: string): Map<string, string> {
  const urls = new Map<string, string>();
  const entry = /@(\w+)\s*([({])\s*([^,\s{}()]+)\s*,/gu;
  for (const match of source.matchAll(entry)) {
    if (/^(?:comment|string|preamble)$/iu.test(match[1])) continue;
    const close = match[2] === "{" ? "}" : ")";
    const fields = new Map<string, string>();
    const field = /\s*,?\s*([a-z]+)\s*=\s*/iyu;
    let cursor = match.index + match[0].length;
    while (cursor < source.length) {
      field.lastIndex = cursor;
      const name = field.exec(source)?.[1];
      if (!name) break;
      cursor = field.lastIndex;
      if (source[cursor] === "{") {
        const group = readBracedField(source, cursor);
        if (!group) break;
        fields.set(name.toLowerCase(), group.text);
        cursor = group.end;
      } else if (source[cursor] === '"') {
        const quoted = /"((?:\\.|[^"\\])*)"/yu;
        quoted.lastIndex = cursor;
        const value = quoted.exec(source);
        if (!value) break;
        fields.set(name.toLowerCase(), value[1]);
        cursor = quoted.lastIndex;
      } else {
        while (cursor < source.length && source[cursor] !== "," && source[cursor] !== close) cursor++;
      }
    }
    const doi = fields.get("doi")?.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/iu, "");
    const candidates = [doi && /^10\.\d+\/\S+$/u.test(doi) ? "https://doi.org/" + doi : "", fields.get("url")?.trim() ?? ""];
    for (const candidate of candidates) {
      const unescaped = candidate.replace(/\\([%&#_])/gu, "$1");
      if (!/^https?:\/\/[^\s\\{}]+$/iu.test(unescaped)) continue;
      try {
        const url = new URL(unescaped);
        if (url.username || url.password || !url.hostname) continue;
        urls.set(match[3], url.href.replace(/[{}\\^]/gu, (character) => encodeURIComponent(character)));
        break;
      } catch { /* Ignore invalid bibliography URLs. */ }
    }
  }
  return urls;
}

export function citationLinkPreamble(source: string, settings: CitationLinks, loadHyperref: boolean): string {
  const entries = [...bibliographyUrls(source)].filter(([key]) => /^[\p{L}\p{N}._:/+@-]+$/u.test(key));
  const definitions = entries.map(([key, url]) => "\\expandafter\\xdef\\csname xtbcite@b@" + key + "\\endcsname{\\detokenize{" + url + "}}");
  const label = settings.format === "underline" ? "\\textcolor{xtbcitelink}{\\underline{#2}}" :
    settings.format === "color" ? "\\textcolor{xtbcitelink}{#2}" : "#2";
  return [
    ...(loadHyperref ? ["\\usepackage{hyperref}"] : []),
    "\\definecolor{xtbcitelink}{HTML}{" + settings.color.slice(1) + "}",
    "\\makeatletter",
    "\\begingroup\\catcode37=12\\catcode35=12",
    ...definitions,
    "\\endgroup",
    "\\newcommand\\xtbcite@link[2]{\\begingroup\\hypersetup{hidelinks}\\href{#1}{" + label + "}\\endgroup}",
    // cite uses hyper@@link for its labels, and temporarily disables it when
    // sorting. Redirect only the cite branch and keep the original behavior
    // for all other hyperlink types.
    "\\let\\xtbcite@original\\hyper@link@",
    "\\def\\hyper@link@[#1]#2#3#4{%",
    "  \\def\\xtbcite@kind{#1}\\def\\xtbcite@citation{cite}%",
    "  \\ifx\\xtbcite@kind\\xtbcite@citation",
    "    \\expandafter\\xtbcite@target#3\\@nil{#4}%",
    "  \\else\\xtbcite@original[#1]{#2}{#3}{#4}\\fi}",
    "\\def\\xtbcite@target cite.#1\\@nil#2{%",
    "  \\ifcsname xtbcite@b@#1\\endcsname",
    "    \\expandafter\\expandafter\\expandafter\\xtbcite@link\\expandafter\\expandafter\\expandafter{\\csname xtbcite@b@#1\\endcsname}{#2}%",
    "  \\else #2\\fi}",
    "\\makeatother"
  ].join("\n");
}
