import type { CitationLinks } from "../../../../packages/core/src/tex/citation-links.js";

export function citationLinkPreamble(settings: CitationLinks, loadHyperref: boolean, target: string | null): string {
  const citation = settings.format === "underline" ? "\\textcolor{xtbcitelink}{\\underline{\\xtbcite@originalcite{#1}{#2}}}" :
    settings.format === "color" ? "\\textcolor{xtbcitelink}{\\xtbcite@originalcite{#1}{#2}}" : "";
  const destination = target && target !== "references.pdf"
    ? "\\href{" + target + "\\#nameddest=cite.#1}{#2}"
    : "\\hyperref{references.pdf}{cite}{#1}{#2}";
  return [
    ...(target && loadHyperref ? ["\\usepackage{hyperref}"] : []),
    "\\definecolor{xtbcitelink}{HTML}{" + settings.color.slice(1) + "}",
    "\\makeatletter",
    ...(citation ? [
      "\\let\\xtbcite@originalcite\\@cite",
      "\\def\\@cite#1#2{" + citation + "}"
    ] : []),
    ...(target ? [
      // Keep cite's bibliography labels and sorting. Redirect only citation
      // links, leaving other links from the project untouched.
      "\\let\\xtbcite@original\\hyper@link@",
      "\\def\\hyper@link@[#1]#2#3#4{%",
      "  \\def\\xtbcite@kind{#1}\\def\\xtbcite@citation{cite}%",
      "  \\ifx\\xtbcite@kind\\xtbcite@citation",
      "    \\expandafter\\xtbcite@target#3\\@nil{#4}%",
      "  \\else\\xtbcite@original[#1]{#2}{#3}{#4}\\fi}",
      "\\def\\xtbcite@target cite.#1\\@nil#2{%",
      "  \\begingroup\\hypersetup{hidelinks}%",
      "  " + destination + "\\endgroup}"
    ] : []),
    "\\makeatother"
  ].join("\n");
}

export function createReferencesDocument(bblName: string): string {
  return [
    "\\documentclass{article}",
    "\\usepackage{iftex}",
    "\\ifXeTeX\\usepackage{fontspec}\\fi",
    "\\usepackage{hyperref}",
    "\\begin{document}",
    "\\input{" + bblName + "}",
    "\\end{document}",
    ""
  ].join("\n");
}
