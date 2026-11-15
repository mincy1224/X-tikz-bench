const citation = /\\cite\b\s*(?:\[([^\]]*)\]\s*)?\{([^{}]+)\}/gu;

function splitKeys(value: string): string[] {
  return value.split(",").map((key) => key.trim()).filter(Boolean);
}

export function collectCitationKeys(source: string): string[] {
  const uncommented = source.replace(/(?<!\\)%[^\r\n]*/gu, "");
  return [...new Set([...uncommented.matchAll(citation)].flatMap((match) => splitKeys(match[2])))];
}

export function renderCitationLabels(text: string, labels: Readonly<Record<string, string>>): string {
  return text.replace(citation, (_match, note: string | undefined, keys: string) => {
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
    return "[" + values.join(", ") + (note ? ", " + note : "") + "]";
  });
}
