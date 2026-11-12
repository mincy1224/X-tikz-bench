import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStandaloneDocument } from "../apps/server/src/latex/compiler.js";
import { readPngDimensions, referencedPngKeys } from "../apps/server/src/projects/png.js";

const executable = path.resolve(process.env.TIKZ_TUNTEX_CLIENT ?? String.raw`D:\Programs\tunTeX-xtikzbench\tuntex-client.exe`);
const [, , input, destination = "artifacts/tuntex-xelatex"] = process.argv;
if (!input) throw new Error("Usage: npm run verify:tuntex -- path/to/fixture.tex [output-dir]");
const source = await readFile(input, "utf8");
const configured = await readFile(path.join(path.dirname(executable), "tun-tex-cfg.yaml"), "utf8");
const socket = /^socket:\s*["']?(https?:\/\/[^\s"']+)/mu.exec(configured)?.[1];
if (!socket) throw new Error("tuntex: socket is missing from the installed client configuration.");
const projectKey = /^project_key:[^\r\n]+/mu.exec(configured)?.[0];
if (!projectKey) throw new Error("tuntex: project_key is missing from the installed client configuration.");
const keys = referencedPngKeys(source);
const assetKey = process.env.TIKZ_TUNTEX_ASSET_PROJECT_KEY;
const defaultKey = projectKey.slice(projectKey.indexOf(":") + 1).trim().replace(/^["']|["']$/gu, "");
if (keys.length && (!assetKey || assetKey === defaultKey)) {
  throw new Error("tuntex temporary mode uploads only the TeX file. For PNG fixtures, set TIKZ_TUNTEX_ASSET_PROJECT_KEY to a separate registered key whose remote workspace is disposable.");
}
const target = path.resolve(destination);
const root = await mkdtemp(path.join(os.tmpdir(), "tikz-tuntex-check-"));
try {
  // The Windows client reads its adjacent YAML. Run identical executable bytes
  // beside an isolated config; never scan or change the installed workspace.
  const client = path.join(root, path.basename(executable));
  const workspace = path.join(root, "job");
  await mkdir(workspace);
  await copyFile(executable, client);
  await writeFile(path.join(root, "tun-tex-cfg.yaml"), [
    `socket: ${JSON.stringify(socket)}`,
    "tex: xelatex", `input_mode: ${keys.length ? "project" : "temporary"}`,
    ...(keys.length ? [`workspace: ${JSON.stringify(workspace.split(path.sep).join("/"))}`, `project_key: ${JSON.stringify(assetKey)}`] : [projectKey]),
    "timeout_seconds: 90", "max_upload_size: 67108864", "max_file_count: 128", "forward_env: []"
  ].join("\n") + "\n");
  if (keys.length) await mkdir(path.join(workspace, "assets"));
  for (const key of keys) {
    const data = await readFile(path.join(path.dirname(path.resolve(input)), "assets", key));
    readPngDimensions(data);
    await writeFile(path.join(workspace, "assets", key), data);
  }
  await writeFile(path.join(workspace, "proof.tex"), createStandaloneDocument(source, "xelatex"), "utf8");
  const run = (args: string[]) => {
    const result = spawnSync(client, args, { cwd: workspace, timeout: 100_000, windowsHide: true, encoding: "utf8", shell: false });
    if (result.error || result.status !== 0) throw new Error(`tuntex XeLaTeX failed: ${result.error?.message ?? (result.stderr || result.stdout).trim().slice(-3000)}`);
  };
  const args = ["-no-shell-escape", "-interaction=nonstopmode", "-file-line-error", "-halt-on-error", "proof.tex"];
  run(args);
  const pdf = await readFile(path.join(workspace, "proof.pdf"));
  if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("tuntex did not return a valid PDF.");
  const log = await readFile(path.join(workspace, "proof.log"), "utf8");
  if (!/This is XeTeX/u.test(log)) throw new Error("The compiler log does not identify XeTeX.");
  run(["-no-pdf", ...args]);
  const xdv = await readFile(path.join(workspace, "proof.xdv"));
  if (xdv[0] !== 247 || ![5, 6, 7].includes(xdv[1])) throw new Error("tuntex did not return a valid XDV.");
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "proof.pdf"), pdf);
  await writeFile(path.join(target, "proof.xdv"), xdv);
  await writeFile(path.join(target, "proof.log"), log);
  process.stdout.write(`Verified XeLaTeX PDF and XDV: ${target}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
