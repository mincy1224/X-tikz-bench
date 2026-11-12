import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";

const bash = process.platform === "win32" ? "D:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const posix = (value: string) => process.platform === "win32" ? `/${value[0].toLowerCase()}${value.slice(2).replaceAll("\\", "/")}` : value;

describe("release installer lifecycle in an isolated filesystem", () => {
  it("keeps TikZ Bench separate during install, upgrade, and rollback", async () => {
    await access(bash);
    const workspace = path.resolve(process.cwd());
    const directory = await mkdtemp(path.join(workspace, ".installer-test-"));
    const root = posix(directory);
    const put = async (relative: string, text: string) => {
      const file = path.join(directory, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text, { mode: 0o755 });
    };
    try {
      let installer = await readFile("scripts/install-release.sh", "utf8");
      installer = installer.replaceAll("/opt/x-tikz-bench", `${root}/opt`).replaceAll("/var/backups/x-tikz-bench", `${root}/backups`).replaceAll("/var/lib/x-tikz-bench", `${root}/data`).replaceAll("/run/lock", `${root}/locks`).replaceAll("/etc/default", `${root}/etc/default`).replaceAll("/etc/systemd/system", `${root}/etc/systemd/system`).replaceAll("/usr/local/bin/", `${root}/bin/`).replace('[[ $EUID -ne 0 ]]', 'false');
      await put("package/install.sh", installer);
      await put("package/manifest.json", JSON.stringify({ schema: 1, version: "0.6.0" }));
      await put("package/apps/server/dist/index.js", "new program");
      await put("package/apps/server/dist/verify-runtime.js", "// staged runtime verifier");
      await put("package/scripts/x-tikz-bench", "new cli");
      await put("package/scripts/x-tikz-bench.service", "new service");
      const files = ["install.sh", "manifest.json", "apps/server/dist/index.js", "apps/server/dist/verify-runtime.js", "scripts/x-tikz-bench", "scripts/x-tikz-bench.service"];
      await put("package/SHA256SUMS", (await Promise.all(files.map(async (file) => `${createHash("sha256").update(await readFile(path.join(directory, "package", file))).digest("hex")}  ${file}`))).join("\n") + "\n");
      await put("opt/apps/server/dist/index.js", "legacy program");
      await put("etc/default/x-tikz-bench", "CUSTOM_SETTING=preserved\n");
      await put("etc/systemd/system/x-tikz-bench.service", "legacy service");
      await put("data/x-tikz-bench.sqlite", "existing project data");
      await put("bin/x-tikz-bench", "legacy cli");
      const oldInstallation = {
        "bin/tikz-bench": "old CLI",
        "etc/default/tikz-bench": "TIKZ_SERVER_PORT=5173",
        "etc/systemd/system/tikz-bench.service": "old service",
        "data/tikz-bench.sqlite": "old project data",
      };
      for (const [file, contents] of Object.entries(oldInstallation)) await put(file, contents);
      await put("active", "1"); await put("enabled", "1");
      await mkdir(path.join(directory, "locks"), { recursive: true });
      await put("tex/latex", "#!/bin/bash\nexit 0\n"); await put("tex/xelatex", "#!/bin/bash\nexit 0\n");
      await put("mock/ps", "#!/bin/bash\necho systemd\n");
      await put("mock/fc-list", "#!/bin/bash\necho ChineseFont\n");
      await put("mock/flock", "#!/bin/bash\nexit 0\n");
      await put("mock/sleep", "#!/bin/bash\nexit 0\n");
      await put("mock/systemd-run", "#!/bin/bash\n[[ ${!#} == */apps/server/dist/verify-runtime.js && -f ${!#} ]]\n");
      await put("mock/apt-get", "#!/bin/bash\nexit 99\n");
      if (process.platform === "win32") await put("mock/install", "#!/bin/bash\nif [[ $1 == -d ]]; then shift; if [[ $1 == -m ]]; then shift 2; fi; mkdir -p \"$@\"; else if [[ $1 == -m ]]; then shift 2; fi; cp \"$1\" \"$2\"; fi\n");
      if (process.platform === "win32") {
        await put("mock/ln", "#!/bin/bash\nshift; node -e 'const f=require(\"fs\");const [target,link]=process.argv.slice(1);try{f.unlinkSync(link)}catch{}f.symlinkSync(target,link,\"junction\")' \"$1\" \"$2\"\n");
        await put("mock/mv", "#!/bin/bash\nif [[ $1 == -Tf ]]; then shift; node -e 'const f=require(\"fs\");const [from,to]=process.argv.slice(1);try{f.unlinkSync(to)}catch{}f.renameSync(from,to)' \"$1\" \"$2\"; else /usr/bin/mv \"$@\"; fi\n");
      }
      await put("mock/curl", "#!/bin/bash\n[[ ${!#} == http://127.0.0.1:5175/api/health && ${FAIL_HEALTH:-0} == 0 ]] || exit 1\necho '{\"ok\":true}'\n");
      await put("mock/sqlite3", `#!/bin/bash\nif [[ $1 == --version ]]; then echo 3.45; exit; fi\ndestination=$(printf '%s' "$2" | sed "s/^\\.backup '//;s/'$//")\ncp "$1" "$destination"\n`);
      await put("mock/systemctl", `#!/bin/bash\ncase $1 in\nis-active) [[ -f '${root}/active' ]] ;;\nis-enabled) [[ -f '${root}/enabled' ]] ;;\nstart) touch '${root}/active' ;;\nstop) rm -f '${root}/active' ;;\nenable) touch '${root}/enabled' ;;\ndisable) rm -f '${root}/enabled' ;;\n*) exit 0 ;;\nesac\n`);
      const run = (fail = false) => spawnSync(bash, ["-c", `export PATH='${root}/mock':$PATH; export TIKZ_TEX_BIN_DIR='${root}/tex'; bash '${root}/package/install.sh'`], { encoding: "utf8", timeout: 60000, env: { ...process.env, FAIL_HEALTH: fail ? "1" : "0" } });
      const first = run(); expect(first.status, first.stdout + first.stderr).toBe(0);
      expect(await readFile(path.join(directory, "data/x-tikz-bench.sqlite"), "utf8")).toBe("existing project data");
      expect(await readFile(path.join(directory, "etc/default/x-tikz-bench"), "utf8")).toContain("CUSTOM_SETTING=preserved");
      const repeat = run(); expect(repeat.status, repeat.stdout + repeat.stderr).toBe(0);
      await put("package/manifest.json", JSON.stringify({ schema: 1, version: "0.6.1" }));
      await put("package/apps/server/dist/index.js", "different new program");
      await put("package/SHA256SUMS", (await Promise.all(files.map(async (file) => `${createHash("sha256").update(await readFile(path.join(directory, "package", file))).digest("hex")}  ${file}`))).join("\n") + "\n");
      const previousConfig = await readFile(path.join(directory, "etc/default/x-tikz-bench"), "utf8");
      const previousCli = await readFile(path.join(directory, "bin/x-tikz-bench"), "utf8");
      const failed = run(true); expect(failed.status).not.toBe(0);
      expect(await readFile(path.join(directory, "opt/current/apps/server/dist/index.js"), "utf8")).toBe("new program");
      expect(await readFile(path.join(directory, "data/x-tikz-bench.sqlite"), "utf8")).toBe("existing project data");
      expect(await readFile(path.join(directory, "etc/default/x-tikz-bench"), "utf8")).toBe(previousConfig);
      expect(await readFile(path.join(directory, "bin/x-tikz-bench"), "utf8")).toBe(previousCli);
      await access(path.join(directory, "active"));
      let manager = await readFile("scripts/manage-release.sh", "utf8");
      manager = manager.replaceAll("/opt/x-tikz-bench", `${root}/opt`).replaceAll("/var/lib/x-tikz-bench", `${root}/data`).replaceAll("/run/lock", `${root}/locks`).replaceAll("/etc/default", `${root}/etc/default`).replace('[[ $EUID == 0 ]]', 'true');
      await put("manage.sh", manager);
      const rollback = spawnSync(bash, ["-c", `export PATH='${root}/mock':$PATH; bash '${root}/manage.sh' rollback`], { encoding: "utf8", timeout: 60000 });
      expect(rollback.status, rollback.stdout + rollback.stderr).toBe(0);
      expect(await readFile(path.join(directory, "opt/current/apps/server/dist/index.js"), "utf8")).toBe("legacy program");
      expect(await readFile(path.join(directory, "data/x-tikz-bench.sqlite"), "utf8")).toBe("existing project data");
      for (const [file, contents] of Object.entries(oldInstallation)) {
        expect(await readFile(path.join(directory, file), "utf8")).toBe(contents);
      }
      await expect(access(path.join(directory, "unexpected-service"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (!path.resolve(directory).startsWith(workspace + path.sep)) throw new Error("Unsafe test cleanup target");
      await rm(directory, { recursive: true, force: true });
    }
  }, 120000);
});
