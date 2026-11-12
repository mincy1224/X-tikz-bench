import { basename, dirname, join, normalize } from "node:path/posix";
import { unzipSync } from "fflate";
import { MAX_PROJECT_PNG_BYTES } from "./png.js";
import { prepareAsset, type PreparedAsset } from "./prepare-asset.js";
import { splitProjectSource } from "../../../../packages/core/src/tex/project-source.js";
import { projectPngText } from "../../../../packages/core/src/edit/project-png.js";
import { parseLength } from "../../../../packages/core/src/semantic/coords/parse-length.js";

const utf8 = new TextDecoder("utf-8", { fatal: true });

function archivePath(name: string): string {
  const path = normalize(name.replaceAll("\\", "/"));
  if (/^(?:\/|\.\.\/)|:/u.test(path) || path === ".." || path.includes("\0")) throw new Error("压缩包包含不安全的文件路径。");
  return path;
}

export async function importProjectArchive(bytes: Buffer, maxSourceBytes: number): Promise<{ source: string; assets: PreparedAsset[] }> {
  let total = 0, count = 0;
  const archive = unzipSync(bytes, { filter: ({ name, originalSize }) => {
    archivePath(name);
    if (++count > 256 || (total += originalSize) > MAX_PROJECT_PNG_BYTES + 4 * maxSourceBytes) {
      throw new Error("压缩包包含过多文件或解压后过大。");
    }
    return /\.(?:tex|tikz|png|pdf)$/iu.test(name);
  } });
  const entries = new Map(Object.entries(archive).map(([name, data]) => [archivePath(name), data]));
  const main = entries.has("main.tex") ? "main.tex" : [...entries.keys()].find((name) => basename(name) === "main.tex");
  if (!main) throw new Error("压缩包中缺少 main.tex。");
  const active = new Set<string>();
  let expandedBytes = 0;
  const expand = (file: string): string => {
    if (active.has(file) || active.size > 16) throw new Error(`TeX 输入文件循环引用：${file}`);
    const data = entries.get(file);
    if (!data) throw new Error(`找不到 TeX 输入文件：${file}`);
    expandedBytes += data.length;
    if (expandedBytes > maxSourceBytes) throw new Error("展开后的 TeX 源码过大。");
    active.add(file);
    let text = utf8.decode(data);
    if (basename(file) === "overlay_positions.tex") {
      text = text.replace(/^((?:\s|%[^\r\n]*(?:\r?\n|$))*)\\begin\{scope\}\s*\[\s*overlay\s*\]([\s\S]*)\\end\{scope\}\s*$/u, "$1$2");
    }
    const expanded = text.replace(/(?<!\\)%[^\r\n]*|\\input\s*\{([^{}]+)\}/gu, (match, input: string | undefined) => {
      if (!input) return match;
      const relative = input.trim();
      let target = archivePath(join(dirname(main), relative));
      if (!entries.has(target) && !/\.[^/]+$/u.test(relative)) target += ".tex";
      return `\n${expand(target)}\n`;
    });
    active.delete(file);
    if (Buffer.byteLength(expanded, "utf8") > maxSourceBytes) throw new Error("展开后的 TeX 源码过大。");
    return expanded;
  };
  const full = expand(main);
  const picture = splitProjectSource(full);
  if (!picture) throw new Error("导入的 LaTeX 工程必须包含一幅 tikzpicture。");
  const images = new Map<string, PreparedAsset>();
  const matches = /(?<!\\)%[^\r\n]*|\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^{}]+)\}/gu;
  const files = new Set<string>();
  for (const [, , filename] of picture.body.matchAll(matches)) {
    if (filename) files.add(archivePath(join(dirname(main), filename.trim())));
  }
  const assetFolders = new Set([archivePath(join(dirname(main), "assets")), ...[...files].map(dirname).filter((dir) => dir !== dirname(main))]);
  for (const name of entries.keys()) {
    if (assetFolders.has(dirname(name)) && /\.(?:png|pdf)$/iu.test(name)) files.add(name);
  }
  for (const name of files) {
    const extension = name.toLowerCase().endsWith(".png") ? "png" : name.toLowerCase().endsWith(".pdf") ? "pdf" : null;
    if (!extension) throw new Error(`暂不支持该素材格式：${name}`);
    const data = entries.get(name);
    if (!data) throw new Error(`压缩包中缺少图片：${name}`);
    images.set(name, await prepareAsset(Buffer.from(data), basename(name), extension));
  }
  const body = picture.body.replace(/\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^{}]+)\}/gu, (match, options: string | undefined, filename: string) => {
    const asset = images.get(join(dirname(main), filename.trim()));
    if (!asset) return match;
    const fields = (options ?? "").split(",").map((option) => option.trim()).filter(Boolean);
    const getSize = (axis: string) => {
      const value = fields.find((field) => field.startsWith(`${axis}=`))?.slice(axis.length + 1);
      return value ? parseLength(value.trim(), "pt") : null;
    };
    const width = getSize("width"), height = getSize("height");
    const simple = fields.every((field) => /^(?:width|height)=/u.test(field));
    if (simple && ((width && width > 0) || (height && height > 0))) {
      return projectPngText({ key: asset.key, width: width ?? height! * asset.width / asset.height,
        height: height ?? width! * asset.height / asset.width });
    }
    return match.replace(`{${filename}}`, `{assets/${asset.key}}`);
  });
  const source = `${picture.prefix}\n${body}\n${picture.suffix}`;
  if (Buffer.byteLength(source, "utf8") > maxSourceBytes) throw new Error("导入后的 TeX 源码过大。");
  return { source, assets: [...new Map([...images.values()].map((asset) => [asset.key, asset])).values()] };
}
