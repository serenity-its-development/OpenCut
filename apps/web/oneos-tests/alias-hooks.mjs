// The editor's own modules, loaded in node for the tests (OneOS): `@/x` is `src/x` (tsconfig paths), and an import without an extension
// is the `.ts` file or the folder's `index.ts`, as the bundler resolves them. Nothing else is changed.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const pick = (base) => {
	for (const p of [base, `${base}.ts`, join(base, "index.ts")]) if (existsSync(p) && statSync(p).isFile()) return p;
	return null;
};

export async function resolve(spec, ctx, next) {
	let base = null;
	if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
	else if ((spec.startsWith("./") || spec.startsWith("../")) && ctx.parentURL?.startsWith(pathToFileURL(SRC).href) && !/\.[a-z]+$/.test(spec)) base = join(dirname(fileURLToPath(ctx.parentURL)), spec);
	if (base) {
		const hit = pick(base);
		if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true, ...(hit.endsWith(".ts") ? { format: "module-typescript" } : {}) };
	}
	return next(spec, ctx);
}
