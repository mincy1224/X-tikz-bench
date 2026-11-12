import { cp, mkdir, readFile, writeFile, readdir, chmod } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [directory, version] = process.argv.slice(2);
if (!directory || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version ?? "")) throw new Error("Expected staging directory and version");
const target = path.resolve(directory);
if (path.dirname(target) !== root || !path.basename(target).startsWith(".install-build-")) throw new Error("Staging directory must be inside the source checkout");
const packageInfo = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
async function copy(from, to) {
  await mkdir(path.dirname(path.join(target, to)), { recursive: true });
  await cp(path.join(root, from), path.join(target, to), { recursive: true, dereference: true });
}
await copy("apps/web/dist", "apps/web/dist");
await copy("apps/server/dist", "apps/server/dist");
await writeFile(path.join(target, "apps/server/package.json"), JSON.stringify({ type: "module", version, private: true }, null, 2) + "\n");
for (const file of ["LICENSE", "NOTICE.md"]) await copy(file, file);
await copy("scripts/install-release.sh", "install.sh");
for (const file of ["manage-release.sh", "verify-runtime.mjs", "x-tikz-bench", "x-tikz-bench.service"]) await copy(`scripts/${file}`, `scripts/${file}`);
await writeFile(path.join(target, "manifest.json"), JSON.stringify({ schema: 1, version, builtAt: new Date().toISOString(), target: "linux", nodeMinimum: 18, tex: "existing-texlive", sourceVersion: packageInfo.version }, null, 2) + "\n");
const licenses = path.join(target, "licenses");
await mkdir(licenses, { recursive: true });
async function collectLicenses(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const full = path.join(directory, entry.name);
    if (entry.name.startsWith("@")) await collectLicenses(full, prefix + entry.name + "-");
    else {
      for (const item of await readdir(full, { withFileTypes: true })) {
        if (item.isFile() && /^(license|licence|copying|notice)(\.|$)/i.test(item.name)) await cp(path.join(full, item.name), path.join(licenses, `${prefix}${entry.name}-${item.name}`));
      }
    }
  }
}
await collectLicenses(path.join(root, "node_modules"));
await collectLicenses(path.join(root, "packages/core/node_modules"), "core-").catch((error) => { if (error.code !== "ENOENT") throw error; });
const entries = [];
async function walk(directory, relative = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, rel);
    else if (entry.isFile()) {
      if (rel.endsWith(".sh") || rel.endsWith(".service") || rel === "scripts/x-tikz-bench") await writeFile(full, (await readFile(full, "utf8")).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"));
      if (rel.endsWith(".sh") || rel === "scripts/x-tikz-bench") await chmod(full, 0o755);
      entries.push([rel, createHash("sha256").update(await readFile(full)).digest("hex")]);
    } else throw new Error(`Unexpected entry: ${rel}`);
  }
}
await walk(target);
entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
await writeFile(path.join(target, "SHA256SUMS"), entries.map(([file, digest]) => `${digest}  ${file}\n`).join(""));
console.log(`Source build prepared for system installation: ${version}`);
