// Cut's masks as Film's mask paths, drawn by the EDITOR'S OWN code (OneOS doctrine files/989, "Masks, both ways"). Cut's masks are
// parametric and sized to the element; Film's are closed cubic Bezier paths in clip pixels (filmcraft `project/src/mask.rs` MaskPath). Each
// mask's path is built here by its definition's own `buildPath` (the editor's mask registry) at the element's own pixel size, recorded
// through a Path2D that records what is drawn, and written as Film's vertices (`fixtures/mask-paths.json`): filmcraft's
// `cut::tests::cut_s_masks_are_the_paths_the_editor_draws` builds the same paths from Cut's params and compares them, vertex for vertex.
// An ellipse is written as Film draws one (four smooth vertices with circular tangents, filmcraft `MaskPath::ellipse`; within 0.03% of
// the true ellipse). A split is the half-plane on the side its normal points, cut to a box the element's width plus height beyond every
// edge (Film grows and shrinks it with no edge of the element's in the way, as Cut moves its line). A text mask has no path (Film's text
// mask draws its text). Run: node --import ./apps/web/oneos-tests/editor/alias-hooks.mjs --test apps/web/oneos-tests/editor/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUILT } from "./build-fixture.ts";

type J = Record<string, any>;
type V = [number, number];
interface Vertex { p: V; t_in: V; t_out: V }

/** A Path2D that records what is drawn (node has none); an op it does not know fails the test, never drops a part of the path. */
class RecordingPath2D {
	ops: Array<[string, number[]]> = [];
	moveTo(...a: number[]) { this.ops.push(["moveTo", a]); }
	lineTo(...a: number[]) { this.ops.push(["lineTo", a]); }
	bezierCurveTo(...a: number[]) { this.ops.push(["bezierCurveTo", a]); }
	closePath() { this.ops.push(["closePath", []]); }
	ellipse(...a: number[]) { this.ops.push(["ellipse", a]); }
}
for (const op of ["arc", "arcTo", "quadraticCurveTo", "rect", "roundRect", "addPath"]) {
	(RecordingPath2D.prototype as J)[op] = () => { throw new Error(`the recording Path2D has no ${op}: write it as Film's vertices first`); };
}
(globalThis as J).Path2D = RecordingPath2D;

const { masksRegistry } = await import("../../src/masks/index.ts");

const KAPPA = 0.5522847498307934;
const r9 = (x: number) => { const y = Math.round(x * 1e9) / 1e9; return Object.is(y, -0) ? 0 : y; };
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const rot = (v: V, a: number): V => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];

/** The recorded ops as Film's vertices of ONE closed path. */
function vertices(ops: Array<[string, number[]]>): Vertex[] {
	const out: Vertex[] = [];
	let closed = false;
	for (const [op, a] of ops) {
		assert.ok(!closed, "one path: nothing is drawn after it closes");
		if (op === "moveTo") {
			assert.equal(out.length, 0, "one path");
			out.push({ p: [a[0], a[1]], t_in: [0, 0], t_out: [0, 0] });
		} else if (op === "lineTo") {
			out.push({ p: [a[0], a[1]], t_in: [0, 0], t_out: [0, 0] });
		} else if (op === "bezierCurveTo") {
			const prev = out[out.length - 1];
			prev.t_out = sub([a[0], a[1]], prev.p);
			out.push({ p: [a[4], a[5]], t_in: sub([a[2], a[3]], [a[4], a[5]]), t_out: [0, 0] });
		} else if (op === "closePath") {
			const [first, last] = [out[0], out[out.length - 1]];
			// A path that curves back to its first point before closing: that point's incoming tangent is the last curve's.
			if (out.length > 1 && Math.abs(first.p[0] - last.p[0]) < 1e-9 && Math.abs(first.p[1] - last.p[1]) < 1e-9) {
				first.t_in = last.t_in;
				out.pop();
			}
			closed = true;
		} else if (op === "ellipse") {
			const [cx, cy, rx, ry, angle, start, end] = a;
			assert.ok(out.length === 0 && start === 0 && Math.abs(end - 2 * Math.PI) < 1e-12, "a whole ellipse");
			const local: Array<[V, V]> = [[[0, -ry], [rx * KAPPA, 0]], [[rx, 0], [0, ry * KAPPA]], [[0, ry], [-rx * KAPPA, 0]], [[-rx, 0], [0, -ry * KAPPA]]];
			for (const [p, t] of local) {
				const q = rot(p, angle), u = rot(t, angle);
				out.push({ p: [cx + q[0], cy + q[1]], t_in: [-u[0], -u[1]], t_out: u });
			}
			closed = true;
		}
	}
	assert.ok(closed, "the path is closed");
	return out.map((v) => ({ p: [r9(v.p[0]), r9(v.p[1])], t_in: [r9(v.t_in[0]), r9(v.t_in[1])], t_out: [r9(v.t_out[0]), r9(v.t_out[1])] }));
}

/** A mask's path in the element's own pixels (width x height), by its definition's own `buildPath`. */
function pathOf(type: string, params: J, width: number, height: number): Vertex[] {
	const d = masksRegistry.get(type as never);
	assert.ok(d.renderer.buildPath, `${type} has a path`);
	if (type !== "split") return vertices((d.renderer.buildPath({ resolvedParams: params, width, height }) as unknown as RecordingPath2D).ops);
	// The split's half-plane in a box `m` beyond every edge: its line is where it is in the element.
	const m = width + height;
	const [bw, bh] = [width + 2 * m, height + 2 * m];
	const big = { ...params, centerX: (params.centerX * width) / bw, centerY: (params.centerY * height) / bh };
	return vertices((d.renderer.buildPath({ resolvedParams: big, width: bw, height: bh }) as unknown as RecordingPath2D).ops).map((v) => ({ ...v, p: [r9(v.p[0] - m), r9(v.p[1] - m)] }));
}

const beach: J = (BUILT as J).project.scenes[0].tracks.main.elements[0];
const moved = { centerX: 0.1, centerY: -0.15, width: 0.4, height: 0.3, rotation: 30 };
const cases: J[] = [];
for (const [width, height] of [[1920, 1080], [512, 512]]) {
	for (const m of beach.masks as J[]) {
		if (m.type === "text") continue;
		const variants: J[] = [m.params];
		if (m.type === "split") variants.push({ ...m.params, centerX: 0.2, centerY: -0.1, rotation: 30 });
		else if (m.type === "custom") {
			const path = [
				{ id: "a", x: -0.3, y: -0.2, inX: 0, inY: 0, outX: 0.1, outY: -0.05 },
				{ id: "b", x: 0.25, y: -0.25, inX: -0.05, inY: -0.02, outX: 0, outY: 0 },
				{ id: "c", x: 0.3, y: 0.2, inX: 0, inY: 0, outX: -0.1, outY: 0.1 },
				{ id: "d", x: -0.2, y: 0.3, inX: 0.05, inY: 0.05, outX: -0.05, outY: -0.1 },
			];
			variants[0] = { ...m.params, path, closed: true };
			variants.push({ ...m.params, path, closed: true, centerX: 0.05, centerY: 0.1, rotation: 20, scale: 1.5 });
		} else variants.push({ ...m.params, ...moved });
		for (const params of variants) cases.push({ type: m.type, params, width, height, vertices: pathOf(m.type, params, width, height) });
	}
}

const FILE = join(import.meta.dirname, "..", "fixtures", "mask-paths.json");
const text = `${JSON.stringify({ cases }, null, "\t")}\n`;

test("every mask with a path is Film's closed path, as the editor's own buildPath draws it (fixtures/mask-paths.json)", () => {
	assert.deepEqual([...new Set(cases.map((c) => c.type))], ["split", "cinematic-bars", "rectangle", "ellipse", "heart", "diamond", "star", "custom"]);
	assert.equal(cases.length, 32);
	if (process.env.CUT_BLESS) writeFileSync(FILE, text);
	assert.ok(readFileSync(FILE, "utf8") === text, "mask-paths.json is the editor's paths (CUT_BLESS=1 writes it)");
});

test("an ellipse is four smooth vertices with circular tangents and a rectangle four corners, at the element's own pixels", () => {
	const at = (type: string, i: number) => cases.filter((c) => c.type === type)[i];
	const e = at("ellipse", 0);
	assert.deepEqual(e.vertices[0], { p: [960, 216], t_in: [r9(-0.3375 * 960 * KAPPA), 0], t_out: [r9(0.3375 * 960 * KAPPA), 0] });
	const r = at("rectangle", 0);
	assert.deepEqual(r.vertices.map((v: Vertex) => v.p), [[636, 216], [1284, 216], [1284, 864], [636, 864]]);
	assert.ok(r.vertices.every((v: Vertex) => v.t_in[0] === 0 && v.t_out[1] === 0));
});
