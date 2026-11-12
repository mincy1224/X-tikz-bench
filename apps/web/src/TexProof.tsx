import { useEffect, useRef, useState } from "react";
import css from "./TexProof.module.css";

type Proof = { svgUrl: string; source: string };

export function TexProof({ projectId, source, onClose }: { projectId: string; source: string; onClose: () => void }) {
  const [proof, setProof] = useState<Proof | null>(null);
  const [status, setStatus] = useState<"compiling" | "ready" | "error">("compiling");
  const [message, setMessage] = useState("");
  const version = useRef(0);
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]') ?? []);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => { window.removeEventListener("keydown", onKeyDown, true); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  useEffect(() => {
    const requestVersion = String(++version.current);
    const controller = new AbortController();
    setStatus("compiling");
    const timer = window.setTimeout(() => {
      void fetch("/api/latex/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, source, sourceVersion: requestVersion, engine: "xelatex" }),
        signal: controller.signal
      }).then(async (response) => {
        const result = await response.json() as { svg?: string; sourceVersion?: string; error?: string; diagnostics?: Array<{ message: string }> };
        if (!response.ok || typeof result.svg !== "string" || result.sourceVersion !== requestVersion) {
          throw new Error(result.diagnostics?.[0]?.message ?? result.error ?? "TeX compilation failed.");
        }
        if (controller.signal.aborted || version.current !== Number(requestVersion)) return;
        const svgUrl = URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" }));
        setProof((previous) => {
          if (previous) URL.revokeObjectURL(previous.svgUrl);
          return { svgUrl, source };
        });
        setStatus("ready");
        setMessage("");
      }).catch((error: unknown) => {
        if (controller.signal.aborted || version.current !== Number(requestVersion)) return;
        setStatus("error");
        const details = error instanceof Error ? error.message : String(error);
        setMessage(/(?:spawn|ENOENT)/iu.test(details) ? "服务器尚未配置 XeLaTeX 和 dvisvgm。" : details);
      });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [projectId, source]);

  useEffect(() => () => {
    if (proof) URL.revokeObjectURL(proof.svgUrl);
  }, [proof]);

  const current = status === "ready" && proof?.source === source;
  return <div className={css.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className={css.modal} role="dialog" aria-modal="true" aria-labelledby="tex-proof-title" onKeyDown={(event) => { event.stopPropagation(); }}>
      <header className={css.header}>
        <div><span className={css.eyebrow}>FINAL OUTPUT</span><h2 id="tex-proof-title">TeX 编译校样</h2><p>这里显示由当前源码实际编译的图像。</p></div>
        <div className={css.headerActions}><span className={css.status} data-state={status}>{status === "compiling" ? "正在编译" : status === "error" ? "编译失败" : "与源码同步"}</span><button type="button" className={css.close} onClick={onClose} aria-label="关闭 TeX 校样">×</button></div>
      </header>
      <div className={css.stage} aria-busy={status === "compiling"}>
        {proof ? <img className={css.artwork} src={proof.svgUrl} alt="当前 TikZ 源码的 TeX 编译图像" style={{ opacity: current ? 1 : 0.45 }} /> : null}
        {status === "compiling" ? <div className={css.overlay} role="status"><span className={css.spinner} />TeX 正在编译当前版本…</div> : null}
        {status === "error" ? <div className={css.error} role="alert"><strong>当前源码未能编译</strong><span>{message}</span><small>画面若仍可见，是最后一次成功编译的版本。</small></div> : null}
      </div>
      <footer className={css.footer}><span>校样由 XeLaTeX 生成；下载使用当前校样的编译结果。</span>{current && proof ? <a href={proof.svgUrl} download="xelatex-proof.svg">导出真实 SVG</a> : <button type="button" disabled>导出真实 SVG</button>}</footer>
    </section>
  </div>;
}
