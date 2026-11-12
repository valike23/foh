import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
for (const name of ["server", "index"]) await build({ entryPoints: [`src/${name}.ts`], outfile: `dist/${name}.cjs`, platform: "node", target: "node22", bundle: true, format: "cjs", sourcemap: true });
