import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.TIKZ_SERVER_HOST = "127.0.0.1";
process.env.TIKZ_SERVER_PORT ??= "4173";
process.env.TIKZ_DATABASE_PATH = path.join(os.tmpdir(), `tikz-bench-e2e-${process.pid}.sqlite`);
process.env.TIKZ_WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/web/dist");
await import("../apps/server/dist/index.js");
