import { build } from "esbuild";

await build({
  entryPoints: {
    index: "src/index.ts",
    "verify-runtime": "../../scripts/verify-runtime.mjs",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  sourcemap: true,
});
