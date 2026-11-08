/**
 * Cut's editor on its OpenTimelineIO codec (OneOS doctrine files/989): what the host opens becomes the project the editor holds, and the
 * project the editor holds becomes the .otio the host saves. Pure: no DOM, no storage, no network (the browser half is `host-mode.ts`).
 *
 * Two ways in, decided by the file alone:
 * - **A Cut project** (a `SerializableCollection.1` holding `metadata.opencut.project`, as `cut-otio.ts` writes it) opens WHOLE: every
 *   scene, track, element, effect, bookmark and setting, through `otioToCut`; a save writes it through `cutToOtio`. It opens only when
 *   that writer gives the file back value for value (else `format-not-round-trip`), so a save can never lose a part of it.
 * - **Any other .otio** (Film's whole project, another tool's timeline) opens CARRIED (Mona 2026-11-08: "Stay on .otio, fix writers"):
 *   a plain track of clips and gaps of OneOS media, or of Cut's own generated elements, becomes a Cut track; every other track is LOCKED,
 *   named with its reason and written back exactly; every key Cut does not own is untouched. Cut's own data rides under `metadata.opencut`
 *   (an element's look on its clip, a track's type and switches on its track, bookmarks as `Marker.2` on the stack, settings on the root).
 *
 * One format holds everything of both (Mona 2026-11-08: "one format that can encompass everything of both"): what Cut makes in a carried
 * file is saved as Cut saves it in a Cut project, and reopens editable - a text, sticker, graphic or effect element as a `GeneratorReference.1`
 * of kind `OpenCut.<type>` with the element under `metadata.opencut.element`; a new scene as a Timeline of its own in the collection (a lone
 * Timeline becomes a collection holding it whole); overlapping elements as Cut's stacked lanes. An unedited save gives back the very bytes
 * that were opened. An untouched clip, gap or track is its own bytes; a moved or trimmed clip is written at its track's own rate when that
 * is exact, else in Cut's exact ticks (120000/s), never rounded. Refused by name at save, and nothing written: a library sound
 * (`library-sound-off`), a medium that is not a OneOS file (`media-not-referenced`), removing another editor's timeline (`scene-not-carried`).
 */
import { OTIO_EXT, OTIO_MAX_BYTES, OtioRefusal, decodeOtio, mediaUrl, parseMediaUrl, sameValue, type MediaRef, type OtioDocument } from "./otio.ts";
import { CutOtioRefusal, TICKS, cutToOtio, otioToCut, type CutMedia } from "./cut-otio.ts";
import { carry, foreignOf, type Foreign } from "./foreign.ts";
import { FILM_OWNED, type Frame, filmEffects, filmLook, writeFilmLook } from "./film-look.ts";

type J = Record<string, any>;

export type CutSaveCode = "keyframes-not-in-film" | "media-not-referenced" | "library-sound-off" | "scene-not-carried" | "element-not-carried" | "overlap-not-carried" | "format-not-round-trip" | "file-unreadable";

export class CutSaveRefusal extends Error {
	readonly code: CutSaveCode;
	constructor(code: CutSaveCode, reason: string) {
		super(`${code}: ${reason}`);
		this.code = code;
		this.name = "CutSaveRefusal";
	}
}

/** A track Cut carries but does not edit, named with its reason (the window says so). */
export interface LockedTrack { scene: string; track: string; reason: string }

const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const json = (v: unknown) => JSON.stringify(v);
const write = (v: unknown) => new TextEncoder().encode(`${JSON.stringify(v, null, 4)}\n`);

/** An element's fields its clip itself carries (its place, its trim, its medium); the rest is its look, kept under metadata.opencut.element. */
const MEDIA_CORE = new Set(["id", "type", "name", "startTime", "duration", "trimStart", "mediaId"]);
const GENERATED_CORE = new Set(["id", "type", "name", "startTime", "duration", "trimStart"]);
const MEDIA_TYPES = new Set(["video", "image", "audio"]);
/** Cut's own generated elements, saved as `GeneratorReference.1` of kind `OpenCut.<type>` (as Cut saves them in a Cut project). */
const GENERATED = new Set(["text", "sticker", "graphic", "effect"]);
const TRACK_TYPES = new Set(["video", "text", "audio", "graphic", "effect"]);

const rt = (value: number, rate: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate, value });
const tr = (start: number, dur: number, rate: number) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start, rate), duration: rt(dur, rate) });
/** OTIO time -> Cut ticks, or null when it is not a whole number of ticks. */
function toTicks(value: number, rate: number): number | null {
	if (!(rate > 0) || !Number.isFinite(value)) return null;
	const t = (value * TICKS) / rate;
	const r = Math.round(t);
	return Math.abs(t - r) < 1e-6 ? r : null;
}
/** Cut ticks -> OTIO value at `rate`, or null when it is not a whole number there. */
function fromTicks(ticks: number, rate: number): number | null {
	const v = (ticks * rate) / TICKS;
	const r = Math.round(v);
	return Math.abs(v - r) < 1e-9 ? r : null;
}

/** The file read and checked as Cut opens it: an .otio, within the bound, a JSON object. */
function readRaw(name: string, bytes: Uint8Array): J {
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
	if (ext !== OTIO_EXT) throw new OtioRefusal("format-not-editable", `Cut edits OpenTimelineIO projects (.otio); ${name} is an import, not a project it saves back`);
	if (bytes.byteLength > OTIO_MAX_BYTES) throw new OtioRefusal("file-too-large", `${name} is over ${OTIO_MAX_BYTES} bytes`);
	let raw: unknown;
	try {
		raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (e) {
		throw new OtioRefusal("file-unreadable", `${name} is not OpenTimelineIO JSON: ${(e as Error).message}`);
	}
	if (!isObj(raw)) throw new OtioRefusal("file-unreadable", `${name} is not an OpenTimelineIO object`);
	return raw;
}

const isCutProject = (raw: J) => raw.OTIO_SCHEMA === "SerializableCollection.1" && isObj(raw.metadata) && isObj(raw.metadata.opencut) && isObj(raw.metadata.opencut.project);

/** Where a carried Cut track sits: its index in its timeline's stack, the rate its own clips are timed at, and the frame of Film's sequence it is on. */
interface Origin { ki: number; rate: number; frame: Frame | null }

export class CutSession {
	readonly mode: "cut" | "carried";
	/** The project as the editor is to hold it (plain JSON: dates as ISO strings). In a carried project `settings` is null unless Cut saved some. */
	readonly project: J;
	/** Every medium the project uses, each a OneOS file and version (the loader asks the host for its bytes). */
	readonly media: CutMedia[];
	readonly locked: LockedTrack[];
	private bytes: Uint8Array;
	private raw: J;
	private readonly doc: OtioDocument | null;
	private readonly origins = new Map<string, Origin>();
	/** Each carried element's clip as the file holds it now (an untouched element is written back as exactly this). */
	private readonly clipOf = new Map<string, J>();
	/** What the last save wrote, made the file's own once the host confirms it (`committed`). */
	private pending: { raw: J; clips: Map<string, J>; origins: Map<string, Origin>; sceneAt: Map<string, number> } | null = null;
	/** Which timeline of the file each scene is (by index among the file's timelines). */
	private readonly sceneAt = new Map<string, number>();
	/** In a Cut project: what it holds that Cut does not own (another tool's keys, at any level), put back on every save. */
	private foreign: Foreign = new Map();
	private base: { project: string; media: string; tracks: Map<string, string[]>; names: Map<string, string>; switches: Map<string, string>; bookmarks: Map<string, string>; settings: string } | null = null;

	private constructor(mode: "cut" | "carried", bytes: Uint8Array, raw: J, doc: OtioDocument | null, project: J, media: CutMedia[], locked: LockedTrack[]) {
		this.mode = mode;
		this.bytes = bytes;
		this.raw = raw;
		this.doc = doc;
		this.project = project;
		this.media = media;
		this.locked = locked;
	}

	/** Open what the host handed over, or refuse it by name (`OtioRefusal`): it is never opened half. */
	static open(name: string, bytes: Uint8Array): CutSession {
		const raw = readRaw(name, bytes);
		const kept = bytes.slice();
		if (isCutProject(raw)) {
			let cut: ReturnType<typeof otioToCut>;
			try {
				cut = otioToCut(clone(raw));
			} catch (e) {
				throw new OtioRefusal("format-not-round-trip", `${name} names itself a Cut project but cannot be read as one (${(e as Error).message}); it is not opened for editing`);
			}
			let back: J | null = null;
			try {
				back = cutToOtio(clone(cut));
			} catch {
				back = null;
			}
			// Keys Cut does not own (Film's metadata.filmcraft, any other editor's, at any level) are carried; anything else Cut would damage.
			const foreign = back ? foreignOf(raw, back) : "Cut's writer cannot write it back";
			if (typeof foreign === "string") throw new OtioRefusal("format-not-round-trip", `${name} holds parts a Cut project does not, which a save would lose (${foreign}); it is not opened for editing`);
			const s = new CutSession("cut", kept, raw, null, cut.project, cut.media, []);
			s.foreign = foreign;
			return s;
		}
		const doc = decodeOtio(name, bytes);
		return CutSession.carried(name, kept, raw, doc);
	}

	private static carried(name: string, bytes: Uint8Array, raw: J, doc: OtioDocument): CutSession {
		const locked: LockedTrack[] = [];
		const media: CutMedia[] = [];
		const mediaKey = (m: MediaRef) => `oneos-${m.id}-${m.version}`;
		const origins = new Map<string, Origin>();
		const clips = new Map<string, J>();
		const scenes = doc.timelines.map((tl, ti) => {
			const sceneId = `otio-t${ti}`;
			const tracks = { main: null as J | null, overlay: [] as J[], audio: [] as J[] };
			const frame = filmFrame(tl.raw);
			tl.tracks.forEach((t, ki) => {
				const why = t.locked ?? carriedLock(t.raw) ?? filmLock(t.raw, frame, t.kind === "Audio");
				if (why) { locked.push({ scene: tl.name, track: t.name, reason: why }); return; }
				const trackId = `${sceneId}-k${ki}`;
				const audio = t.kind === "Audio";
				const own = isObj(t.raw.metadata?.opencut?.track) ? t.raw.metadata.opencut.track : {};
				// A Film track's mute is Film's own switch (metadata.filmcraft.muted): Cut edits THAT switch, never a second one of its own.
				const muted = filmSwitch(t.raw) ?? own.muted === true;
				const type: string = TRACK_TYPES.has(own.type) ? own.type : audio ? "audio" : "video";
				const elements: J[] = [];
				const lanes = t.lanes ?? [t.items];
				lanes.forEach((lane, li) => {
					let at = 0;
					lane.forEach((it, ii) => {
						const start = toTicks(it.source.start, it.source.rate) as number;
						const dur = toTicks(it.source.duration, it.source.rate) as number;
						if (it.type === "gap") { at += dur; return; }
						const id = t.lanes ? `${trackId}-l${li}-i${ii}` : `${trackId}-i${ii}`;
						const look = isObj(it.metadata.opencut?.element) ? clone(it.metadata.opencut.element) : {};
						clips.set(id, clone(it.raw));
						if (it.type === "generator") {
							elements.push({ trimEnd: 0, ...look, id, type: it.kind.slice("OpenCut.".length), name: it.name, startTime: at, duration: dur, trimStart: start });
						} else {
							const ref = it.raw.media_references.DEFAULT_MEDIA;
							const key = mediaKey(it.media);
							if (!media.some((m) => m.id === key)) media.push({ id: key, name: typeof ref.name === "string" && ref.name ? ref.name : it.name, type: audio ? "audio" : "video", file: { id: it.media.id, version: it.media.version } });
							const avail = isObj(ref.available_range) ? toTicks(ref.available_range.duration?.value, ref.available_range.duration?.rate) : null;
							const placed = avail === null ? { trimEnd: look.trimEnd ?? 0 } : { trimEnd: Math.max(0, avail - start - dur), sourceDuration: avail };
							// A Film clip's gain (metadata.filmcraft.gain_db) IS Cut's volume: both are decibels, so Cut edits Film's own value.
							const gain = filmGain(it.raw);
							if (gain !== null) look.volume = gain;
							// Film's look on its clip (Motion, Opacity, Gaussian Blur, keyframes) IS the element's: Cut edits Film's own values.
							if (filmEffects(it.raw) && frame) {
								const kind = audio ? "audio" : look.type === "image" ? "image" : "video";
								for (const k of FILM_OWNED(kind)) delete look[k];
								Object.assign(look, filmLook(it.raw, kind, frame, gain ?? 0) as J);
							}
							elements.push({
								...look, id, type: audio ? "audio" : "video", ...(audio ? { sourceType: look.sourceType ?? "upload" } : {}), name: it.name, mediaId: key,
								startTime: at, duration: dur, trimStart: start, ...placed,
							});
						}
						at += dur;
					});
				});
				origins.set(trackId, { ki, rate: lanes.flat()[0]?.source.rate ?? 30, frame });
				const cutTrack = type === "audio"
					? { id: trackId, name: t.name, type, muted, elements }
					: type === "video"
						? { id: trackId, name: t.name, type, muted, hidden: own.hidden === true, elements }
						: { id: trackId, name: t.name, type, hidden: own.hidden === true, elements };
				if (type === "audio") tracks.audio.push(cutTrack);
				else if (type === "video" && !tracks.main) tracks.main = cutTrack;
				else tracks.overlay.push(cutTrack);
			});
			// Cut always holds a main video track; one the file did not have is written only once it holds something.
			if (!tracks.main) tracks.main = { id: `${sceneId}-main`, name: "Main", type: "video", muted: false, hidden: false, elements: [] };
			const stackMarkers: J[] = Array.isArray(tl.raw.tracks?.markers) ? tl.raw.tracks.markers : [];
			const bookmarks = stackMarkers.filter(ownMarker).map((m) => ({ time: toTicks(m.marked_range.start_time.value, m.marked_range.start_time.rate) ?? 0, ...m.metadata.opencut.bookmark }));
			return { id: sceneId, name: tl.name, isMain: ti === 0, tracks, bookmarks, createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" };
		});
		const stem = name.slice(0, name.lastIndexOf("."));
		const settings = isObj(raw.metadata?.opencut?.settings) ? clone(raw.metadata.opencut.settings) : null;
		const project = { metadata: { id: "oneos", name: stem, duration: 0, createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z" }, scenes, currentSceneId: scenes[0].id, settings, version: null };
		const s = new CutSession("carried", bytes, raw, doc, project, media, locked);
		for (const [k, v] of origins) s.origins.set(k, v);
		for (const [k, v] of clips) s.clipOf.set(k, v);
		for (const [ti, sc] of scenes.entries()) s.sceneAt.set(sc.id, ti);
		return s;
	}

	/** The project and media as the editor holds them once loaded (its defaults filled in): an unedited save is measured against this. */
	baseline(project: J, media: CutMedia[]): void {
		const p = clone(project);
		const tracks = new Map<string, string[]>(), names = new Map<string, string>(), switches = new Map<string, string>(), bookmarks = new Map<string, string>();
		for (const sc of p.scenes as J[]) {
			bookmarks.set(sc.id, json(sc.bookmarks ?? []));
			for (const t of allTracks(sc)) {
				tracks.set(t.id, (t.elements as J[]).map(json));
				names.set(t.id, t.name);
				switches.set(t.id, json(switchesOf(t)));
			}
		}
		this.base = { project: json(steady(p)), media: json(media), tracks, names, switches, bookmarks, settings: json(p.settings ?? null) };
	}

	/** Does the project hold an edit since it was opened (or last saved)? Before `baseline` it is counted as edited. */
	isEdited(project: J, media: CutMedia[]): boolean {
		return !this.base || json(steady(clone(project))) !== this.base.project || json(clone(media)) !== this.base.media;
	}

	/** The .otio the host saves, or a refusal by name (`CutSaveRefusal`): nothing is written half. */
	save(project: J, media: CutMedia[]): Uint8Array {
		const p = clone(project);
		const m = clone(media);
		if (this.base && json(steady(p)) === this.base.project && json(m) === this.base.media) return this.bytes.slice();
		if (this.mode === "cut") {
			try {
				const out = carry(cutToOtio({ project: p, media: m }), this.foreign);
				this.pending = { raw: out, clips: new Map(), origins: new Map(), sceneAt: new Map() };
				return write(out);
			} catch (e) {
				if (e instanceof CutOtioRefusal) throw new CutSaveRefusal(e.code, e.message.replace(/^[a-z-]+: /, ""));
				throw e;
			}
		}
		const clips = new Map<string, J>(), origins = new Map<string, Origin>(), sceneAt = new Map<string, number>();
		const out = this.carriedSave(p, m, clips, origins, sceneAt);
		this.pending = { raw: out, clips, origins, sceneAt };
		return write(out);
	}

	/**
	 * The host saved what `save` last answered (`craft:saved`): it is now the file. The next save is made on it, and is measured against the
	 * project as the editor holds it now. Bytes other than the last save's are refused by name (the editor would save on a file it never held).
	 */
	committed(bytes: Uint8Array, project: J, media: CutMedia[]): void {
		const p = this.pending;
		let raw: unknown = null;
		try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { raw = null; }
		if (!p || !sameValue(raw, p.raw)) throw new CutSaveRefusal("format-not-round-trip", "the saved bytes are not the ones this window last wrote");
		this.pending = null;
		this.raw = p.raw;
		this.bytes = bytes.slice();
		if (this.mode === "carried") {
			this.origins.clear();
			for (const [k, v] of p.origins) this.origins.set(k, v);
			for (const [k, v] of p.clips) this.clipOf.set(k, v);
			this.sceneAt.clear();
			for (const [k, v] of p.sceneAt) this.sceneAt.set(k, v);
		}
		this.baseline(project, media);
	}

	private carriedSave(p: J, media: CutMedia[], clips: Map<string, J>, origins: Map<string, Origin>, sceneAt: Map<string, number>): J {
		const base = this.base;
		let raw = clone(this.raw);
		const timelinesOf = (r: J): J[] => (r.OTIO_SCHEMA === "Timeline.1" ? [r] : r.children.filter((c: unknown) => isObj(c) && c.OTIO_SCHEMA === "Timeline.1"));
		const roots = timelinesOf(raw);
		const scenes = p.scenes as J[];
		const mediaById = new Map(media.map((x) => [x.id, x]));
		// A timeline the person removed: Cut's own goes; any other is the file's (another editor's sequence), refused by name.
		const dropped = new Set<J>();
		roots.forEach((tl, ti) => {
			if (scenes.some((sc) => this.sceneAt.get(sc.id) === ti)) return;
			if (!isObj(tl.metadata?.opencut?.scene)) throw new CutSaveRefusal("scene-not-carried", `the timeline "${tl.name}" was removed; it is this file's own (another editor's), so Cut keeps it`);
			dropped.add(tl);
		});
		const fresh: J[] = [];
		const freshScenes: J[] = [];
		for (const sc of scenes) {
			const ti = this.sceneAt.get(sc.id);
			if (ti === undefined) {
				const tl = this.timelineOf(sc, mediaById, clips, origins);
				fresh.push(tl);
				freshScenes.push(sc);
				continue;
			}
			const tl = roots[ti];
			tl.name = sc.name;
			const stack = tl.tracks;
			const kept: Array<J | null> = [...stack.children];
			const added: Array<{ id: string; track: J }> = [];
			for (const t of allTracks(sc)) {
				const origin = this.origins.get(t.id);
				const was = base?.tracks.get(t.id);
				const elementsSame = was !== undefined && json((t.elements as J[]).map(json)) === json(was);
				if (origin) {
					const before = kept[origin.ki] as J;
					const out = elementsSame ? before : this.trackBody(t, before, origin.rate, mediaById, clips, origin.frame);
					if (!base || base.names.get(t.id) !== t.name) out.name = t.name;
					if (!base || base.switches.get(t.id) !== json(switchesOf(t))) {
					if (filmSwitch(out) !== null) {
						// Film's track: its mute is written as Film's own switch; Cut keeps only what Film has no place for (its type, hidden).
						const { muted, ...rest } = trackInfo(t) as J;
						out.metadata = { ...out.metadata, filmcraft: { ...out.metadata.filmcraft, muted }, opencut: { ...(out.metadata?.opencut ?? {}), track: rest } };
					} else out.metadata = { ...out.metadata, opencut: { ...(out.metadata?.opencut ?? {}), track: trackInfo(t) } };
				}
					kept[origin.ki] = out;
				} else if ((t.elements as J[]).length) {
					added.push({ id: t.id, track: this.trackBody(t, null, TICKS, mediaById, clips, null) });
				}
			}
			// A track of the file Cut no longer holds was removed by the person (a locked one is never in Cut's hands, so never removed).
			const held = new Set(allTracks(sc).map((t: J) => this.origins.get(t.id)?.ki).filter((k) => k !== undefined));
			const mine = [...this.origins].filter(([k]) => k.startsWith(`${sc.id}-`));
			for (const [, o] of mine) if (!held.has(o.ki)) kept[o.ki] = null;
			// The stack as saved: the file's tracks Cut still holds (and every locked one) in their places, then the new ones. Where each Cut
			// track now sits is what the next save needs, once the host confirms this one.
			const removed = new Set(kept.map((x, i) => (x === null ? i : -1)).filter((i) => i >= 0));
			const shift = (ki: number) => ki - [...removed].filter((r) => r < ki).length;
			for (const [k, o] of mine) if (!removed.has(o.ki)) origins.set(k, { ...o, ki: shift(o.ki) });
			const survivors = kept.filter((x): x is J => x !== null);
			added.forEach((a, i) => {
				origins.set(a.id, { ki: survivors.length + i, rate: TICKS, frame: null });
			});
			stack.children = [...survivors, ...added.map((a) => a.track)];
			if (!base || base.bookmarks.get(sc.id) !== json(sc.bookmarks ?? [])) {
				const others = (Array.isArray(stack.markers) ? stack.markers : []).filter((mk: J) => !ownMarker(mk));
				stack.markers = [...others, ...bookmarkMarkers(sc)];
			}
		}
		if (fresh.length || dropped.size) {
			// A lone Timeline given a second scene becomes a collection holding it whole.
			if (raw.OTIO_SCHEMA === "Timeline.1") raw = { OTIO_SCHEMA: "SerializableCollection.1", name: raw.name, metadata: {}, children: [raw] };
			raw.children = [...(raw.children as J[]).filter((c) => !dropped.has(c)), ...fresh];
		}
		const finalRoots = timelinesOf(raw);
		for (const sc of scenes) {
			const at = this.sceneAt.has(sc.id) ? finalRoots.indexOf(roots[this.sceneAt.get(sc.id) as number]) : finalRoots.indexOf(fresh[freshScenes.indexOf(sc)]);
			sceneAt.set(sc.id, at);
		}
		if (!base || json(p.settings ?? null) !== base.settings) raw.metadata = { ...(raw.metadata ?? {}), opencut: { ...(raw.metadata?.opencut ?? {}), settings: p.settings } };
		return raw;
	}

	/** A scene Cut made, as a Timeline of its own in the file (as Cut writes its scenes): its tracks that hold something, its bookmarks. */
	private timelineOf(sc: J, mediaById: Map<string, CutMedia>, clips: Map<string, J>, origins: Map<string, Origin>): J {
		const tracks = allTracks(sc).filter((t) => (t.elements as J[]).length);
		tracks.forEach((t, ki) => {
			origins.set(t.id, { ki, rate: TICKS, frame: null });
		});
		const { name: _n, tracks: _t, bookmarks: _b, id: _i, createdAt: _c, updatedAt: _u, ...scene } = sc;
		return {
			OTIO_SCHEMA: "Timeline.1", name: sc.name, global_start_time: null, metadata: { opencut: { scene } },
			tracks: { OTIO_SCHEMA: "Stack.1", name: "tracks", source_range: null, effects: [], markers: bookmarkMarkers(sc), enabled: true, metadata: {}, children: tracks.map((t) => this.trackBody(t, null, TICKS, mediaById, clips, null)) },
		};
	}

	/**
	 * A Cut track as an OTIO track: one sequence (`Track.1`) when its elements do not overlap, else Cut's stacked lanes (a `Stack.1` of
	 * `Track.1` lanes, the fewest that hold them), each carrying the track's own data. Untouched clips and gaps are their own bytes; the rest is
	 * written at `rate` when exact, else in ticks.
	 */
	private trackBody(t: J, before: J | null, rate: number, mediaById: Map<string, CutMedia>, clips: Map<string, J>, frame: Frame | null): J {
		const els = [...(t.elements as J[])].sort((a, b) => a.startTime - b.startTime);
		for (const e of els) this.checkCarried(e, mediaById);
		const lanes: J[][] = [];
		for (const e of els) {
			const free = lanes.find((l) => { const last = l[l.length - 1]; return last.startTime + last.duration <= e.startTime; });
			if (free) free.push(e);
			else lanes.push([e]);
		}
		if (!lanes.length) lanes.push([]);
		const wasLanes: J[][] = !before ? [] : before.OTIO_SCHEMA === "Stack.1" ? (before.children as J[]).map((l) => l.children as J[]) : [before.children as J[]];
		const baseEls = new Map((this.base?.tracks.get(t.id) ?? []).map((x) => { const e = JSON.parse(x); return [e.id as string, x]; }));
		const laneChildren = (l: J[], was: J[]): J[] => {
			const gaps: Array<{ at: number; dur: number; raw: J }> = [];
			let at = 0;
			for (const c of was) {
				const dur = toTicks(c.source_range.duration.value, c.source_range.duration.rate) ?? 0;
				if (c.OTIO_SCHEMA === "Gap.1") gaps.push({ at, dur, raw: c });
				at += dur;
			}
			const out: J[] = [];
			at = 0;
			for (const e of l) {
				if (e.startTime > at) {
					const g = e.startTime - at;
					const same = gaps.find((x) => x.at === at && x.dur === g);
					out.push(same ? same.raw : { OTIO_SCHEMA: "Gap.1", name: "", source_range: timeRange(0, g, rate), effects: [], markers: [], enabled: true, metadata: {} });
				}
				const prior = this.clipOf.get(e.id);
				const was = baseEls.get(e.id);
				const c = prior && was === json(e) ? prior : this.clip(e, prior, rate, mediaById, was ? JSON.parse(was) : null, frame);
				clips.set(e.id, c);
				out.push(c);
				at = e.startTime + e.duration;
			}
			return out;
		};
		const kind = t.type === "audio" ? "Audio" : "Video";
		const plain = (children: J[], metadata: J): J => ({ OTIO_SCHEMA: "Track.1", name: t.name, kind, source_range: null, effects: [], markers: [], enabled: true, metadata, children });
		if (lanes.length === 1) {
			const children = laneChildren(lanes[0], wasLanes[0] ?? []);
			if (before?.OTIO_SCHEMA === "Track.1") return { ...before, children };
			return plain(children, before ? before.metadata : { opencut: { track: trackInfo(t) } });
		}
		const metadata = { ...(before?.metadata ?? {}), opencut: { ...(before?.metadata?.opencut ?? {}), track: { ...(before?.metadata?.opencut?.track ?? {}), ...trackInfo(t) } } };
		return {
			OTIO_SCHEMA: "Stack.1", name: t.name, source_range: null, effects: [], markers: [], enabled: true, metadata,
			children: lanes.map((l, i) => ({ ...plain(laneChildren(l, wasLanes[i] ?? []), { opencut: { lane: i } }), name: `${t.name} (lane ${i + 1})` })),
		};
	}

	private checkCarried(e: J, mediaById: Map<string, CutMedia>): void {
		if (e.type === "audio" && e.sourceType === "library") throw new CutSaveRefusal("library-sound-off", `the library sound "${e.name}" comes from Freesound, which is off in OneOS; a sound is used only once it is a OneOS file`);
		if (GENERATED.has(e.type)) return;
		if (!MEDIA_TYPES.has(e.type)) throw new CutSaveRefusal("element-not-carried", `the ${String(e.type)} "${e.name}" is not an element Cut knows how to save`);
		const m = mediaById.get(e.mediaId);
		if (!m || !m.file || !parseMediaUrl(`oneos:file/${m.file.id}?version=${m.file.version}`)) throw new CutSaveRefusal("media-not-referenced", `the medium ${m?.name ?? e.mediaId} of "${e.name}" is not a OneOS file and version; put it in Files and insert it from there`);
	}

	private clip(e: J, before: J | undefined, trackRate: number, mediaById: Map<string, CutMedia>, was: J | null, frame: Frame | null): J {
		const rate = before ? before.source_range.duration.rate : trackRate;
		const range = timeRange(e.trimStart, e.duration, rate);
		if (GENERATED.has(e.type)) {
			const look = Object.fromEntries(Object.entries(e).filter(([k]) => !GENERATED_CORE.has(k)));
			const ref = { OTIO_SCHEMA: "GeneratorReference.1", name: e.name, generator_kind: `OpenCut.${e.type}`, parameters: {}, available_range: null, metadata: {} };
			if (before) {
				const c = clone(before);
				c.name = e.name;
				c.source_range = range;
				c.media_references.DEFAULT_MEDIA.name = e.name;
				c.metadata = { ...(c.metadata ?? {}), opencut: { ...(c.metadata?.opencut ?? {}), element: look } };
				return c;
			}
			return { OTIO_SCHEMA: "Clip.2", name: e.name, source_range: range, effects: [], markers: [], enabled: true, media_references: { DEFAULT_MEDIA: ref }, active_media_reference_key: "DEFAULT_MEDIA", metadata: { opencut: { element: look } } };
		}
		const m = mediaById.get(e.mediaId) as CutMedia;
		const url = mediaUrl(m.file.id, m.file.version);
		// Where the medium states its length, the trim's end and the source's length are read from it; else they ride with the element.
		const derived = isObj(before?.media_references?.DEFAULT_MEDIA?.available_range);
		const look = Object.fromEntries(Object.entries(e).filter(([k]) => !MEDIA_CORE.has(k) && !(derived && (k === "trimEnd" || k === "sourceDuration"))));
		if (e.type === "audio") delete look.sourceType;
		if (before) {
			const c = clone(before);
			c.name = e.name;
			c.source_range = range;
			c.media_references.DEFAULT_MEDIA.target_url = url;
			// Film's clip: its volume is Film's gain, written as Film's own value (never a second volume of Cut's beside it).
			const gainWas = filmGain(before);
			if (gainWas !== null) {
				c.metadata.filmcraft = { ...c.metadata.filmcraft, gain_db: typeof e.volume === "number" ? e.volume : 0 };
				delete look.volume;
			}
			// Film's look on its clip: what Cut changed is written in Film's shape (its effects and their keyframes), never as Cut's own beside it.
			if (filmEffects(before) && frame && was) {
				const kind = e.type === "audio" ? "audio" : e.type === "image" ? "image" : "video";
				const gain = typeof e.volume === "number" ? e.volume : 0;
				// Film's volume keyframes are dB over the clip's gain: a new gain moves them so the sound Cut set stays.
				const wasAt = gainWas !== null && gainWas !== gain ? { ...was, animations: undefined } : was;
				const effects = writeFilmLook(before, kind, frame, gain, wasAt, e);
				if (typeof effects === "string") throw new CutSaveRefusal("keyframes-not-in-film", effects.replace(/^keyframes-not-in-film: /, ""));
				c.metadata.filmcraft = { ...c.metadata.filmcraft, effects };
				for (const k of FILM_OWNED(kind)) delete look[k];
			}
			c.metadata = { ...(c.metadata ?? {}), opencut: { ...(c.metadata?.opencut ?? {}), element: look } };
			return c;
		}
		return {
			OTIO_SCHEMA: "Clip.2", name: e.name, source_range: range, effects: [], markers: [], enabled: true,
			media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: "ExternalReference.1", name: m.name, target_url: url, available_range: null, available_image_bounds: null, metadata: {} } },
			active_media_reference_key: "DEFAULT_MEDIA", metadata: { opencut: { element: look } },
		};
	}
}

/** A start and a duration at `rate` when both are whole there, else both in Cut's exact ticks. */
function timeRange(startTicks: number, durTicks: number, rate: number): J {
	const s = fromTicks(startTicks, rate), d = fromTicks(durTicks, rate);
	return s !== null && d !== null ? tr(s, d, rate) : tr(startTicks, durTicks, TICKS);
}

/** The project less what the editor changes by itself (when it last stored it, the duration it measures, where the person is looking). */
function steady(p: J): J {
	const q = clone(p);
	if (isObj(q.metadata)) { delete q.metadata.updatedAt; delete q.metadata.duration; }
	delete q.timelineViewState;
	for (const sc of (q.scenes ?? []) as J[]) delete sc.updatedAt;
	return q;
}

const ownMarker = (m: unknown) => isObj(m) && m.OTIO_SCHEMA === "Marker.2" && isObj(m.metadata?.opencut?.bookmark) && isObj(m.marked_range?.start_time);
const allTracks = (sc: J): J[] => [sc.tracks.main, ...sc.tracks.overlay, ...sc.tracks.audio].filter(Boolean);
/** A track's own data Cut keeps on it: its type and its switches. */
const trackInfo = (t: J) => ({ type: t.type, ...switchesOf(t) });
const bookmarkMarkers = (sc: J): J[] => ((sc.bookmarks ?? []) as J[]).map((b) => {
	const { time, ...rest } = b;
	return { OTIO_SCHEMA: "Marker.2", name: typeof b.note === "string" ? b.note : "", marked_range: tr(time, b.duration ?? 0, TICKS), color: "RED", comment: "", metadata: { opencut: { bookmark: rest } } };
});
const switchesOf = (t: J) => (t.type === "audio" ? { muted: t.muted === true } : t.type === "video" ? { muted: t.muted === true, hidden: t.hidden === true } : { hidden: t.hidden === true });

/** Cut's volume range, in decibels (timeline/audio-constants.ts). */
const VOLUME_DB = { min: -60, max: 20 };
/** A Film clip's gain in decibels (metadata.filmcraft.gain_db), or null when the clip is not Film's. */
function filmGain(c: J): number | null {
	const g = isObj(c?.metadata?.filmcraft) ? c.metadata.filmcraft.gain_db : undefined;
	return typeof g === "number" && Number.isFinite(g) ? g : null;
}
/** A Film track's mute (metadata.filmcraft.muted), or null when the track is not Film's. */
function filmSwitch(t: J): boolean | null {
	const m = isObj(t?.metadata?.filmcraft) ? t.metadata.filmcraft.muted : undefined;
	return typeof m === "boolean" ? m : null;
}

/** The frame of Film's sequence a timeline is (its width and height), or null when Film did not write it. */
function filmFrame(tl: J): Frame | null {
	const s = tl?.metadata?.filmcraft?.settings;
	return isObj(s) && typeof s.width === "number" && typeof s.height === "number" ? { w: s.width, h: s.height } : null;
}

/** Why Film's look on a clip of the track is not one Cut can show and write back (null: it can, or the track holds no Film clip). */
function filmLock(t: J, frame: Frame | null, audio: boolean): string | null {
	const lanes: J[] = t.OTIO_SCHEMA === "Stack.1" ? t.children : [t];
	for (const c of lanes.flatMap((l) => (Array.isArray(l.children) ? l.children : []) as J[])) {
		if (c?.OTIO_SCHEMA !== "Clip.2" || !filmEffects(c)) continue;
		if (!frame) return `Film's clip "${c.name ?? ""}" is on a timeline whose frame size Film did not write`;
		const kind = audio ? "audio" : c.metadata?.opencut?.element?.type === "image" ? "image" : "video";
		const look = filmLook(c, kind, frame, filmGain(c) ?? 0);
		if (typeof look === "string") return look;
	}
	return null;
}

/** Why a track `otio.ts` finds editable is still not one Cut may REWRITE without loss (null: it may). */
function carriedLock(t: J): string | null {
	if (t.enabled === false) return "it is switched off, which Cut has no switch for";
	if (t.source_range !== null && t.source_range !== undefined) return "it is trimmed as a whole, which Cut does not show";
	const lanes: J[] = t.OTIO_SCHEMA === "Stack.1" ? t.children : [t];
	for (const l of lanes) if (l.enabled === false || (l.source_range !== null && l.source_range !== undefined)) return "a lane of it is switched off or trimmed, which Cut does not show";
	for (const c of lanes.flatMap((l) => l.children as J[])) {
		const r = c.source_range;
		if (toTicks(r.start_time.value, r.start_time.rate) === null || toTicks(r.duration.value, r.duration.rate) === null) return `${c.OTIO_SCHEMA} "${c.name ?? ""}" has times that are not whole ticks of Cut's clock (${TICKS}/s)`;
		if (c.enabled === false) return `${c.OTIO_SCHEMA} "${c.name ?? ""}" is switched off, which Cut has no switch for`;
		const g = filmGain(c);
		if (g !== null && (g < VOLUME_DB.min || g > VOLUME_DB.max)) return `Film's gain of ${g} dB on "${c.name ?? ""}" is outside Cut's volume range (${VOLUME_DB.min} to ${VOLUME_DB.max} dB)`;
		if (c.OTIO_SCHEMA === "Gap.1" && ((typeof c.name === "string" && c.name) || (isObj(c.metadata) && Object.keys(c.metadata).length))) return "a gap carries data of its own, which a rewrite of the track would not keep";
	}
	return null;
}
