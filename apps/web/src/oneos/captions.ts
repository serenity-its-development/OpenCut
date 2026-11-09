/**
 * Captions in the ONE video project file (OneOS doctrine files/989; Mona 2026-11-10: "Caption track in the .otio").
 *
 * A caption track is written as Film writes it (filmcraft `crates/interchange/src/otio.rs` `caption_track_json`), by both tools: a
 * `Track.1` (kind Video) of `Clip.2`s placed by `Gap.1`s, each clip's one medium a `GeneratorReference.1` of kind `FilmCraft.caption`, the
 * clip named by its text and carrying its caption under `metadata.filmcraft.caption` (text, speaker, WebVTT cue id and settings), the track
 * carrying its format, language, style, switches and WebVTT header blocks under `metadata.filmcraft.caption_track`. Any OTIO tool sees timed
 * captions.
 *
 * In Cut it is a caption track (`CaptionTrack`, timeline/types.ts): each caption a text element whose content is its text, drawn in the
 * track's ONE style. A caption's look is DERIVED from that style (`captionLook`); a change Cut makes to the look of every caption alike is the
 * style's (`styleOf`), written as Film's own value; a caption whose look is its own (a different font, a move, an effect, an animation) has
 * no place in Film's track and is refused at save, by name (`caption-look-not-in-film`). Where Cut draws differently from Film: Cut has no
 * outline (Film's outline is kept, not drawn), Cut places the block from its line count (Film measures the wrapped text), and markup in a
 * caption's text (`<i>`) is shown as written.
 * Pure: no DOM, no storage, no network.
 */
import type { CaptionStyle, CaptionTrackData } from "@/timeline/types";

type J = Record<string, any>;

/** The generator kind of a caption's clip. */
export const CAPTION_KIND = "FilmCraft.caption";
/** Cut's clock (ticks per second). */
const TICKS = 120_000;

/** Film's default caption style (filmcraft `CaptionStyle::default`). */
export const FILM_CAPTION_STYLE: CaptionStyle = {
	font: "Inter",
	size: 54,
	color: [255, 255, 255, 255],
	background: true,
	background_color: [0, 0, 0, 191],
	align: "Center",
	anchor: "Bottom",
	margin: 0.08,
	line_spacing: 1.25,
	outline: 0,
	outline_color: [0, 0, 0, 255],
	font_style: "SemiBold",
};

/** A new caption track's data, as Film makes one (`CaptionTrack::new`: Subtitle, English, Film's style, on, sync-locked). */
export function newCaptionTrackData(): CaptionTrackData {
	return { format: "Subtitle", language: "en", style: clone(FILM_CAPTION_STYLE), locked: false, sync_lock: true, vtt_blocks: [] };
}

/** Cut's text background defaults (timeline/defaults.ts `defaultTextBackground`; the editor tests pin that they agree). */
export const TEXT_BACKGROUND = { enabled: false, color: "#000000", cornerRadius: 0, paddingX: 30, paddingY: 42, offsetX: 0, offsetY: 0 };
/** Cut's text size reference (text/typography.ts `FONT_SIZE_SCALE_REFERENCE`): a text's pixels are `fontSize · height / 90`. */
const FONT_SIZE_REFERENCE = 90;
/** Film's caption size is in pixels of a 1080-line frame. */
const FILM_LINES = 1080;
/** Where a left or right aligned caption starts, from the frame's centre, as a fraction of its width (Cut's subtitles fill 80%). */
const SIDE = 0.4;

const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const byte = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
/** An sRGB + alpha colour as Cut writes a colour: `#rrggbb`, or `#rrggbbaa` when not opaque. */
export const hexOf = (c: number[]) => `#${byte(c[0])}${byte(c[1])}${byte(c[2])}${c[3] === 255 ? "" : byte(c[3])}`;
/** `#rrggbb` or `#rrggbbaa` as sRGB + alpha, or null. */
export function rgbaOf(s: unknown): [number, number, number, number] | null {
	const m = typeof s === "string" ? /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s) : null;
	if (!m) return null;
	const n = (i: number) => Number.parseInt(m[1].slice(i, i + 2), 16);
	return [n(0), n(2), n(4), m[2] ? Number.parseInt(m[2], 16) : 255];
}
const BOLD = /bold|black|heavy/i;
const ITALIC = /italic|oblique/i;

/** The look of a caption of `content` in `style` on a canvas of `canvas` pixels: Cut's text fields, as Film draws it. */
export function captionLook(style: CaptionStyle, content: string, canvas: { width: number; height: number }): J {
	const { width: w, height: h } = canvas;
	const lines = content.split("\n").length;
	const block = lines * style.line_spacing * ((style.size * h) / FILM_LINES);
	const y = style.anchor === "Top" ? -h / 2 + style.margin * h + block / 2 : style.anchor === "Middle" ? 0 : h / 2 - style.margin * h - block / 2;
	const x = style.align === "Left" ? -w * SIDE : style.align === "Right" ? w * SIDE : 0;
	return {
		fontFamily: style.font,
		fontSize: (style.size * FONT_SIZE_REFERENCE) / FILM_LINES,
		color: hexOf(style.color),
		textAlign: style.align.toLowerCase(),
		fontWeight: BOLD.test(style.font_style) ? "bold" : "normal",
		fontStyle: ITALIC.test(style.font_style) ? "italic" : "normal",
		textDecoration: "none",
		letterSpacing: 0,
		lineHeight: style.line_spacing,
		background: { ...TEXT_BACKGROUND, enabled: style.background, color: hexOf(style.background_color) },
		transform: { scaleX: 1, scaleY: 1, position: { x, y }, rotate: 0 },
		opacity: 1,
	};
}

/** An element's fields that are not its look: its place, its text, its caption data (a caption's name is its text). */
const CORE = new Set(["id", "type", "name", "content", "startTime", "duration", "trimStart", "trimEnd", "sourceDuration", "caption"]);

const near = (a: unknown, b: unknown): boolean => {
	if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => near(x, b[i]));
	if (isObj(a) && isObj(b)) {
		const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
		return [...ks].every((k) => near(a[k], b[k]));
	}
	return a === b;
};

/**
 * The style the captions' looks say: each field Cut draws, read from the captions where ALL of them say the same and it is not the style's own (a field whose
 * look is still the style's stays exactly the style's, so Film's own values come back unchanged). A colour Cut cannot hold is named.
 */
export function styleOf(style: CaptionStyle, els: J[], canvas: { width: number; height: number }): CaptionStyle | string {
	const s = clone(style);
	const e = els[0];
	if (!e) return s;
	const was = captionLook(style, typeof e.content === "string" ? e.content : "", canvas);
	// A field is the style's only when every caption says the same (else the caption that differs is named, at its own look).
	const agree = (f: (x: J) => unknown) => els.every((x) => near(f(x), f(e)));
	if (e.fontFamily !== was.fontFamily && agree((x) => x.fontFamily) && typeof e.fontFamily === "string") s.font = e.fontFamily;
	if (!near(e.fontSize, was.fontSize) && agree((x) => x.fontSize) && typeof e.fontSize === "number") s.size = (e.fontSize * FILM_LINES) / FONT_SIZE_REFERENCE;
	if (e.color !== was.color && agree((x) => x.color)) {
		const c = rgbaOf(e.color);
		if (!c) return `its colour ${String(e.color)} is not one Film's caption style holds (#rrggbb or #rrggbbaa)`;
		s.color = c;
	}
	if (e.textAlign !== was.textAlign && agree((x) => x.textAlign) && ["left", "center", "right"].includes(e.textAlign)) s.align = (e.textAlign[0].toUpperCase() + e.textAlign.slice(1)) as CaptionStyle["align"];
	if ((e.fontWeight !== was.fontWeight || e.fontStyle !== was.fontStyle) && agree((x) => [x.fontWeight, x.fontStyle])) {
		const bold = e.fontWeight === "bold", italic = e.fontStyle === "italic";
		s.font_style = bold && italic ? "Bold Italic" : bold ? "Bold" : italic ? "Italic" : "Regular";
	}
	if (!near(e.lineHeight, was.lineHeight) && agree((x) => x.lineHeight) && typeof e.lineHeight === "number") s.line_spacing = e.lineHeight;
	if (isObj(e.background)) {
		if (e.background.enabled !== was.background.enabled && agree((x) => x.background?.enabled)) s.background = e.background.enabled === true;
		if (e.background.color !== was.background.color && agree((x) => x.background?.color)) {
			const c = rgbaOf(e.background.color);
			if (!c) return `its background colour ${String(e.background.color)} is not one Film's caption style holds (#rrggbb or #rrggbbaa)`;
			s.background_color = c;
		}
	}
	return s;
}

/** Why the caption `e` is not drawn in `style` (a look of its own Film's track cannot hold), or null. */
export function ownLook(e: J, style: CaptionStyle, canvas: { width: number; height: number }): string | null {
	const want = captionLook(style, typeof e.content === "string" ? e.content : "", canvas);
	for (const k of new Set([...Object.keys(e), ...Object.keys(want)])) {
		if (CORE.has(k) || k === "link") continue;
		if (k === "hidden" && e.hidden !== true) continue;
		if (k === "effects" && Array.isArray(e.effects) && !e.effects.length) continue;
		if (k === "blendMode" && (e.blendMode === undefined || e.blendMode === "normal")) continue;
		if (k === "animations" && (e.animations === undefined || (isObj(e.animations) && !Object.keys(e.animations).length))) continue;
		if (!near(e[k], want[k])) return k;
	}
	return null;
}

/** OTIO time -> Cut ticks, or null when it is not a whole number of ticks. */
function toTicks(t: unknown): number | null {
	if (!isObj(t) || typeof t.value !== "number" || !(typeof t.rate === "number" && t.rate > 0)) return null;
	const v = (t.value * TICKS) / t.rate;
	const r = Math.round(v);
	return Math.abs(v - r) < 1e-6 ? r : null;
}
/** Cut ticks -> OTIO time at `rate` when whole there, else in Cut's ticks. */
function timeRange(start: number, dur: number, rate: number): J {
	const at = (ticks: number, r: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate: r, value: (ticks * r) / TICKS });
	const whole = (ticks: number) => Math.abs((ticks * rate) / TICKS - Math.round((ticks * rate) / TICKS)) < 1e-9;
	const r = whole(start) && whole(dur) ? rate : TICKS;
	return { OTIO_SCHEMA: "TimeRange.1", start_time: at(start, r), duration: at(dur, r) };
}

/** Whether an OTIO track is a caption track. */
export function isCaptionTrack(t: unknown): boolean {
	return isObj(t) && t.OTIO_SCHEMA === "Track.1" && isObj(t.metadata?.filmcraft?.caption_track);
}

/** A caption track as Cut holds it, read from the file's `t` (ids `<trackId>-i<n>`), or why Cut cannot edit it. */
export function readCaptionTrack(t: J, trackId: string, canvas: { width: number; height: number }, ids?: (clip: J, n: number) => string): { track: J; clips: Map<string, J> } | string {
	const d = t.metadata.filmcraft.caption_track as J;
	if ((Array.isArray(t.effects) && t.effects.length) || (Array.isArray(t.markers) && t.markers.length)) return "it has effects or markers of its own";
	if (t.source_range !== null && t.source_range !== undefined) return "it is trimmed as a whole, which Cut does not show";
	if (typeof d.format !== "string" || (d.style !== undefined && !isObj(d.style))) return "its caption format or style is not one Film writes";
	const style: CaptionStyle = { ...clone(FILM_CAPTION_STYLE), ...(isObj(d.style) ? clone(d.style) : {}) };
	const data: CaptionTrackData = { ...clone(d), style } as CaptionTrackData;
	const elements: J[] = [];
	const clips = new Map<string, J>();
	let at = 0;
	let n = 0;
	for (const c of Array.isArray(t.children) ? (t.children as J[]) : []) {
		const dur = toTicks(c?.source_range?.duration);
		if (dur === null) return `${String(c?.OTIO_SCHEMA)} "${String(c?.name ?? "")}" has times that are not whole ticks of Cut's clock (${TICKS}/s)`;
		if (c.OTIO_SCHEMA === "Gap.1") { at += dur; continue; }
		const cap = c.metadata?.filmcraft?.caption;
		if (c.OTIO_SCHEMA !== "Clip.2" || c.media_references?.DEFAULT_MEDIA?.generator_kind !== CAPTION_KIND || !isObj(cap) || typeof cap.text !== "string") return `it holds a ${String(c.OTIO_SCHEMA)} "${String(c.name ?? "")}" that is not a caption`;
		if (c.enabled === false) return `the caption "${cap.text}" is switched off, which Cut has no switch for`;
		const id = ids ? ids(c, n) : `${trackId}-i${n}`;
		n += 1;
		clips.set(id, clone(c));
		elements.push({
			id, type: "text", name: cap.text, content: cap.text, startTime: at, duration: dur, trimStart: 0, trimEnd: 0,
			caption: { speaker: typeof cap.speaker === "string" ? cap.speaker : null, cue_id: typeof cap.cue_id === "string" ? cap.cue_id : null, settings: typeof cap.settings === "string" ? cap.settings : "" },
			...captionLook(style, cap.text, canvas),
		});
		at += dur;
	}
	const name = typeof t.name === "string" ? t.name : "Captions";
	return { track: { id: trackId, name, type: "caption", hidden: t.enabled === false, elements, caption: data }, clips };
}

/** Why a caption track cannot be written in Film's shape (`caption-look-not-in-film`, `caption-overlap`). */
export class CaptionRefusal extends Error {
	readonly code: "caption-look-not-in-film" | "caption-overlap";
	constructor(code: CaptionRefusal["code"], reason: string) {
		super(`${code}: ${reason}`);
		this.code = code;
	}
}

/**
 * The Cut caption track `t` in Film's shape. `before`: the track as the file held it (its other keys and its clips' other keys are kept, and
 * an unchanged caption is its own bytes); `rate`: the rate its times are written at when whole there (else Cut's ticks). `own`: Cut's data to
 * put beside Film's on the track and on each clip (in a Cut project: the track's and each element's id). Throws `CaptionRefusal`.
 */
export function writeCaptionTrack(t: J, before: J | null, rate: number, canvas: { width: number; height: number }, priors: Map<string, J>, own?: { track: J; element: (e: J) => J }): J {
	const els = [...(t.elements as J[])].sort((a, b) => a.startTime - b.startTime);
	const style = styleOf(t.caption.style, els, canvas);
	if (typeof style === "string") throw new CaptionRefusal("caption-look-not-in-film", `the caption "${els[0]?.content ?? ""}" on "${t.name}": ${style}`);
	for (const e of els) {
		const k = ownLook(e, style, canvas);
		if (k) throw new CaptionRefusal("caption-look-not-in-film", `the caption "${e.content}" on "${t.name}" has a look of its own (${k}); Film's caption track draws every caption in its one style`);
	}
	for (let i = 1; i < els.length; i++) {
		if (els[i - 1].startTime + els[i - 1].duration > els[i].startTime) throw new CaptionRefusal("caption-overlap", `the captions "${els[i - 1].content}" and "${els[i].content}" on "${t.name}" overlap; a caption track holds one caption at a time`);
	}
	const children: J[] = [];
	let at = 0;
	for (const e of els) {
		if (e.startTime > at) children.push({ OTIO_SCHEMA: "Gap.1", name: "", source_range: timeRange(0, e.startTime - at, rate), effects: [], markers: [], enabled: true, metadata: {} });
		const cue = isObj(e.caption) ? e.caption : { speaker: null, cue_id: null, settings: "" };
		const caption = { text: e.content, speaker: cue.speaker ?? null, cue_id: cue.cue_id ?? null, settings: cue.settings ?? "" };
		const prior = priors.get(e.id);
		const fresh: J = {
			OTIO_SCHEMA: "Clip.2", name: e.content, source_range: timeRange(0, e.duration, rate), effects: [], markers: [], enabled: true,
			media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: "GeneratorReference.1", name: "", generator_kind: CAPTION_KIND, parameters: {}, available_range: null, metadata: {} } },
			active_media_reference_key: "DEFAULT_MEDIA",
			metadata: { filmcraft: { caption } },
		};
		let clip = fresh;
		if (prior) {
			const same = toTicks(prior.source_range?.duration) === e.duration && toTicks(prior.source_range?.start_time) === 0 && prior.name === e.content && near(prior.metadata?.filmcraft?.caption, caption);
			clip = same ? clone(prior) : { ...clone(prior), name: e.content, source_range: timeRange(0, e.duration, prior.source_range?.duration?.rate ?? rate), metadata: { ...clone(prior.metadata ?? {}), filmcraft: { ...clone(prior.metadata?.filmcraft ?? {}), caption } } };
		}
		if (own) clip.metadata = { ...clip.metadata, opencut: { ...(clip.metadata.opencut ?? {}), element: own.element(e) } };
		children.push(clip);
		at = e.startTime + e.duration;
	}
	const data = { ...clone(t.caption), style };
	const metadata = { ...clone(before?.metadata ?? {}), filmcraft: { ...clone(before?.metadata?.filmcraft ?? {}), caption_track: data } };
	if (own) metadata.opencut = { ...(metadata.opencut ?? {}), ...own.track };
	const out: J = before ? clone(before) : { OTIO_SCHEMA: "Track.1", name: t.name, kind: "Video", children: [], source_range: null, effects: [], markers: [], enabled: true, metadata: {} };
	// An unchanged gap is its own bytes (its rate kept).
	const gaps = new Map<string, J>();
	let pos = 0;
	for (const c of Array.isArray(before?.children) ? (before.children as J[]) : []) {
		const d = toTicks(c?.source_range?.duration) ?? 0;
		if (c?.OTIO_SCHEMA === "Gap.1") gaps.set(`${pos}:${d}`, c);
		pos += d;
	}
	pos = 0;
	out.children = children.map((c) => {
		const d = toTicks(c.source_range.duration) ?? 0;
		const kept = c.OTIO_SCHEMA === "Gap.1" ? gaps.get(`${pos}:${d}`) : undefined;
		pos += d;
		return kept ? clone(kept) : c;
	});
	out.name = t.name;
	out.enabled = t.hidden !== true;
	out.metadata = metadata;
	return out;
}

/** A cue (an SRT's, or any timed text) as a caption on a caption track drawn in `style`: a text element named by its text. */
export function buildCaptionElement({ caption, style, canvasSize }: { caption: { text: string; startTime: number; duration: number }; style: CaptionStyle; canvasSize: { width: number; height: number } }): J {
	const text = caption.text.trim().replace(/\r\n/g, "\n");
	return {
		type: "text", name: text, content: text,
		startTime: Math.round(caption.startTime * TICKS), duration: Math.round(caption.duration * TICKS), trimStart: 0, trimEnd: 0,
		caption: { speaker: null, cue_id: null, settings: "" },
		...captionLook(style, text, canvasSize),
	};
}
