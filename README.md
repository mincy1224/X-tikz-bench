# X-TikZ Bench

X-TikZ Bench is a self-hosted web editor for TikZ figures. Each project can contain multiple named canvases. Each canvas has its own editable TikZ source, and the project shares an asset library and a palette across canvases.

## Editing and export

- Open a project to draw on the canvas or edit its TikZ source. Press `P` to draw a polyline, Enter or double-click to finish, and Esc to cancel. Drag the scrollbars to pan when the drawing exceeds the viewport.
- Open **Assets** to import PNG, PDF, or SVG and drag an asset onto the canvas. Each asset can be up to 10 MiB. SVG files are converted to PDF with `rsvg-convert` on Linux or Inkscape on Windows. Set `TIKZ_INKSCAPE_BIN` to specify the Inkscape executable. PDF previews require Poppler.
- Add and edit shared colors in **Palette**. Click a color name to copy its TikZ alias.
- Open **TeX Proof** to compile the current canvas with XeLaTeX and view its PDF. The default serif font is Times New Roman when available, with TeX Gyre Termes as a fallback. A font explicitly set by the project takes precedence.
- Choose **Export LaTeX Project** to download a ZIP containing `main.tex`, `figure.tikz`, and `assets/`. The entry point contains the shared color definitions and loads the current canvas. Unzip the archive and run `xelatex main.tex` to compile it.

## Install or update on Linux and WSL2

Install in the Linux filesystem on Ubuntu, Debian, or a WSL2 distribution with systemd enabled. The source installer requires Linux Node.js 22.13+, npm 10.5+, SQLite, and an existing TeX Live 2026 installation with `latex`, `xelatex`, `dvisvgm`, `dvipdfmx`, and `kpsewhich`.

From the repository root, install the tools for PDF previews and SVG conversion and run the installer:

```bash
sudo apt-get update
sudo apt-get install -y poppler-utils librsvg2-bin
bash install.sh
```

If TeX Live is outside the shell's PATH, supply the path to its executables:

```bash
TIKZ_TEX_BIN_DIR=/usr/local/texlive/2026/bin/x86_64-linux bash install.sh
```

Open [X-TikZ Bench](http://localhost:5175/). The installer builds the current checkout and configures the `x-tikz-bench.service` systemd service. The command, service, and database are separate from any existing `tikz-bench` installation.

To update an existing checkout after pushing the changes to your remote:

```bash
git pull --ff-only &&
bash install.sh &&
x-tikz-bench version &&
x-tikz-bench status
```

Updates preserve project data and configuration. Use `x-tikz-bench logs` for service logs and `x-tikz-bench restart` to restart the service. See the [server documentation](apps/server/README.md) for configuration and data paths.

## Run on Windows

From the repository root in PowerShell:

```powershell
npm ci
npm run build:full
.\start-windows.cmd
```

Open [X-TikZ Bench](http://127.0.0.1:5176/) and press Ctrl+C in the terminal to stop it. To create a portable build, run `npm run package:windows`, unzip `release/x-tikz-bench-windows.zip`, and run `start-windows.cmd` from that folder. Project data is stored in `data/x-tikz-bench.sqlite` under the launch directory.

The Windows build uses the installed Node.js, SQLite, and TeX Live executables. Add the SQLite and TeX Live directories to the current terminal's PATH or configure the full SQLite path with `TIKZ_SQLITE_BIN`. Install Poppler for PDF asset previews.

## Build and verify

```bash
npm ci
npm run typecheck
npm run lint:prod
npm test
npm run build:full
npm run test:e2e
```

Run `npm run dev:full` for development or `node apps/server/dist/index.js --port 4173` to serve a built checkout. Set `TIKZ_DATABASE_PATH` to change the project database location. Real font and PDF checks require TeX Live in the target environment.

## Credits and license

X-TikZ Bench builds on [TikZ Editor](https://github.com/DominikPeters/tikz-editor). See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for licensing and attribution.
