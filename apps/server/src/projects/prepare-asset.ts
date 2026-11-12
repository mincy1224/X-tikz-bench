import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_PNG_BYTES, readPngDimensions, type ProjectAsset } from "./png.js";

export type PreparedAsset = ProjectAsset & { data: Buffer; preview: Buffer | null };

function renderPreview(command: string, args: string[], data?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const converter = spawn(command, args,
      { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => { converter.kill(); reject(new Error("PDF 缩略图生成超时。")); }, 10_000);
    converter.stdin.on("error", () => {});
    converter.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PNG_BYTES) { converter.kill(); return; }
      chunks.push(chunk);
    });
    converter.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    converter.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && size > 0 && size <= MAX_PNG_BYTES) resolve(Buffer.concat(chunks));
      else reject(new Error("无法读取 PDF 素材的第一页。"));
    });
    converter.stdin.end(data);
  });
}

async function makePdfPreview(data: Buffer): Promise<Buffer> {
  const page = ["-f", "1", "-l", "1", "-scale-to", "1024", "-png", "-singlefile"];
  try {
    return await renderPreview(process.env.TIKZ_PDFTOCAIRO_BIN ?? "pdftocairo", [...page, "-transp", "-", "-"], data);
  } catch {
    // Some Windows distributions only include pdftoppm. Use it to measure
    // the page, and render with alpha if Ghostscript is installed.
    let raster: Buffer;
    try {
      raster = await renderPreview(process.env.TIKZ_PDFTOPPM_BIN ?? "pdftoppm", [...page, "-"], data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("导入 PDF 素材需要 Poppler（pdftocairo 或 pdftoppm）。", { cause: error });
      }
      throw error;
    }
    const { width, height } = readPngDimensions(raster);
    const directory = await mkdtemp(path.join(tmpdir(), "tikz-pdf-preview-"));
    try {
      const input = path.join(directory, "input.pdf");
      await writeFile(input, data);
      return await renderPreview(process.env.TIKZ_GHOSTSCRIPT_BIN ?? (process.platform === "win32" ? "gswin64c" : "gs"),
        ["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-dFirstPage=1", "-dLastPage=1", "-sDEVICE=pngalpha",
          "-r72", `-g${width}x${height}`, "-dFIXEDMEDIA", "-dPDFFitPage", "-sOutputFile=-", input]);
    } catch {
      return raster;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export async function prepareAsset(data: Buffer, name: string, extension: "png" | "pdf"): Promise<PreparedAsset> {
  if (data.length > MAX_PNG_BYTES) throw new Error("单张素材不能超过 10 MiB。");
  if (extension === "pdf" && data.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("无效的 PDF 素材。");
  const preview = extension === "pdf" ? await makePdfPreview(data) : null;
  const dimensions = readPngDimensions(preview ?? data);
  const key = `${createHash("sha256").update(data).digest("hex")}.${extension}`;
  const basename = name.split(/[\\/]/u).at(-1) ?? "";
  const displayName = [...basename].filter((character) => character.charCodeAt(0) >= 32).join("").trim().slice(0, 160);
  return { key, name: displayName.length ? displayName : key, ...dimensions, data, preview };
}
