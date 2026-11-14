import { useState, type FormEvent } from "react";
import { PROJECT_PALETTE_BLOCK } from "tikz-editor/tex/project-source";
import { BASIC_PICKER_COLOR_SET } from "../colors/color-palette";
import { useEditorStore } from "../store/store";
import css from "./App.module.css";

const paletteColor = /^\\definecolor\{([a-z][a-z0-9]*)-([a-z][a-z0-9]*)\}\{HTML\}\{([0-9a-f]{6})\}$/imu;
const identifier = /^[a-z][a-z0-9]*$/u;

export function ProjectPalette({ palette, onChange }: { palette: string; onChange: (palette: string) => Promise<void> }) {
  const source = useEditorStore((state) => state.source);
  const match = PROJECT_PALETTE_BLOCK.exec(palette);
  const entries = (match?.[1] ?? "").split(/\r?\n/u).flatMap((line) => {
    const color = paletteColor.exec(line);
    return color ? [{ group: color[1], name: color[2], hex: color[3], line }] : [];
  });
  const groups = [...new Set(entries.map(({ group }) => group))];
  const [group, setGroup] = useState("theme");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#4656b8");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");

  async function save(next: string): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await onChange(next);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const normalizedGroup = group.trim().toLowerCase();
    const normalizedName = name.trim().toLowerCase();
    if (!identifier.test(normalizedGroup) || !identifier.test(normalizedName)) {
      setError("组名和颜色名请用英文字母开头，其余字符可用字母或数字。");
      return;
    }
    const token = `${normalizedGroup}-${normalizedName}`;
    if (BASIC_PICKER_COLOR_SET.has(token) || (palette + source).toLowerCase().includes(`{${token}}`)) {
      setError(`颜色名 ${token} 已被使用。`);
      return;
    }
    const line = `\\definecolor{${token}}{HTML}{${color.slice(1).toUpperCase()}}`;
    const definitions = match?.[1] ?? "";
    if (await save(`% x-tikz-bench: palette start\n${definitions}${line}\n% x-tikz-bench: palette end\n`)) setName("");
  }

  return <section className={css.projectPalette} aria-label="项目配色盘">
    {groups.length > 0 && <div className={css.projectPaletteGroups}>{groups.map((id) => <fieldset key={id}>
      <legend>{id}</legend>
      {entries.filter((entry) => entry.group === id).map((entry) => <div className={css.projectColor} key={entry.name}>
        <input type="color" aria-label={`修改 ${id}-${entry.name}`} disabled={busy} value={`#${entry.hex.toLowerCase()}`} onChange={(event) => {
          const next = entry.line.replace(/\{[0-9a-f]{6}\}$/iu, `{${event.currentTarget.value.slice(1).toUpperCase()}}`);
          if (next !== entry.line) void save(palette.replace(entry.line, () => next));
        }} />
        <button type="button" className={css.projectColorCopy} title="点击复制颜色名" aria-label={`复制 ${id}-${entry.name}`}
          onMouseLeave={() => { setCopied(""); }} onBlur={() => { setCopied(""); }} onClick={() => {
            const token = `${id}-${entry.name}`;
            void navigator.clipboard.writeText(token).then(() => { setCopied(token); }).catch(() => { setError("无法访问剪贴板。"); });
          }}>
          <code>{id}-{entry.name}</code><span aria-hidden="true">{copied === `${id}-${entry.name}` ? "✓" : "⧉"}</span>
        </button>
      </div>)}
    </fieldset>)}</div>}
    <form onSubmit={(event) => { void add(event); }}>
      <label>组名 <input value={group} onChange={(event) => { setGroup(event.currentTarget.value); }} required /></label>
      <label>颜色名 <input value={name} onChange={(event) => { setName(event.currentTarget.value); }} placeholder="accent" required /></label>
      <label>颜色 <input type="color" value={color} onChange={(event) => { setColor(event.currentTarget.value); }} /></label>
      <button type="submit" className={css.projectExport} disabled={busy}>添加颜色</button>
    </form>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
