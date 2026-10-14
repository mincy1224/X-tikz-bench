import { parseAdvancedObjects, advancedOptionValues, setAdvancedOption, type AdvancedObject } from "./advanced-objects.js";
import { computeSourceFingerprint } from "../utils/source-fingerprint.js";
import { parseTikzForEdit } from "./parse-options.js";
import { applyEditAction } from "./actions.js";
import type { Statement } from "../ast/types.js";
import { extractTexEnvironment } from "../tex/environment.js";

export type CompiledObjectBinding = { id: string; key: string; pointCount: number };
export type EditableCompilation = { source: string; sourceVersion: string; bindings: CompiledObjectBinding[] };

function marker(key: string, anchor: string, coordinate: string): string {
  return `\\path[overlay] ${coordinate} node[inner sep=0pt,outer sep=0pt] {\\special{dvisvgm:raw <circle id='tb-${key}-${anchor}' cx='{?x}' cy='{?y}' r='0'/>}};`;
}
function nodeMarkers(key: string, name: string): string {
  return ["center", "north", "south", "east", "west", "south west", "north east", "north west", "south east"].map((anchor) => marker(key, anchor.replaceAll(" ", "-"), `(${name}.${anchor})`)).join("\n");
}
function appendOption(source: string, object: AdvancedObject, updates: Map<string, string>): string {
  let modified = source;
  for (const [key, value] of updates) modified = setAdvancedOption(modified, object.id, key, value);
  // Header-only replacement keeps all offsets in the original document valid.
  const refreshed = parseAdvancedObjects(modified).objects.find((candidate) => candidate.id === object.id);
  if (!refreshed) throw new Error("Cannot instrument incomplete component.");
  return modified.slice(object.options.from, refreshed.options.to);
}

export function instrumentAdvancedDocument(source: string, activeFigureId?: string | null): EditableCompilation {
  const parsed = parseTikzForEdit(source, { activeFigureId });
  const activeFigure = parsed.figures.find((figure) => figure.id === parsed.activeFigureId);
  const document = parseAdvancedObjects(source);
  const changes: { from: number; to: number; text: string }[] = [];
  const bindings: CompiledObjectBinding[] = [];
  for (const [index, object] of document.objects.entries()) {
    if (activeFigure && (object.span.from < activeFigure.span.from || object.span.to > activeFigure.span.to)) continue;
    // groupplot needs per-axis hooks; never inject axis-only commands at its outer end.
    const parent = document.objects.find((candidate) => candidate.id === object.parentId);
    if (object.type === "plot:groupplot" || parent?.type === "plot:groupplot") continue;
    const key = String(index); const name = `tbEditable${index}`;
    bindings.push({ id: object.id, key, pointCount: object.data?.length ?? 0 });
    const options = advancedOptionValues(source, object);
    const updates = new Map<string, string>();
    if (object.family === "forest") {
      const prior = options.get("node options+") ?? "{}";
      updates.set("node options+", `{${prior.replace(/^\{|\}$/gu, "")},alias=${name}}`);
      const priorTikz = options.get("tikz+") ?? "{}";
      updates.set("tikz+", `{${priorTikz.replace(/^\{|\}$/gu, "")} ${nodeMarkers(key, name)}${index === 0 && !/\\begin\{(?:tikzpicture|circuitikz)\}/u.test(source) ? marker("world", "basis0", "(0pt,0pt)") + marker("world", "basisx", "(1pt,0pt)") + marker("world", "basisy", "(0pt,1pt)") : ""}}`);
    } else if (object.family === "circuit") {
      const existing = options.get("name");
      if (existing && !/^[a-zA-Z0-9_-]+$/u.test(existing)) continue;
      if (!existing) updates.set("name", name);
      const semicolon = source.indexOf(";", object.span.to);
      if (semicolon >= 0 && semicolon < object.environment.to) changes.push({ from: semicolon + 1, to: semicolon + 1, text: nodeMarkers(key, existing ?? name) });
    } else if (object.parentId) {
      const open = "\\special{dvisvgm:raw <g id='tb-plot-" + key + "'>}";
      const close = "\\special{dvisvgm:raw </g>}";
      for (const [hook, code] of [["execute at begin plot visualization", open], ["execute at end plot visualization", close]]) {
        updates.set(hook, `{${(options.get(hook) ?? "").replace(/^\{|\}$/gu, "")} ${code}}`);
      }
      if (object.data?.length) {
        const markers = object.data.map((point, pointIndex) => marker(key, `point${pointIndex}`, `(axis cs:${point.x},${point.y})`)).join("\n");
        const end = source.lastIndexOf("\\end", object.environment.to - 1);
        changes.push({ from: end, to: end, text: `\\pgfplotsextra{${markers}}\n` });
      }
    } else {
      const end = source.lastIndexOf("\\end", object.environment.to - 1);
      const symbolic = options.get("symbolic x coords")?.replace(/^\{|\}$/gu, "").split(",")[0];
      const code = marker(key, "south-west", "(rel axis cs:0,0)") + marker(key, "north-east", "(rel axis cs:1,1)") +
        marker(key, "basis0", `(axis cs:${symbolic ?? 1},1)`) + marker(key, "basisy", `(axis cs:${symbolic ?? 1},2)`) +
        (symbolic ? "" : marker(key, "basisx", "(axis cs:2,1)"));
      changes.push({ from: end, to: end, text: `\\pgfplotsextra{${code}}\n` });
    }
    if (updates.size) changes.push({ from: object.options.from, to: object.options.to, text: appendOption(source, object, updates) });
  }
  // Ordinary objects in a mixed document use the same compiled overlay.
  const visit = (statements: readonly Statement[]) => {
    for (const statement of statements) {
      if (statement.kind === "Scope") { visit(statement.body); continue; }
      if (statement.kind !== "Path" || document.objects.some((object) => object.environment.from <= statement.span.from && object.environment.to >= statement.span.to)) continue;
      const key = String(document.objects.length + bindings.length); const name = `tbEditable${key}`;
      if (statement.command === "node") {
        const result = applyEditAction(source, [], { kind: "setProperty", elementId: statement.id, level: "command", key: "alias", value: name }, { parseOptions: { activeFigureId } });
        if (result.kind !== "success") continue;
        const suffix = source.length - statement.span.to;
        changes.push({ from: statement.span.from, to: statement.span.to, text: result.newSource.slice(statement.span.from, result.newSource.length - suffix) + nodeMarkers(key, name) });
      } else {
        const open = `\\special{dvisvgm:raw <g id='tb-plot-${key}'>}`;
        const close = "\\special{dvisvgm:raw </g>}";
        changes.push({ from: statement.span.from, to: statement.span.to, text: open + source.slice(statement.span.from, statement.span.to) + close });
      }
      bindings.push({ id: statement.id, key, pointCount: 0 });
    }
  };
  visit(parsed.figure.body);
  const pictureEnd = activeFigure?.endSpan.from ?? Math.max(source.lastIndexOf("\\end{tikzpicture}"), source.lastIndexOf("\\end{circuitikz}"));
  if (pictureEnd >= 0) changes.push({ from: pictureEnd, to: pictureEnd, text: marker("world", "basis0", "(0pt,0pt)") + marker("world", "basisx", "(1pt,0pt)") + marker("world", "basisy", "(0pt,1pt)") });
  let instrumented = source;
  if (activeFigure && parsed.figures.length > 1) {
    // Compile only the active picture. Keep original object IDs and original
    // source ranges in bindings; the temporary copy never enters persistence.
    instrumented = source.slice(activeFigure.span.from, activeFigure.span.to);
    for (const change of changes.filter((change) => change.from >= activeFigure.span.from && change.to <= activeFigure.span.to).sort((a, b) => b.from - a.from || b.to - a.to)) {
      const from = change.from - activeFigure.span.from, to = change.to - activeFigure.span.from;
      instrumented = instrumented.slice(0, from) + change.text + instrumented.slice(to);
    }
    const environment = extractTexEnvironment(source);
    const context = parsed.figure.body.filter((statement) => statement.span.from >= environment.prefixEnd && statement.span.to <= activeFigure.span.from)
      .map((statement) => source.slice(statement.span.from, statement.span.to)).join("\n");
    const prefix = source.slice(0, environment.prefixEnd);
    instrumented = environment.completeDocument
      ? `${prefix}\\begin{document}\n${context}\n${instrumented}\n\\end{document}`
      : `${prefix}\n${context}\n${instrumented}`;
    return { source: instrumented, sourceVersion: computeSourceFingerprint(`${source}\0${parsed.activeFigureId}`), bindings };
  }
  for (const change of changes.sort((a, b) => b.from - a.from || b.to - a.to)) instrumented = instrumented.slice(0, change.from) + change.text + instrumented.slice(change.to);
  return { source: instrumented, sourceVersion: computeSourceFingerprint(source), bindings };
}
