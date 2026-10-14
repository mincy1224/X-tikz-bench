# TikZ Bench

[中文说明](README.zh-CN.md)

A local, self-hosted visual workspace for TikZ. Edit supported diagrams on a canvas or in the source editor, with TikZ source as the saved document.

TikZ Bench is an independently maintained derivative of [TikZ Editor](https://github.com/DominikPeters/tikz-editor) by **Dominik Peters**. It retains the original parsing and rendering foundations, with additional local project management, formatting controls and system installation support.

## Features

- Shapes, paths, curves, text, groups and anchor connections; edge, center and equal-spacing guides while dragging.
- Multipart rectangles with horizontal or vertical sections, individual content and fills.
- Matrices: click to move the whole matrix, double-click to edit a cell; layout resizing and separate content scaling.
- World-space movement for nested transformed groups and anchored matrices; arrow keys move 1pt (Shift: 10pt), independently of the grid.
- A shape/text format panel, exact font sizes, colors, line widths, independently sized arrowheads and multi-selection editing.
- A persistent format painter for matching component types; each gesture is one undo step.
- Local projects with automatic saving; TeX, SVG, PNG and PDF export.
- Same-origin MathJax formulas and local LaTeX / Chinese XeLaTeX compilation.
- New Computer Modern and STIX2 math fonts are bundled for offline use.
- A read-only fast-canvas / real-TeX overlay, with shared coordinates, opacity controls and per-object geometry, text, baseline and anchor differences.
- `\llbracket` and `\rrbracket`, including scalable `\left…\right` forms. The source panel's **Packages** dialog edits document package declarations and checks whether packages are installed in the existing TeX Live.
- Example matrices, flowcharts, plots and circuits. Advanced Forest, PGFPlots and Circuitikz code uses local TeX compilation; direct canvas editing depends on supported syntax.

## Install from source

**Target:** Ubuntu 24.04 with systemd, including WSL2 with systemd enabled. You need sudo access, network access for npm/apt, and an existing complete TeX Live installation. TeX Live 2026 is the intended target; the installer does not install or replace TeX.

After cloning **this repository**, run from its root:

```bash
bash install.sh
```

No separate build or packaging step is needed. The script installs missing non-TeX tools through apt, runs `npm ci`, builds the frontend and server, checks compilation under service isolation, and installs the `tikz-bench` command and systemd service. Node.js 22.13+ and npm 10.5+ are required for building; an existing older Node.js must be updated first.

TeX must provide `latex`, `xelatex`, `dvisvgm`, `dvipdfmx` and `kpsewhich`, with TikZ, standalone, Forest, PGFPlots, Circuitikz, ctex, fontspec and Fandol fonts. Missing Chinese system fonts are installed through apt. To specify the existing TeX directory:

```bash
TIKZ_TEX_BIN_DIR=/usr/local/texlive/2026/bin/x86_64-linux bash install.sh
```

A fresh installation starts automatically. Open **http://localhost:5173**. Existing installations retain configuration, project data and their previous service state. **Do not delete the old installation first.** Failed installation checks restore the previous program and configuration. Real Ubuntu/systemd/TeX Live 2026 acceptance is still pending.

## Use and upgrade

Create a project with a required unique name and optional description, then enter TikZ code or add shapes from the toolbar. Select objects to edit the shape/text format panel. Actual dimensions and center coordinates are separate from minimum-size and text-width constraints. Press Esc to cancel a drag; matrix cell editing returns to the whole matrix on Esc, then clears selection on another Esc. Projects save after committed edits. Supported Forest, PGFPlots and Circuitikz environments compile automatically on the main canvas; mapped objects expose source properties and supported data points can be dragged. Custom macro internals and groupplot mappings are not reverse editable. Real TeX mapping acceptance is pending; this is not a claim of arbitrary LaTeX editability.

To use math packages, add declarations before the picture, for example `\usepackage{mathtools,stmaryrd}`. Open **Packages** above the source editor to add or remove packages, edit options, and check availability. The dialog edits the same TikZ source and one Apply is one undo step. Double brackets work in the fast canvas without a declaration; TeX preview and export add `stmaryrd` only when needed and only if you have not defined the commands yourself. Common `amsmath`, `amsfonts`, `amssymb`, `mathtools`, `cancel`, and `braket` commands use bundled MathJax. Unsupported text commands from known math packages use local TeX for their text region; packages or definitions that may change drawing semantics use whole-figure TeX. A failed text compile keeps the last successful drawing and exposes **Retry formula**. No package files are uploaded or installed by the app.

```bash
tikz-bench start
tikz-bench status
tikz-bench stop
tikz-bench restart
tikz-bench logs
tikz-bench version
tikz-bench backup ./projects-backup.sqlite
tikz-bench upgrade /path/to/tikz-bench-source
tikz-bench rollback
```

To upgrade, run `git pull --ff-only` in your source checkout, then `bash install.sh` again. Alternatively, `tikz-bench upgrade /path/to/tikz-bench-source` builds and installs that checkout. `rollback` switches programs without replacing the database; backup restores the original running/stopped state.

This movement refactor keeps your current database and service configuration. After pushing the update to your repository, reinstall from source:

```bash
cd ~/tikz-bench &&
git pull --ff-only &&
nvm use 22 &&
bash install.sh &&
tikz-bench start &&
tikz-bench version &&
tikz-bench status
```

There is no database/schema change and no need to uninstall first. Check `curl -fsS http://127.0.0.1:5173/api/health` and `tikz-bench logs`. With your TeX tools on PATH, run `node --import tsx scripts/verify-editable-tex.mts` from the source checkout to validate the actual Forest/plot/circuit mappings and PDF export.

Run `node --import tsx scripts/verify-tex-text.mts` in the source checkout on the target Ubuntu system to verify actual double-bracket glyphs, local text dimensions, cache reuse, and a Chinese XeLaTeX PDF. Browser and unit checks do not replace that TeX Live 2026 check.

Programs: `/opt/tikz-bench/releases/`. Configuration: `/etc/default/tikz-bench`. Default database: `/var/lib/tikz-bench/tikz-bench.sqlite`. The service listens on `127.0.0.1:5173` by default.

Open **TeX 对照** above the source editor to compare the active picture's current draft with local TeX. Switch between overlay, fast canvas and TeX, adjust opacity, pan/zoom, and select a difference row to highlight or locate its object. Alignment uses three TeX world-coordinate markers, preserving physical scale rather than fitting the two bounding boxes. Measurements use pt and a configurable tolerance; missing mappings show “—”. The view never writes comparison markers to your source. If the draft changes while it is open, it keeps the captured snapshot and disables locating old objects. Geometry bounds include arrow paths but exclude stroke expansion; this is not a pixel-perfect diff. On the target system, run `node --import tsx scripts/verify-tex-comparison.mts` to check real TeX marker delivery, then visually check alignment in the browser. Real TeX Live 2026 validation remains pending on this development machine.

## Development

With Node.js 22.13+ and npm 10.5+, run `npm ci` then `npm run dev:full` from the repository root. For a production build without installing a service, run `npm run build` followed by `npm run build:full`. System installation requires Linux; development builds can also run on Windows.

See [server configuration](apps/server/README.md) and [source installation details](design/build-and-upgrade.md).

The [movement refactor review](design/movement-refactor-review-2026-10-09.md) records regression coverage and performance measurements. The tested 1000-object scene meets the selection and drag-frame targets; releasing a drag still takes about 0.8–1.1 seconds to finish rendering on the test machine.

## License

MIT; the original copyright and license notice are preserved in [LICENSE](LICENSE). See [NOTICE.md](NOTICE.md) for attribution and modification details. TikZ Bench is maintained independently; these modifications do not imply endorsement by the original author. Bundled third-party components retain their own licenses.
