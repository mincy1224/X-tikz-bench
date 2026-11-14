import { useState, type FormEvent } from "react";
import { PROJECT_PALETTE_BLOCK, withProjectPalette } from "tikz-editor/tex/project-source";
import { BASIC_PICKER_COLOR_SET } from "../colors/color-palette";
import { useEditorStore } from "../store/store";
import css from "./App.module.css";

const paletteColor = /^\\definecolor\{([a-z][a-z0-9]*)-([a-z][a-z0-9]*)\}\{HTML\}\{([0-9a-f]{6})\}$/imu;
const identifier = /^[a-z][a-z0-9]*$/u;

export function ProjectPalette() {
  const source = useEditorStore((state) => state.source);
  const match = PROJECT_PALETTE_BLOCK.exec(source);
  const entries = (match?.[1] ?? "").split(/\r?\n/u).flatMap((line) => {
    const color = paletteColor.exec(line);
    return color ? [{ group: color[1], name: color[2], hex: color[3], line }] : [];
  });
  const groups = [...new Set(entries.map(({ group }) => group))];
  const [group, setGroup] = useState("theme");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#4656b8");
  const [error, setError] = useState("");

  function commit(next: string, label: string) {
    useEditorStore.getState().dispatch({ type: "COMMIT_PROPERTY_SOURCE", expectedSource: source, source: next, label });
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedGroup = group.trim().toLowerCase();
    const normalizedName = name.trim().toLowerCase();
    if (!identifier.test(normalizedGroup) || !identifier.test(normalizedName)) {
      setError("组名和颜色名请用英文字母开头，其余字符可用字母或数字。");
      return;
    }
    const token = `${normalizedGroup}-${normalizedName}`;
    if (BASIC_PICKER_COLOR_SET.has(token) || source.toLowerCase().includes(`{${token}}`)) {
      setError(`颜色名 ${token} 已被使用。`);
      return;
    }
    const line = `\\definecolor{${token}}{HTML}{${color.slice(1).toUpperCase()}}`;
    if (match) {
      const end = match.index + match[0].lastIndexOf("% x-tikz-bench: palette end");
      commit(source.slice(0, end) + line + "\n" + source.slice(end), "添加项目颜色");
    } else {
      const block = `% x-tikz-bench: palette start\n${line}\n% x-tikz-bench: palette end\n`;
      commit(withProjectPalette(source, block), "添加项目颜色");
    }
    setError("");
    setName("");
  }

  return <section className={css.projectPalette} aria-label="项目配色盘">
    {groups.map((id) => <fieldset key={id}>
      <legend>{id}</legend>
      {entries.filter((entry) => entry.group === id).map((entry) => <label key={entry.name}>
        <input type="color" aria-label={`修改 ${id}-${entry.name}`} value={`#${entry.hex.toLowerCase()}`} onChange={(event) => {
          if (!match) return;
          const start = match.index + match[0].indexOf(entry.line);
          const next = entry.line.replace(/\{[0-9a-f]{6}\}$/iu, `{${event.currentTarget.value.slice(1).toUpperCase()}}`);
          commit(source.slice(0, start) + next + source.slice(start + entry.line.length), "修改项目颜色");
        }} />
        <code>{id}-{entry.name}</code>
      </label>)}
    </fieldset>)}
    <form onSubmit={add}>
      <label>组名 <input value={group} onChange={(event) => { setGroup(event.currentTarget.value); }} required /></label>
      <label>颜色名 <input value={name} onChange={(event) => { setName(event.currentTarget.value); }} placeholder="accent" required /></label>
      <label>颜色 <input type="color" value={color} onChange={(event) => { setColor(event.currentTarget.value); }} /></label>
      <button type="submit" className={css.projectExport}>添加颜色</button>
    </form>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
