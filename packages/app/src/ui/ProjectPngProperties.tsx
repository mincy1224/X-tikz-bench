import { useEditorStore } from "../store/store";
import { parseProjectPng, projectPngText, PNG_LOCK_MARKER, type EditAction } from "tikz-editor/edit/actions";
import { findPathStatementById } from "tikz-editor/edit/statement-find";
import css from "./App.module.css";

export function ProjectPngProperties() {
  const selected = useEditorStore((state) => state.selectedElementIds);
  const snapshot = useEditorStore((state) => state.snapshot);
  const source = useEditorStore((state) => state.source);
  if (selected.size !== 1 || !snapshot.parseResult || snapshot.source !== source) return null;
  const elementId = [...selected][0];
  const image = snapshot.scene?.elements.find((element) => element.kind === "Path" && element.projectPng && element.sourceRef.sourceId === elementId);
  if (image?.kind !== "Path" || !image.projectPng) return null;
  const statement = findPathStatementById(snapshot.parseResult.figure.body, elementId);
  const node = statement?.items.find((item) => item.kind === "Node" && Boolean(parseProjectPng(item.text)));
  if (node?.kind !== "Node") return null;
  const png = parseProjectPng(node.text);
  if (!png) return null;
  const locked = image.projectPng.locked;
  const dispatch = (action: EditAction) => {
    const state = useEditorStore.getState();
    if (state.source === source) state.dispatch({ type: "APPLY_EDIT_ACTION", action });
  };
  const property = (key: string, value: string) => { dispatch({ kind: "setProperty", elementId: node.id, level: "command", key, value }); };
  const toggleLock = () => {
    const state = useEditorStore.getState();
    if (state.source !== source) return;
    const options = node.optionsSpan;
    const from = options?.from ?? node.span.from, to = options?.to ?? from;
    const value = source.slice(from, to);
    const marker = /(^\[\s*|,\s*)tikzbench locked\/\.try(?=\s*[,\]])/u;
    const replacement = locked ? value.replace(marker, (_match, prefix: string) => prefix.startsWith("[") ? "[" : "").replace(/^\[\s*,\s*/u, "[").replace(/^\[\s*\]$/u, "") : options
      ? value.replace(/\]$/u, `, ${PNG_LOCK_MARKER}]`) : `[${PNG_LOCK_MARKER}]`;
    if (replacement !== value) state.dispatch({ type: "COMMIT_PROPERTY_SOURCE", expectedSource: source,
      source: source.slice(0, from) + replacement + source.slice(to), label: locked ? "解锁 PNG" : "锁定 PNG" });
  };
  const format = png.key.endsWith(".pdf") ? "PDF" : "PNG";
  return <div className={css.projectObjectBar} role="group" aria-label={`${format} 属性`}>
    <strong>{format}</strong>
    {(["width", "height"] as const).map((axis) => <label key={axis}>{axis === "width" ? "宽度" : "高度"} (pt)
      <input key={`${elementId}:${png[axis]}`} type="number" min="0.1" max="16000" step="0.1" disabled={locked} defaultValue={png[axis]} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => {
        const value = event.currentTarget.valueAsNumber;
        if (value >= 0.1 && value <= 16_000 && value !== png[axis]) dispatch({ kind: "updateNodeText", elementId, text: projectPngText({ ...png, [axis]: value }) });
        else event.currentTarget.value = String(png[axis]);
      }} />
    </label>)}
    <label>不透明度 (%)
      <input key={`${elementId}:${image.style.textOpacity}`} type="number" min="0" max="100" disabled={locked} defaultValue={Math.round(image.style.textOpacity * 100)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => {
        const value = event.currentTarget.valueAsNumber;
        if (value >= 0 && value <= 100 && value !== Math.round(image.style.textOpacity * 100)) property("opacity", String(value / 100));
        else event.currentTarget.value = String(Math.round(image.style.textOpacity * 100));
      }} />
    </label>
    <button type="button" onClick={toggleLock}>{locked ? "解锁" : "锁定"}</button>
    <button type="button" disabled={locked} onClick={() => { dispatch({ kind: "reorderElements", elementIds: [elementId], direction: "bringToFront" }); }}>置顶</button>
    <button type="button" disabled={locked} onClick={() => { dispatch({ kind: "reorderElements", elementIds: [elementId], direction: "sendToBack" }); }}>置底</button>
  </div>;
}
