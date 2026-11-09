// files/989 step 2e: the Cut parts Film's host tests open are CUT'S OWN WRITE of elements the EDITOR built, not a hand-made shape (filmcraft's
// `with_cut_parts` wrote a text element of four fields). Cut opens Film's file (`film-written.otio`, filmcraft's writer) and adds, with the
// editor's own builders: a text track ("Titles": the editor-built title of the maximal project, a gap, and a text "End"), a graphic track
// whose two shapes overlap (Cut's stacked lanes), a bookmark on Film's timeline and a scene of its own ("Teaser", a copy of the titles).
// The save is `cut-parts-film.otio` (`CUT_BLESS=1` writes it), which filmcraft's host tests open in Film
// (`cut_parts_in_a_film_file_open_as_film_types_and_save_back_value_for_value`, `film_edits_cut_s_parts_and_saves_them_in_cut_s_shape`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";
import { BUILT } from "./build-fixture.ts";

register("./alias-hooks.mjs", import.meta.url);
const { buildTextElement, buildGraphicElement } = await import("../../src/timeline/element-utils.ts");
const { registerDefaultGraphics, graphicsRegistry } = await import("../../src/graphics/index.ts");
const { mediaTime } = await import("../../src/wasm/media-time.ts");
const { CutSession } = await import("../../src/oneos/cut-session.ts");
registerDefaultGraphics();
type J = Record<string, any>;

const FIX = join(import.meta.dirname, "..", "fixtures");
const film = new Uint8Array(readFileSync(join(FIX, "film-written.otio")));
const s = (sec: number) => mediaTime({ ticks: Math.round(sec * 120_000) });
const steady = (v: J, id: string): J => ({ ...JSON.parse(JSON.stringify(v)), id });

function load(session: ReturnType<typeof CutSession.open>): J {
	const p = JSON.parse(JSON.stringify(session.project));
	session.baseline(p, session.media);
	return p;
}

test("Cut's parts the editor builds, written into Film's file by Cut, reopen in Cut as they were made (cut-parts-film.otio)", () => {
	const session = CutSession.open("Trip.otio", film);
	const p = load(session);
	const edit = p.scenes.find((sc: J) => sc.name === "Edit");
	const builtTitle = (BUILT.project.scenes[0].tracks.overlay[0].elements as J[]).find((e) => e.id === "t1") as J;
	const title = steady({ ...builtTitle, startTime: 0 }, "cut-title");
	const end = steady(buildTextElement({ raw: { name: "End", content: "The end", duration: s(1) }, startTime: s(3) }), "cut-end");
	const [shapeA, shapeB] = graphicsRegistry.getAll().slice(0, 2).map((d) => d.id);
	const a = steady(buildGraphicElement({ definitionId: shapeA, startTime: s(0) }), "cut-shape-a");
	const b = steady(buildGraphicElement({ definitionId: shapeB, startTime: s(0.5) }), "cut-shape-b");
	assert.ok(b.startTime < a.startTime + a.duration, "the shapes overlap (Cut's stacked lanes)");
	const titles = { id: "cut-titles", name: "Titles", type: "text", hidden: false, elements: [title, end] };
	edit.tracks.overlay.push(titles, { id: "cut-shapes", name: "Shapes", type: "graphic", hidden: false, elements: [a, b] });
	edit.bookmarks = [...(edit.bookmarks ?? []), { time: s(1), note: "hook" }];
	p.scenes.push({ id: "cut-teaser", name: "Teaser", isMain: false, createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z", bookmarks: [],
		tracks: { main: { id: "cut-teaser-main", name: "Main", type: "video", muted: false, hidden: false, elements: [] }, overlay: [steady(titles, "cut-teaser-titles")], audio: [] } });
	const bytes = session.save(p, session.media);
	const again = CutSession.open("Trip.otio", bytes);
	const q = load(again);
	const qe = q.scenes.find((sc: J) => sc.name === "Edit");
	const t = qe.tracks.overlay.find((x: J) => x.name === "Titles");
	assert.deepEqual(t.elements.map((e: J) => e.name), ["Title", "End"]);
	assert.deepEqual(t.elements[0].animations, title.animations, "the editor's keyed typography comes back");
	assert.equal(qe.tracks.overlay.find((x: J) => x.name === "Shapes").elements.length, 2);
	assert.ok(qe.bookmarks.some((m: J) => m.note === "hook"));
	assert.ok(q.scenes.some((sc: J) => sc.name === "Teaser"));
	assert.deepEqual(again.save(q, again.media), bytes, "Cut's reopened save is the very bytes");
	const out = JSON.parse(new TextDecoder().decode(bytes));
	const shapes = out.children[0].tracks.children.find((x: J) => x.name === "Shapes");
	assert.equal(shapes.OTIO_SCHEMA, "Stack.1", "the overlapping shapes are Cut's stacked lanes");
	const golden = join(FIX, "cut-parts-film.otio");
	if (process.env.CUT_BLESS) writeFileSync(golden, bytes);
	assert.deepEqual(new Uint8Array(readFileSync(golden)), bytes, "the golden file (CUT_BLESS=1 writes it)");
});
