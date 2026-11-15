import { useContext, useRef, useState } from "react";
import { tikzColor } from "tikz-editor/edit/editable-objects";
import { parseLength } from "tikz-editor/semantic/coords/parse-length";
import { usePropertyEditSession } from "./usePropertyEditSession";
import { ColorPickerField } from "../ColorPicker";
import { ProjectPaletteColorsContext } from "../../colors/project-named-colors";
import css from "../format-panel.module.css";

export function ColorField({ label, value, syntaxValue = value, write }: { label: string; value: string | null; syntaxValue?: string | null; write: (source: string, value: string) => string }) {
  const palette = useContext(ProjectPaletteColorsContext);
  const displaySyntax = palette && syntaxValue && Object.hasOwn(palette, syntaxValue) ? syntaxValue : value;
  const { update, commitPreview, cancel, error } = usePropertyEditSession(label);
  const preview = (color: string) => { update((base) => write(base, tikzColor(color)), true); };
  const finish = (shouldCancel: boolean) => { if (shouldCancel) cancel(); else commitPreview(); };
  return <div className={css.field}><span>{label}</span><ColorPickerField ariaLabel={label} options={["none", "black", "white", "red", "orange", "yellow", "green", "blue", "violet", "gray"]} value={value} syntaxValue={displaySyntax} mixed={value === null}
    onPreview={preview} onChange={(color) => { preview(color); finish(false); }} onCommit={() => { finish(false); }} onCancel={() => { finish(true); }} />{error ? <small role="alert">{error}</small> : null}</div>;
}

/** Draft input owns its transaction; IME text is never parsed mid-composition. */
export function Field({ label, value, write, unit, multiline = false, allowNegative = false, resettable = true }: { label: string; value: string | null; write: (source: string, value: string) => string; unit?: string; multiline?: boolean; allowNegative?: boolean; resettable?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const { update, commitPreview, cancel, error, reject } = usePropertyEditSession(label);
  const composing = useRef(false); const cancelled = useRef(false);
  const preview = (raw: string) => {
    try {
      let next = raw;
      if (unit && raw.trim()) {
        const length = parseLength(raw, "pt");
        if (length == null || !Number.isFinite(length) || !allowNegative && length < 0) throw new Error("请输入有效数值，可使用 pt、mm、cm 或 in。");
        next = `${length}pt`;
      }
      update((base) => write(base, next), true);
    } catch (error_) { reject(error_ instanceof Error ? error_.message : String(error_)); }
  };
  const props = {
    "aria-label": label, value: draft ?? value ?? "", placeholder: value === null ? "多个值" : "继承／默认",
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { const raw = event.target.value; setDraft(raw); if (!composing.current) preview(raw); },
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => { composing.current = false; preview(event.currentTarget.value); },
    onBlur: () => { if (cancelled.current) cancel(); else commitPreview(); cancelled.current = false; setDraft(null); },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (composing.current || event.nativeEvent.isComposing) return;
      if (unit && ["ArrowUp", "ArrowDown"].includes(event.key)) {
        const current = parseLength(event.currentTarget.value || "0", "pt");
        if (current !== null) { const next = `${(allowNegative ? (current + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1)) : Math.max(0, current + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1)))}pt`; setDraft(next); preview(next); event.preventDefault(); }
        event.stopPropagation();
      }
      if (event.key === "Escape") { cancelled.current = true; event.currentTarget.blur(); event.stopPropagation(); }
      if (event.key === "Enter" && (!multiline || event.ctrlKey)) { event.currentTarget.blur(); event.preventDefault(); }
    }
  };
  return <label className={css.field}><span>{label}</span><div>{multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}{unit ? <small>{unit} · ↑↓ 步进</small> : null}{!multiline && resettable ? <button type="button" className={css.reset} aria-label={`${label}恢复默认`} title="移除局部设置，恢复继承或默认值" onClick={() => { preview(""); commitPreview(); setDraft(null); }}>恢复默认</button> : null}</div>{error ? <small role="alert">{error}</small> : null}</label>;
}
