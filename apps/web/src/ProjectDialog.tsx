import { useEffect, useRef, useState } from "react";
import css from "./TikzBench.module.css";

export function ProjectDialog({ name: initialName = "", description: initialDescription = "", canvasAction, onSubmit, onClose }: {
  name?: string;
  description?: string;
  canvasAction?: "create" | "rename";
  onSubmit: (name: string, description: string) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled),textarea:not(:disabled),button:not(:disabled)') ?? []);
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previous instanceof HTMLElement) previous.focus(); };
  }, [busy, onClose]);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [error, setError] = useState<string | null>(null);
  return <div className={css.dialogBackdrop}>
    <section ref={dialog} className={css.projectDialog} role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
      <h2 id="project-dialog-title">{canvasAction === "create" ? "新建画布" : canvasAction === "rename" ? "重命名画布" : "项目信息"}</h2>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError(null);
        void onSubmit(name.trim(), description).then(onClose).catch((error_: unknown) => {
          setError(error_ instanceof Error ? error_.message : String(error_));
        }).finally(() => { setBusy(false); });
      }}>
        <label>{canvasAction ? "画布名称" : "项目名称"} <input autoFocus required maxLength={120} value={name} disabled={busy} onChange={(event) => { setName(event.target.value); }} /></label>
        {!canvasAction && <label>描述 <span>可选</span><textarea maxLength={2000} rows={4} value={description} disabled={busy} onChange={(event) => { setDescription(event.target.value); }} /></label>}
        {error ? <p role="alert" className={css.error}>{error}</p> : null}
        <div className={css.actions}><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className={css.primary} disabled={busy || !name.trim()}>{busy ? "正在保存…" : canvasAction === "create" ? "创建" : canvasAction === "rename" ? "保存名称" : "确定"}</button></div>
      </form>
    </section>
  </div>;
}
