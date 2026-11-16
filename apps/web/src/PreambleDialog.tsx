import { useEffect, useRef, useState } from "react";
import css from "./TikzBench.module.css";

export function PreambleDialog({ initialValue, onSave, onClose }: {
  initialValue: string;
  onSave: (source: string) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={css.projectDialog} aria-labelledby="preamble-title" onCancel={(event) => {
    event.preventDefault();
    if (!busy) onClose();
  }}>
    <h2 id="preamble-title">画布导言区</h2>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setError("");
      void onSave(value).then(onClose).catch((error_: unknown) => {
        setError(error_ instanceof Error ? error_.message : String(error_));
      }).finally(() => { setBusy(false); });
    }}>
      <label>自定义 LaTeX 导言区
        <textarea className={css.preambleSource} autoFocus spellCheck={false} rows={12} value={value} disabled={busy}
          onChange={(event) => { setValue(event.currentTarget.value); }} />
      </label>
      <p>可添加宏包、命令和 TikZ 样式。保存后会应用到当前画布的 TeX 校样、Copy Config 和工程导出。</p>
      {error && <p role="alert" className={css.error}>{error}</p>}
      <div className={css.actions}>
        <button type="button" disabled={busy} onClick={onClose}>取消</button>
        <button type="submit" disabled={busy} className={css.primary}>{busy ? "正在保存…" : "保存导言区"}</button>
      </div>
    </form>
  </dialog>;
}
