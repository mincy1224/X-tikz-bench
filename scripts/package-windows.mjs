import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw new Error("Run this packaging command on Windows.");

const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const release = path.join(root, "release");
await mkdir(release, { recursive: true });
if (await realpath(release) !== release) throw new Error("The release directory must be inside the checkout.");
const stage = await mkdtemp(path.join(release, ".windows-"));
try {
  for (const item of ["apps/web/dist", "apps/server/dist", "start-windows.cmd", "README.md", "LICENSE", "NOTICE.md"]) {
    const destination = path.join(stage, item);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(root, item), destination, { recursive: true });
  }
  await writeFile(path.join(stage, "apps/server/package.json"), '{"type":"module"}\n');
  const archive = path.join(release, "x-tikz-bench-windows.zip");
  execFileSync("powershell.exe", [
    "-NoProfile", "-Command",
    "Compress-Archive -Path (Join-Path $env:TIKZ_WINDOWS_STAGE '*') -DestinationPath $env:TIKZ_WINDOWS_ARCHIVE -Force"
  ], { env: { ...process.env, TIKZ_WINDOWS_STAGE: stage, TIKZ_WINDOWS_ARCHIVE: archive }, stdio: "inherit" });
  console.log(archive);
} finally {
  await rm(stage, { recursive: true, force: true });
}
