/**
 * Cut's editor on its OpenTimelineIO codec (OneOS doctrine files/989): what the host opens becomes the project the editor holds, and the
 * project the editor holds becomes the .otio the host saves. Pure: no DOM, no storage, no network (the browser half is `host-mode.ts`).
 *
 * Two ways in, decided by the file alone:
 * - **A Cut project** (a `SerializableCollection.1` holding `metadata.opencut.project`, as `cut-otio.ts` writes it) opens WHOLE: every
 *   scene, track, element, effect, bookmark and setting, through `otioToCut`; a save writes it through `cutToOtio`. It opens only when
 *   that writer gives the file back value for value (else `format-not-round-trip`), so a save can never lose a part of it.
 * - **Any other .otio** (Film's whole project, another tool's timeline) opens CARRIED (Mona 2026-11-08: "Stay on .otio, fix writers"):
 *   a plain track of clips and gaps of OneOS media becomes a Cut track; every other track is LOCKED, named with its reason and written
 *   back exactly; every key Cut does not own is untouched. Cut's own data rides under `metadata.opencut` (an element's look on its clip,
 *   a track's switches on its track, bookmarks as `Marker.2` on the stack, the project's settings on the root).
 *
 * An unedited save gives back the very bytes that were opened. In a carried project an untouched clip, gap or track is its own bytes; a
 * moved or trimmed clip is written at its track's own rate when that is exact, else in Cut's exact ticks (120000/s), never rounded. What a
 * carried project has no place for is refused by name at save, and nothing is written: a new scene, a text/sticker/graphic/effect element,
 * overlapping elements on one track, a library sound, a medium that is not a OneOS file.
 */
import { OTIO_EXT, OTIO_MAX_BYTES, OtioRefusal, decodeOtio, mediaUrl, parseMediaUrl, sameValue, type MediaRef, type OtioDocument } from "./otio.ts";
import { CutOtioRefusal, TICKS, cutToOtio, otioToCut, type CutMedia } from "./cut-otio.ts";

type J = Record<string, any>;

export type CutSaveCode = "media-not-referenced" | "library-sound-off" | "scene-not-carried" | "element-not-carried" | "overlap-not-carried" | "format-not-round-trip" | "file-unreadable";

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

/** An element's fields the clip itself carries (its place, its trim, its medium); the rest is its look, kept under metadata.opencut.element. */
const CORE = new Set(["id", "type", "name", "startTime", "duration", "trimStart", "trimEnd", "sourceDuration", "mediaId"]);
const extrasOf = (e: J) => Object.fromEntries(Object.entries(e).filter(([k]) => !CORE.has(k)));

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

/** Where a carried Cut track came from: the timeline and the stack index, and the rate its own clips are timed at. */
interface Origin { ti: number; ki: number; rate: number }

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
	private pending: { raw: J; clips: Map<string, J>; origins: Map<string, Origin> } | null = null;
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
			if (!back || !sameValue(back, raw)) throw new OtioRefusal("format-not-round-trip", `${name} holds parts a Cut project does not, which a save would lose; it is not opened for editing`);
			return new CutSession("cut", kept, raw, null, cut.project, cut.media, []);
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
			tl.tracks.forEach((t, ki) => {
				const why = t.locked ?? carriedLock(t.raw);
				if (why) { locked.push({ scene: tl.name, track: t.name, reason: why }); return; }
				const trackId = `${sceneId}-k${ki}`;
				const audio = t.kind === "Audio";
				const own = isObj(t.raw.metadata?.opencut?.track) ? t.raw.metadata.opencut.track : {};
				const elements: J[] = [];
				let at = 0;
				t.items.forEach((it, ii) => {
					const start = toTicks(it.source.start, it.source.rate)!;
					const dur = toTicks(it.source.duration, it.source.rate)!;
					if (it.type === "gap") { at += dur; return; }
					const ref = it.raw.media_references.DEFAULT_MEDIA;
					const key = mediaKey(it.media);
					if (!media.some((m) => m.id === key)) media.push({ id: key, name: typeof ref.name === "string" && ref.name ? ref.name : it.name, type: audio ? "audio" : "video", file: { id: it.media.id, version: it.media.version } });
					const avail = isObj(ref.available_range) ? toTicks(ref.available_range.duration?.value, ref.available_range.duration?.rate) : null;
					const look = isObj(it.metadata.opencut?.element) ? clone(it.metadata.opencut.element) : {};
					clips.set(`${trackId}-i${ii}`, clone(it.raw));
					elements.push({
						...look, id: `${trackId}-i${ii}`, type: audio ? "audio" : "video", ...(audio ? { sourceType: look.sourceType ?? "upload" } : {}), name: it.name, mediaId: key,
						startTime: at, duration: dur, trimStart: start, trimEnd: avail === null ? 0 : Math.max(0, avail - start - dur), ...(avail === null ? {} : { sourceDuration: avail }),
					});
					at += dur;
				});
				origins.set(trackId, { ti, ki, rate: t.items[0]?.source.rate ?? 30 });
				const cutTrack = audio
					? { id: trackId, name: t.name, type: "audio", muted: own.muted === true, elements }
					: { id: trackId, name: t.name, type: "video", muted: own.muted === true, hidden: own.hidden === true, elements };
				if (audio) tracks.audio.push(cutTrack);
				else if (!tracks.main) tracks.main = cutTrack;
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
				const out = cutToOtio({ project: p, media: m });
				this.pending = { raw: out, clips: new Map(), origins: new Map() };
				return write(out);
			} catch (e) {
				if (e instanceof CutOtioRefusal) throw new CutSaveRefusal(e.code, e.message.replace(/^[a-z-]+: /, ""));
				throw e;
			}
		}
		const clips = new Map<string, J>(), origins = new Map<string, Origin>();
		const out = this.carriedSave(p, m, clips, origins);
		this.pending = { raw: out, clips, origins };
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
		}
		this.baseline(project, media);
	}

	private carriedSave(p: J, media: CutMedia[], clips: Map<string, J>, origins: Map<string, Origin>): J {
		const base = this.base;
		const raw = clone(this.raw);
		const roots: J[] = raw.OTIO_SCHEMA === "Timeline.1" ? [raw] : raw.children.filter((c: unknown) => isObj(c) && c.OTIO_SCHEMA === "Timeline.1");
		const want = new Set(this.doc!.timelines.map((_, ti) => `otio-t${ti}`));
		const scenes = p.scenes as J[];
		for (const sc of scenes) if (!want.has(sc.id)) throw new CutSaveRefusal("scene-not-carried", `the scene "${sc.name}" is new; this project's timelines are the file's own (save it as a Cut project to add scenes)`);
		for (const id of want) if (!scenes.some((sc) => sc.id === id)) throw new CutSaveRefusal("scene-not-carried", `a timeline of the file was removed; this project's timelines are the file's own`);
		const mediaById = new Map(media.map((x) => [x.id, x]));
		for (const sc of scenes) {
			const ti = Number(sc.id.slice("otio-t".length));
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
					const out = kept[origin.ki]!;
					if (!elementsSame) out.children = this.trackChildren(t, out.children, origin.rate, mediaById, clips);
					if (!base || base.names.get(t.id) !== t.name) out.name = t.name;
					if (!base || base.switches.get(t.id) !== json(switchesOf(t))) out.metadata = { ...out.metadata, opencut: { ...(out.metadata?.opencut ?? {}), track: switchesOf(t) } };
				} else if ((t.elements as J[]).length) {
					const kind = t.type === "audio" ? "Audio" : "Video";
					added.push({ id: t.id, track: { OTIO_SCHEMA: "Track.1", name: t.name, kind, source_range: null, effects: [], markers: [], enabled: true, metadata: { opencut: { track: switchesOf(t) } }, children: this.trackChildren(t, [], TICKS, mediaById, clips) } });
				}
			}
			// A track of the file Cut no longer holds was removed by the person (a locked one is never in Cut's hands, so never removed).
			const held = new Set(allTracks(sc).map((t: J) => this.origins.get(t.id)?.ki).filter((k) => k !== undefined));
			for (const [k, o] of this.origins) if (k.startsWith(`${sc.id}-`) && !held.has(o.ki)) kept[o.ki] = null;
			// The stack as saved: the file's tracks Cut still holds (and every locked one) in their places, then the new ones. Where each Cut
			// track now sits is what the next save needs, once the host confirms this one.
			const removed = new Set(kept.map((x, i) => (x === null ? i : -1)).filter((i) => i >= 0));
			const shift = (ki: number) => ki - [...removed].filter((r) => r < ki).length;
			for (const [k, o] of this.origins) if (k.startsWith(`${sc.id}-`) && !removed.has(o.ki)) origins.set(k, { ...o, ki: shift(o.ki) });
			const survivors = kept.filter((x): x is J => x !== null);
			added.forEach((a, i) => {
				origins.set(a.id, { ti, ki: survivors.length + i, rate: TICKS });
			});
			stack.children = [...survivors, ...added.map((a) => a.track)];
			if (!base || base.bookmarks.get(sc.id) !== json(sc.bookmarks ?? [])) {
				const others = (Array.isArray(stack.markers) ? stack.markers : []).filter((mk: J) => !ownMarker(mk));
				stack.markers = [...others, ...((sc.bookmarks ?? []) as J[]).map((b) => {
					const { time, ...rest } = b;
					return { OTIO_SCHEMA: "Marker.2", name: typeof b.note === "string" ? b.note : "", marked_range: tr(time, b.duration ?? 0, TICKS), color: "RED", comment: "", metadata: { opencut: { bookmark: rest } } };
				})];
			}
		}
		if (!base || json(p.settings ?? null) !== base.settings) raw.metadata = { ...(raw.metadata ?? {}), opencut: { ...(raw.metadata?.opencut ?? {}), settings: p.settings } };
		return raw;
	}

	/** A Cut track as an OTIO track's children: untouched clips and gaps as their own bytes, the rest written at `rate` when exact, else in ticks. */
	private trackChildren(t: J, was: J[], rate: number, mediaById: Map<string, CutMedia>, clips: Map<string, J>): J[] {
		const gaps: Array<{ at: number; dur: number; raw: J }> = [];
		let at = 0;
		for (const c of was) {
			const dur = toTicks(c.source_range.duration.value, c.source_range.duration.rate) ?? 0;
			if (c.OTIO_SCHEMA === "Gap.1") gaps.push({ at, dur, raw: c });
			at += dur;
		}
		const baseEls = new Map((this.base?.tracks.get(t.id) ?? []).map((s) => { const e = JSON.parse(s); return [e.id as string, s]; }));
		const els = [...(t.elements as J[])].sort((a, b) => a.startTime - b.startTime);
		const out: J[] = [];
		at = 0;
		let last: J | null = null;
		for (const e of els) {
			this.checkCarried(e, t, mediaById);
			if (e.startTime < at) throw new CutSaveRefusal("overlap-not-carried", `"${last?.name}" and "${e.name}" overlap on ${t.name}; a track of this file is a sequence, so one of them must move`);
			if (e.startTime > at) {
				const g = e.startTime - at;
				const same = gaps.find((x) => x.at === at && x.dur === g);
				out.push(same ? same.raw : { OTIO_SCHEMA: "Gap.1", name: "", source_range: timeRange(0, g, rate), effects: [], markers: [], enabled: true, metadata: {} });
			}
			const before = this.clipOf.get(e.id);
			const c = before && baseEls.get(e.id) === json(e) ? before : this.clip(e, before, rate, mediaById);
			clips.set(e.id, c);
			out.push(c);
			at = e.startTime + e.duration;
			last = e;
		}
		return out;
	}

	private checkCarried(e: J, t: J, mediaById: Map<string, CutMedia>): void {
		if (e.type === "audio" && e.sourceType === "library") throw new CutSaveRefusal("library-sound-off", `the library sound "${e.name}" comes from Freesound, which is off in OneOS; a sound is used only once it is a OneOS file`);
		if (e.type !== "video" && e.type !== "image" && e.type !== "audio") throw new CutSaveRefusal("element-not-carried", `the ${e.type} "${e.name}" on ${t.name} has no place in this file's tracks, which hold clips of OneOS media (a ${e.type} is kept in a Cut project)`);
		const m = mediaById.get(e.mediaId);
		if (!m || !m.file || !parseMediaUrl(`oneos:file/${m.file.id}?version=${m.file.version}`)) throw new CutSaveRefusal("media-not-referenced", `the medium ${m?.name ?? e.mediaId} of "${e.name}" is not a OneOS file and version; put it in Files and insert it from there`);
	}

	private clip(e: J, before: J | undefined, trackRate: number, mediaById: Map<string, CutMedia>): J {
		const m = mediaById.get(e.mediaId)!;
		const url = mediaUrl(m.file.id, m.file.version);
		const rate = before ? before.source_range.duration.rate : trackRate;
		const range = timeRange(e.trimStart, e.duration, rate);
		const look = extrasOf(e);
		if (e.type === "audio") delete look.sourceType;
		if (before) {
			const c = clone(before);
			c.name = e.name;
			c.source_range = range;
			c.media_references.DEFAULT_MEDIA.target_url = url;
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
const switchesOf = (t: J) => (t.type === "audio" ? { muted: t.muted === true } : { muted: t.muted === true, hidden: t.hidden === true });

/** Why a track `otio.ts` finds editable is still not one Cut may REWRITE without loss (null: it may). */
function carriedLock(t: J): string | null {
	if (t.enabled === false) return "it is switched off, which Cut has no switch for";
	if (t.source_range !== null && t.source_range !== undefined) return "it is trimmed as a whole, which Cut does not show";
	for (const c of t.children as J[]) {
		const r = c.source_range;
		if (toTicks(r.start_time.value, r.start_time.rate) === null || toTicks(r.duration.value, r.duration.rate) === null) return `${c.OTIO_SCHEMA} "${c.name ?? ""}" has times that are not whole ticks of Cut's clock (${TICKS}/s)`;
		if (c.enabled === false) return `${c.OTIO_SCHEMA} "${c.name ?? ""}" is switched off, which Cut has no switch for`;
		if (c.OTIO_SCHEMA === "Gap.1" && ((typeof c.name === "string" && c.name) || (isObj(c.metadata) && Object.keys(c.metadata).length))) return "a gap carries data of its own, which a rewrite of the track would not keep";
	}
	return null;
}
