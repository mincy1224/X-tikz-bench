import type { CitationLinks } from "./citation-links.js";

const citation = /\\cite\b\s*(?:\[([^\]]*)\]\s*)?\{([^{}]+)\}/gu;

function splitKeys(value: string): string[] {
  return value.split(",").map((key) => key.trim()).filter(Boolean);
}

export function collectCitationKeys(source: string): string[] {
  const uncommented = source.replace(/(?<!\\)%[^\r\n]*/gu, "");
  return [...new Set([...uncommented.matchAll(citation)].flatMap((match) => splitKeys(match[2])))];
}

export function renderCitationLabels(text: string, labels: Readonly<Record<string, string>>, settings?: CitationLinks, mathMode = false): string {
  return text.replace(citation, (_match, note: string | undefined, keys: string, offset: number) => {
    const values = splitKeys(keys).map((key) => Object.hasOwn(labels, key) ? labels[key] : "?");
    if (values.every((value) => /^[1-9]\d*$/u.test(value))) {
      const numbers = [...new Set(values.map(Number))].sort((a, b) => a - b);
      values.length = 0;
      for (let start = 0; start < numbers.length;) {
        let end = start;
        while (end + 1 < numbers.length && numbers[end + 1] === numbers[end] + 1) end++;
        if (end - start >= 2) values.push(numbers[start] + "–" + numbers[end]);
        else for (let index = start; index <= end; index++) values.push(String(numbers[index]));
        start = end + 1;
      }
    }
    const label = "[" + values.join(", ") + (note ? ", " + note : "") + "]";
    if (!settings?.enabled || settings.format === "plain") return label;
    const delimiters = text.slice(0, offset).match(/(?<!\\)(?:\$\$?|\\[()[\]])/gu);
    const inMath = mathMode || Boolean(delimiters && delimiters.length % 2);
    const content = inMath ? label : "\\text{" + label + "}";
    const decorated = settings.format === "underline" ? "\\underline{" + content + "}" : content;
    const colored = "\\textcolor{" + settings.color + "}{" + decorated + "}";
    return inMath ? colored : "$" + colored + "$";
  });
}
