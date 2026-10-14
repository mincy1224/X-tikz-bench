import path from "node:path";

export type ServerConfig = {
  host: string;
  port: number;
  latexBin: string;
  kpsewhichBin?: string;
  xelatexBin?: string;
  dvisvgmBin: string;
  dvipdfmxBin: string;
  sqliteBin: string;
  databasePath: string;
  timeoutMs: number;
  maxSourceBytes: number;
  maxConcurrency: number;
  webRoot: string;
};

function positiveInt(value: string | undefined, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function parseArgs(argv: readonly string[]): { host?: string; port?: number } {
  let host: string | undefined;
  let port: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--host" && argv[index + 1]) host = argv[++index];
    else if (argument.startsWith("--host=")) host = argument.slice(7) || undefined;
    else if (argument === "--port" && argv[index + 1]) port = positiveInt(argv[++index], 0, 65_535) || undefined;
    else if (argument.startsWith("--port=")) port = positiveInt(argument.slice(7), 0, 65_535) || undefined;
  }
  return { host, port };
}

export function loadConfig(argv = process.argv.slice(2)): ServerConfig {
  const args = parseArgs(argv);
  return {
    host: args.host ?? process.env.TIKZ_SERVER_HOST ?? "127.0.0.1",
    port: args.port ?? positiveInt(process.env.TIKZ_SERVER_PORT ?? process.env.PORT, 5173, 65_535),
    latexBin: process.env.TIKZ_LATEX_BIN ?? "latex",
    kpsewhichBin: process.env.TIKZ_KPSEWHICH_BIN ?? (path.isAbsolute(process.env.TIKZ_LATEX_BIN ?? "") ? path.join(path.dirname(process.env.TIKZ_LATEX_BIN!), "kpsewhich") : "kpsewhich"),
    xelatexBin: process.env.TIKZ_XELATEX_BIN ?? "xelatex",
    dvisvgmBin: process.env.TIKZ_DVISVGM_BIN ?? "dvisvgm",
    dvipdfmxBin: process.env.TIKZ_DVIPDFMX_BIN ?? "dvipdfmx",
    sqliteBin: process.env.TIKZ_SQLITE_BIN ?? "sqlite3",
    databasePath: process.env.TIKZ_DATABASE_PATH ?? path.resolve(process.cwd(), "data/tikz-bench.sqlite"),
    timeoutMs: positiveInt(process.env.TIKZ_LATEX_TIMEOUT_MS, 20_000),
    maxSourceBytes: positiveInt(process.env.TIKZ_LATEX_MAX_SOURCE_BYTES, 1_048_576),
    maxConcurrency: positiveInt(process.env.TIKZ_LATEX_MAX_CONCURRENCY, 2),
    webRoot: process.env.TIKZ_WEB_ROOT ?? path.resolve(process.cwd(), "apps/web/dist")
  };
}
