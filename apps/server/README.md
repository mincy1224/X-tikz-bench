# X-TikZ Bench server

## Install as a system service

Run `bash install.sh` from the repository root on Linux or WSL2 with systemd enabled. The installer builds and installs `x-tikz-bench.service` using the existing TeX Live installation. Open [X-TikZ Bench](http://localhost:5175/).

```bash
x-tikz-bench status
x-tikz-bench version
x-tikz-bench start
x-tikz-bench stop
x-tikz-bench restart
x-tikz-bench logs
x-tikz-bench backup
```

Configuration is stored in `/etc/default/x-tikz-bench`. The default database is `/var/lib/x-tikz-bench/x-tikz-bench.sqlite`. Restart the service after editing the configuration. Upgrades preserve existing projects and settings. Keep `apps/server/package.json` in the deployed files so Node can load the server as ES modules.

## Run from source

Use Linux Node.js 22.13+, npm 10.5+, SQLite, and TeX Live. From the repository root:

```bash
npm ci
npm run build:full
npm run server -- --port 5173
```

The server defaults to `127.0.0.1:5173`. Set the port with `--port`, `TIKZ_SERVER_PORT`, or `PORT`, in that order. Press Ctrl+C to stop a foreground server. For development, `npm run dev:full` serves the web app at `http://127.0.0.1:5173` and proxies API requests to port 5174.

Bind to `127.0.0.1` for local use, including access from Windows via WSL2 localhost forwarding. For remote access, provide authentication, HTTPS, and rate limits in front of the single-user server.

## LaTeX configuration

```bash
xelatex --version
dvipdfmx --version
curl -fsS http://127.0.0.1:5175/api/latex/status
```

```text
TIKZ_LATEX_BIN=latex
TIKZ_XELATEX_BIN=xelatex
TIKZ_DVISVGM_BIN=dvisvgm
TIKZ_DVIPDFMX_BIN=dvipdfmx
TIKZ_LATEX_TIMEOUT_MS=20000
TIKZ_LATEX_MAX_SOURCE_BYTES=1048576
TIKZ_LATEX_MAX_CONCURRENCY=2
```

TeX Proof displays the current canvas as a XeLaTeX PDF. The separate SVG compilation path uses dvisvgm with embedded bitmaps. Each compilation runs in a temporary directory with the referenced assets, restricted TeX file access, and shell escape disabled.
