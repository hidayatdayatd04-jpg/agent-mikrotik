import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const pkg = await Bun.file(resolve(root, "package.json")).json();
const result = await Bun.build({
  entrypoints: [resolve(root, "apps/api/src/index.ts")],
  target: "bun",
  outdir: resolve(root, "dist"),
  naming: "api.js",
  external: Object.keys(pkg.dependencies),
  sourcemap: "none",
});
if (!result.success) throw new AggregateError(result.logs, "API build failed");
await mkdir(resolve(root, "dist/web"), { recursive: true });
await cp(resolve(root, "apps/web/dist"), resolve(root, "dist/web"), { recursive: true });
console.log("Built dist/api.js and dist/web");
