import css from "./ProjectBrand.module.css";

export function ProjectBrand({ compact = false }: { compact?: boolean }) {
  return <div className={css.brand} data-compact={compact || undefined}>
    <span className={css.mark} aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" focusable="false">
        <path fill="currentColor" d="M1 1h3.5L8 6l3.5-5H15l-5.2 7 5.2 7h-3.5L8 10l-3.5 5H1l5.2-7z" />
      </svg>
    </span>
    <strong className={css.name}>X-TikZ Bench</strong>
  </div>;
}
