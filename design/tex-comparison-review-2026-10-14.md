# Fast canvas / real TeX comparison

This change adds only the requested comparison tool. Open **TeX 对照** beside the package button in the source toolbar. It captures the active picture and current draft, then compiles a temporary instrumented copy with the existing local TeX service. Source, history, saved projects, exports and database structure are unchanged.

## Alignment and measurements

- Three zero-size world-coordinate markers in a `reset cm` scope establish the TeX SVG's origin and two 1pt basis vectors. Their inverse transform aligns TeX with the fast SVG, accounting for TeX pt versus SVG units, root transforms and the SVG y direction. Each image retains physical scale; fitting both images independently to their bounding boxes would conceal real size differences and is deliberately avoided.
- Ordinary node/matrix and path groups are associated with original source IDs. Temporary aliases preserve user names and existing aliases. Text groups wrap ordinary node parts; matrix row contents remain intact. Direct option-span insertion avoids reparsing once per node. A shared temporary marker macro keeps the tested 1000-node JSON request below the server's 1MiB limit.
- The browser reads `getBBox` and `getScreenCTM` from connected, hidden SVGs, including path-based fonts and `<use>` references. Layers receive separate ID namespaces, preserving local font/clip/gradient references and root paint/font styles. The comparison SVG is sanitized through the existing SVG sanitizer.
- Per-object rows show geometric width/height differences, center displacement, text drawing extents, available baseline and anchor displacement, in TeX pt. Ordinary anonymous text gets the same baseline from semantic layout as named nodes. Regression coverage verifies its world position under rotation and nonuniform parent scale.
- Bounds include arrow paths but exclude stroke expansion. Text extents are drawn glyph bounds, not a TeX layout-box or declared font-size equivalence check. Unsupported object/part mappings show “—”; “已测项容差内” applies only to measured fields. This is not a pixel diff or a proof of rendering equivalence.

The public PGF documentation confirms that multiple [node aliases](https://tikz.dev/tikz-shapes) coexist, and documents the [coordinate transformation/reset behavior](https://tikz.dev/tikz-transformations). Local `pgf-src` / `pgf-docs` references were not available in this checkout.

## Interaction and performance boundaries

Overlay / fast / TeX modes share a camera. Opacity, optional two-color highlighting, pan/zoom, tolerance, search and a differences-only filter support visual inspection. Selecting a row highlights mapped bounds and anchor vectors; locating an object selects it on the original canvas only if document, figure and source still match the capture.

The launcher waits for a snapshot matching both source and active figure. A figure-switch regression caught a stale-snapshot race and now guards it. Document changes close the dialog. Source changes retain the original comparison and disable locating old objects. Compilation failure keeps the last successful comparison; retry uses the same immutable snapshot. Closing ignores late responses.

The dialog is lazy-loaded. TeX compilation and comparison measurement occur only on opening/retry; no new compilation, parsing, saving or history writes are attached to main-canvas gestures. Scene, anchor, DOM-ID and source-group indexes are built once per measurement, and the table renders at most 200 rows at a time. Large-picture compile time still depends on TeX and the server's existing limits; this change does not claim a 1000-object real-TeX latency benchmark.

## Validation

- `npm run typecheck`: passed.
- `npm run lint:prod`: passed; new unit/browser tests also pass focused ESLint.
- `npm test -- --maxWorkers=4`: 2994 passed, 2 skipped, including capability guards. The default high-concurrency run hit an existing store test's 5s timeout and its subsequent mock-listener failure; a bounded-concurrency full rerun passed. No store behavior was changed.
- Focused comparison/package browser suite: 10 passed in Edge/Chromium against the production frontend/server and CSP. Compile responses are controlled SVG fixtures; these validate browser calibration, measurements, SVG references, retry, stale drafts, current figure, offline package resources and narrow/dark layout. They do not validate actual TeX output.
- `npm run build`: passed. The browser suite's production frontend and server builds passed, with existing bundle-size/dynamic-import warnings.
- `npm run test:corpus`: skipped because the optional corpus is absent; not counted as corpus verification.
- The 1000-node temporary-copy test passes the JSON request-size limit and verifies marker-macro collision avoidance. Rotated/skewed calibration, physical units, matrix contents, multipart text, existing aliases and anonymous baselines have focused regressions.

## Pending target-environment checks

This Windows development machine has no `latex`, `xelatex`, `dvisvgm` or `dvipdfmx`; the real verification script reports those missing tools. Real TeX Live 2026 DVI/XDV marker ordering, Chinese/formula glyphs, baselines, matrix output, advanced mappings and systemd behavior remain unverified here.

On the existing Ubuntu installation, with its TeX tools on PATH, run:

```bash
node --import tsx scripts/verify-tex-comparison.mts
```

The script compiles formulas/arrows, Chinese multipart nodes, transformed matrices, global node styles and a full multi-picture document; it validates finite world markers and object/text-group delivery. Then open **TeX 对照** in the browser to check physical alignment, glyphs and baselines. Missing calibration is an explicit error; the tool never guesses alignment from two bounding boxes.

Reinstall from source with the current configuration/database after pushing the commit:

```bash
cd ~/tikz-bench &&
git pull --ff-only &&
nvm use 22 &&
bash install.sh &&
tikz-bench start &&
tikz-bench version &&
tikz-bench status
```

No uninstall, database replacement or TeX installation is required.
