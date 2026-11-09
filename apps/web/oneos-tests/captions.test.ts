// files/989 (Mona 2026-11-10, relayed: "Caption track in the .otio"): captions round-trip both ways. `fixtures/film-captions.otio` is byte for
// byte filmcraft's `crates/interchange/tests/it/oneos/film-captions.otio` (its test `oneos_film_writes_its_captions_for_cut` pins Film's writer
// to it): "Edit" holds a picture and the caption track "English" (three captions, Film's style changed: 48 px, yellow, no box, at the top).
// Cut opens it as its caption track, edits it and writes it back in Film's shape; `CUT_BLESS=1` writes `cut-captions.otio`, which filmcraft's
// host test opens in Film (`cut_s_caption_edits_open_in_film_as_its_own_captions`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CutSession, CutSaveRefusal } from "../src/oneos/cut-session.ts";
import { TICKS, cutToOtio, otioToCut } from "../src/oneos/cut-otio.ts";
import { CAPTION_KIND, buildCaptionElement, captionLook, newCaptionTrackData } from "../src/oneos/captions.ts";

const FIX = join(import.meta.dirname, "fixtures");
const film = new Uint8Array(readFileSync(join(FIX, "film-captions.otio")));
type J = Record<string, any>;

function load(s: CutSession): J {
	const p = JSON.parse(JSON.stringify(s.project));
	s.baseline(p, s.media);
	return p;
}
const edit = (p: J): J => p.scenes.find((sc: J) => sc.name === "Edit");
const captionTracks = (sc: J): J[] => sc.tracks.overlay.filter((t: J) => t.type === "caption");
const timeline = (doc: J, name: string): J => doc.children.find((t: J) => t.name === name);
const read = (b: Uint8Array): J => JSON.parse(new TextDecoder().decode(b));

test("Film's caption track opens in Cut as its caption track: each caption a text at its time, in the track's one style; unedited, the very bytes", () => {
	const s = CutSession.open("Captions.otio", film);
	assert.deepEqual(s.locked, [], "nothing locked");
	const p = load(s);
	const [ct] = captionTracks(edit(p));
	assert.equal(ct.name, "English");
	assert.equal(ct.caption.language, "en-AU");
	assert.equal(ct.caption.style.size, 48);
	assert.deepEqual(ct.elements.map((e: J) => [e.content, e.startTime, e.duration]), [
		["Hello there.", 0, TICKS],
		["Two lines,\n<i>the second in italics</i>.", TICKS, TICKS],
		["After a pause.", 3 * TICKS, TICKS],
	]);
	assert.deepEqual(ct.elements[0].caption, { speaker: "Ana", cue_id: "intro", settings: "line:90% align:start" });
	const e = ct.elements[0];
	assert.equal(e.fontSize, 4, "48 px of a 1080-line frame is Cut's 4 (a text's pixels are fontSize x height / 90)");
	assert.equal(e.color, "#ffe600");
	assert.equal(e.background.enabled, false);
	assert.ok(e.transform.position.y < 0, "anchored at the top");
	assert.deepEqual(s.save(p, s.media), film, "unedited: the very bytes");
});

test("Cut's caption edits are written in Film's shape: a text, a move, a new caption, the style, and a new caption track (as Cut's SRT import makes one)", () => {
	const s = CutSession.open("Captions.otio", film);
	const p = load(s);
	const sc = edit(p);
	const [ct] = captionTracks(sc);
	const canvas = { width: 1920, height: 1080 };
	ct.elements[1].content = "Two lines,\nedited in Cut.";
	ct.elements[2].startTime += TICKS;
	ct.elements.push({ id: "cut-new", ...buildCaptionElement({ caption: { text: "Added in Cut.", startTime: 6, duration: 1.5 }, style: ct.caption.style, canvasSize: canvas }) });
	// The style: every caption made green (as selecting them all and changing the colour does).
	for (const e of ct.elements) {
		Object.assign(e, captionLook({ ...ct.caption.style, color: [0, 255, 0, 255] }, e.content, canvas));
	}
	const data = newCaptionTrackData();
	sc.tracks.overlay.push({
		id: "cut-captions", name: "Français", type: "caption", hidden: false, caption: { ...data, language: "fr" },
		elements: [
			{ id: "fr-1", ...buildCaptionElement({ caption: { text: "Bonjour.", startTime: 0.5, duration: 1 }, style: data.style, canvasSize: canvas }) },
			{ id: "fr-2", ...buildCaptionElement({ caption: { text: "Deux.", startTime: 2, duration: 1 }, style: data.style, canvasSize: canvas }) },
		],
	});
	const bytes = s.save(p, s.media);
	const doc = read(bytes);
	const tracks: J[] = timeline(doc, "Edit").tracks.children;
	const en = tracks.find((t) => t.name === "English") as J;
	assert.deepEqual(en.metadata.filmcraft.caption_track.style.color, [0, 255, 0, 255], "the style Cut changed is Film's own value");
	assert.equal(en.metadata.filmcraft.caption_track.style.size, 48, "the rest of Film's style as it was");
	const clips = en.children.filter((c: J) => c.OTIO_SCHEMA === "Clip.2");
	assert.deepEqual(clips.map((c: J) => c.metadata.filmcraft.caption.text), ["Hello there.", "Two lines,\nedited in Cut.", "After a pause.", "Added in Cut."]);
	assert.ok(clips.every((c: J) => c.media_references.DEFAULT_MEDIA.generator_kind === CAPTION_KIND && c.name === c.metadata.filmcraft.caption.text));
	assert.deepEqual(clips[0].metadata.filmcraft.caption, { text: "Hello there.", speaker: "Ana", cue_id: "intro", settings: "line:90% align:start" }, "Film's cue data kept");
	const fr = tracks[tracks.length - 1];
	assert.equal(fr.name, "Français");
	assert.equal(fr.metadata.filmcraft.caption_track.language, "fr");
	assert.equal(fr.children[0].OTIO_SCHEMA, "Gap.1", "the first caption placed by a gap");
	// Reopened in Cut: the same captions.
	const again = CutSession.open("Captions.otio", bytes);
	const q = load(again);
	const [en2, fr2] = captionTracks(edit(q));
	assert.deepEqual(en2.elements.map((e: J) => [e.content, e.startTime, e.color]), ct.elements.map((e: J) => [e.content, e.startTime, e.color]).sort((a: J, b: J) => a[1] - b[1]));
	assert.deepEqual(fr2.elements.map((e: J) => e.content), ["Bonjour.", "Deux."]);
	const golden = join(FIX, "cut-captions.otio");
	if (process.env.CUT_BLESS) writeFileSync(golden, bytes);
	assert.deepEqual(new Uint8Array(readFileSync(golden)), bytes, "the golden file (CUT_BLESS=1 writes it)");
});

test("a caption with a look of its own, or two captions at once, is refused by name, nothing written", () => {
	const s = CutSession.open("Captions.otio", film);
	const p = load(s);
	const [ct] = captionTracks(edit(p));
	ct.elements[0].fontFamily = "Georgia";
	ct.elements[1].transform = { ...ct.elements[1].transform, position: { x: 100, y: 0 } };
	assert.throws(() => s.save(p, s.media), (e: unknown) => e instanceof CutSaveRefusal && e.code === "caption-look-not-in-film" && /"Hello there\."/.test(e.message) && /fontFamily/.test(e.message));
	const q = load(CutSession.open("Captions.otio", film));
	const [cq] = captionTracks(edit(q));
	cq.elements[1].startTime = cq.elements[0].startTime + TICKS / 2;
	assert.throws(() => s.save(q, s.media), (e: unknown) => e instanceof CutSaveRefusal && e.code === "caption-overlap");
});

test("a Cut project's caption track is written in Film's shape and read back whole", () => {
	const canvas = { width: 1280, height: 720 };
	const data = newCaptionTrackData();
	const cap = (id: string, text: string, at: number, name?: string) => ({ id, ...buildCaptionElement({ caption: { text, startTime: at, duration: 1 }, style: data.style, canvasSize: canvas }), ...(name ? { name } : {}) });
	const project = {
		metadata: { id: "p", name: "Subs" }, settings: { canvasSize: canvas }, currentSceneId: "s1", version: 1,
		scenes: [{
			id: "s1", name: "Main", isMain: true, bookmarks: [],
			tracks: {
				main: { id: "m", name: "Main", type: "video", muted: false, hidden: false, elements: [] },
				overlay: [{ id: "c1", name: "Captions", type: "caption", hidden: false, caption: data, elements: [cap("a", "One.", 0, "Caption 1"), cap("b", "Two.", 2)] }],
				audio: [],
			},
		}],
	};
	const doc = cutToOtio({ project, media: [] });
	const t = doc.children[0].tracks.children[1];
	assert.equal(t.OTIO_SCHEMA, "Track.1");
	assert.equal(t.metadata.filmcraft.caption_track.format, "Subtitle");
	assert.deepEqual(t.children.filter((c: J) => c.OTIO_SCHEMA === "Clip.2").map((c: J) => [c.media_references.DEFAULT_MEDIA.generator_kind, c.metadata.filmcraft.caption.text]), [[CAPTION_KIND, "One."], [CAPTION_KIND, "Two."]]);
	const back = otioToCut(JSON.parse(JSON.stringify(doc)));
	assert.deepEqual(back.project.scenes[0].tracks.overlay[0], project.scenes[0].tracks.overlay[0], "the caption track read back whole (ids and a name that is not its text kept)");
});

// files/989 (owed under "Caption track in the .otio"): a caption track inside Cut's OWN project. `fixtures/cut-project-captions.otio` is
// Cut's writer's maximal project with a caption track among its overlay tracks (CUT_BLESS=1 writes it); filmcraft's host test
// `a_caption_track_in_a_pure_cut_project_opens_in_film_as_its_captions` opens it in Film as Film's captions, edits them and pins what Film
// saves as `film-saved-cut-captions.otio`, which the next test opens in Cut.
import { maximal } from "./cut-fixture.ts";

function maximalWithCaptions(): J {
	const cut = maximal() as J;
	const canvas = cut.project.settings.canvasSize;
	const data = { ...newCaptionTrackData(), language: "fr" };
	const cap = (id: string, text: string, at: number, duration: number, extra: J = {}) => ({ id, ...buildCaptionElement({ caption: { text, startTime: at, duration }, style: data.style, canvasSize: canvas }), ...extra });
	const track = {
		id: "cut-subs", name: "Sous-titres", type: "caption", hidden: false, caption: data,
		elements: [
			cap("cap-1", "Bonjour.", 0.5, 1.5, { name: "Greeting" }),
			{ ...cap("cap-2", "Deux lignes,\nla seconde.", 2.5, 2), caption: { speaker: "Ana", cue_id: "two", settings: "line:90%" } },
			cap("cap-3", "Fin.", 6, 1),
		],
	};
	cut.project.scenes[0].tracks.overlay.splice(1, 0, track);
	return cut;
}

test("Cut's project with a caption track is pinned as the file Film opens (cut-project-captions.otio)", () => {
	const cut = maximalWithCaptions();
	const doc = cutToOtio(cut as any);
	const bytes = new TextEncoder().encode(`${JSON.stringify(doc, null, 4)}\n`);
	assert.deepEqual(otioToCut(JSON.parse(new TextDecoder().decode(bytes))), cut, "Cut reads its own write back whole");
	const golden = join(FIX, "cut-project-captions.otio");
	if (process.env.CUT_BLESS) writeFileSync(golden, bytes);
	assert.deepEqual(new Uint8Array(readFileSync(golden)), bytes, "the golden file (CUT_BLESS=1 writes it)");
});

test("Film's save of Cut's caption project (film-saved-cut-captions.otio) opens in Cut's project mode with Film's caption edits; unedited, the very bytes", () => {
	const golden = join(FIX, "film-saved-cut-captions.otio");
	const bytes = new Uint8Array(readFileSync(golden));
	const s = CutSession.open("subs.otio", bytes);
	assert.equal(s.mode, "cut");
	const p = load(s);
	const [ct] = captionTracks(p.scenes[0]);
	assert.equal(ct.name, "Sous-titres");
	assert.equal(ct.caption.language, "fr");
	assert.deepEqual(ct.elements.map((e: J) => e.content), ["Bonjour.", "Deux, par Film.", "Ajouté par Film."]);
	assert.deepEqual(ct.elements.slice(0, 2).map((e: J) => e.id), ["cap-1", "cap-2"], "Cut's ids kept by Film");
	assert.match(ct.elements[2].id, /^film-\d+$/, "the caption Film made, named for Cut");
	assert.equal(ct.elements[0].name, "Greeting", "Cut's own name of a caption kept");
	assert.deepEqual(ct.elements[1].caption, { speaker: "Ana", cue_id: "two", settings: "line:90%" });
	assert.ok(ct.elements.every((e: J) => e.color === "#00ff00"), "Film's style change is every caption's colour in Cut");
	assert.deepEqual(s.save(p, s.media), bytes, "unedited: the very bytes");
});
