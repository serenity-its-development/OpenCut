// A MAXIMAL Cut project, built by the EDITOR ITSELF (OneOS, files/989): every element comes from the editor's own builders, every effect from
// its effect registry, every mask from its mask registry (one of each type), every graphic from its graphics registry (one of each shape),
// and the keyframes from its animation code (a property, a graphic's param and an effect's param). It is typed against the editor's own
// types (`SerializedProject`, `TimelineElement`, `Mask`, `Effect` ...), so `tsc -p oneos-tests/tsconfig.json` fails on a field the editor
// does not have. (Measured 2026-11-09: the hand-written fixture before it invented an effect "colorCorrect", a blur "radius", masks with
// "points" and keyframes as `{opacity: {keyframes}}`; Cut has ONE effect, blur, with `intensity`.) The ids the builders draw at random are
// renamed in order of appearance, so the project is the same every run. The fixture the codec and the session tests share.
import { register } from "node:module";
import type { SerializedProject, SerializedScene } from "../src/services/storage/types.ts";
import type { AudioTrack, EffectTrack, GraphicTrack, TextTrack, TimelineElement, VideoTrack } from "../src/timeline/types.ts";
import type { AnimationPath, AnimationValue } from "../src/animation/types.ts";
import type { MediaTime } from "../src/wasm/media-time.ts";
import type { CutMedia } from "../src/oneos/cut-otio.ts";

register("./alias-hooks.mjs", import.meta.url);
const { TICKS } = await import("../src/oneos/cut-otio.ts");
const { mediaTime } = await import("../src/wasm/media-time.ts");
const { buildTextElement, buildStickerElement, buildGraphicElement, buildEffectElement, buildElementFromMedia } = await import("../src/timeline/element-utils.ts");
const { effectsRegistry, buildDefaultEffectInstance } = await import("../src/effects/index.ts");
const { registerDefaultEffects } = await import("../src/effects/definitions/index.ts");
const { masksRegistry, buildDefaultMaskInstance, registerDefaultMasks } = await import("../src/masks/index.ts");
const { graphicsRegistry, registerDefaultGraphics } = await import("../src/graphics/index.ts");
const { buildEffectParamPath, buildGraphicParamPath, upsertPathKeyframe } = await import("../src/animation/index.ts");
const { resolveAnimationTarget } = await import("../src/timeline/animation-targets.ts");
registerDefaultEffects();
registerDefaultMasks();
registerDefaultGraphics();

export const F1 = "01jabcdefghjkmnpqrstvwxyz0", F2 = "01jabcdefghjkmnpqrstvwxyz1", F3 = "01jabcdefghjkmnpqrstvwxyz2";
export const s = (sec: number): MediaTime => mediaTime({ ticks: Math.round(sec * TICKS) });
/** The editor's own shape of a transform. */
export const transform = { scaleX: 1.25, scaleY: 1.25, position: { x: 12, y: -4 }, rotate: 7.5 };

/** Every effect the editor has, by its registry (measured: blur alone). */
export const EFFECT_TYPES: string[] = effectsRegistry.getAll().map((d) => d.type);
/** Every mask type the editor has, by its registry. */
export const MASK_TYPES: string[] = masksRegistry.getAll().map((d) => d.type);
/** Every graphic (shape) the editor has, by its registry. */
export const GRAPHIC_IDS: string[] = graphicsRegistry.getAll().map((d) => d.id);

type El<T extends TimelineElement["type"]> = Extract<TimelineElement, { type: T }>;

/** A keyframe as the editor sets one (its own target: kind, default interpolation, coercion). */
function key<E extends TimelineElement>(el: E, path: AnimationPath, ticks: MediaTime, value: AnimationValue): E {
	const target = resolveAnimationTarget({ element: el, path });
	if (!target) throw new Error(`the editor cannot animate ${path} on a ${el.type}`);
	const animations = upsertPathKeyframe({ animations: el.animations, propertyPath: path, time: ticks, value, kind: target.kind, defaultInterpolation: target.defaultInterpolation, coerceValue: target.coerceValue });
	return { ...el, animations };
}

function scene(id: string, isMain: boolean): SerializedScene {
	const effects = EFFECT_TYPES.map((effectType) => buildDefaultEffectInstance({ effectType }));
	const masks = MASK_TYPES.map((maskType) => buildDefaultMaskInstance({ maskType: maskType as never, elementSize: { width: 1920, height: 1080 } }));
	let beach = { ...buildElementFromMedia({ mediaId: "m-video", mediaType: "video", name: "Beach", duration: s(5), startTime: s(0) }), id: "v1" } as El<"video">;
	beach = { ...beach, trimStart: s(1), trimEnd: s(2), sourceDuration: s(8), volume: 0.7, retime: { rate: 1.5, maintainPitch: true }, transform, opacity: 0.9, blendMode: "screen", effects, masks };
	beach = key(beach, "opacity", s(0), 0);
	beach = key(beach, "opacity", s(1), 1);
	beach = key(beach, "transform.positionX", s(2), 40);
	beach = key(beach, "volume", s(3), 0.2);
	beach = key(beach, buildEffectParamPath({ effectId: effects[0].id, paramKey: "intensity" }), s(1), 40);
	const logo = { ...buildElementFromMedia({ mediaId: "m-image", mediaType: "image", name: "Logo", duration: s(3), startTime: s(7) }), id: "i1" } as El<"image">;
	let title = { ...buildTextElement({ raw: { name: "Title", content: "Hello 日本語", fontSize: 64, fontFamily: "Inter", color: "#ffffff", background: { enabled: true, color: "#00000080", cornerRadius: 8, paddingX: 4, paddingY: 2, offsetX: 0, offsetY: 0 }, textAlign: "center", fontWeight: "bold", fontStyle: "italic", textDecoration: "underline", letterSpacing: 1, lineHeight: 1.2, transform, duration: s(2) }, startTime: s(1) }), id: "t1" } as El<"text">;
	title = { ...title, effects: EFFECT_TYPES.map((effectType) => buildDefaultEffectInstance({ effectType })) };
	title = key(title, "opacity", s(0), 0);
	title = key(title, "color", s(1), "#ff0000");
	const star = { ...buildStickerElement({ stickerId: "shapes:star", name: "Star", startTime: s(0) }), id: "g1", duration: s(1), opacity: 0.5, transform } as El<"sticker">;
	const graphics = GRAPHIC_IDS.map((definitionId, i) => {
		let g = { ...buildGraphicElement({ definitionId, startTime: s(2 + i * 2) }), id: `g${i + 2}`, duration: s(2), transform } as El<"graphic">;
		if (i === 0) {
			const param = Object.keys(g.params).find((k) => typeof g.params[k] === "number");
			if (param) g = key(g, buildGraphicParamPath({ paramKey: param }), s(1), 0.5);
			g = { ...g, masks: [buildDefaultMaskInstance({ maskType: "ellipse", elementSize: { width: 500, height: 500 } })] };
		}
		return g;
	});
	const grade = { ...buildEffectElement({ effectType: EFFECT_TYPES[0], startTime: s(0), duration: s(10) }), id: "e1", name: "Grade" } as El<"effect">;
	const song = { ...buildElementFromMedia({ mediaId: "m-audio", mediaType: "audio", name: "Song", duration: s(9), startTime: s(0.5) }), id: "a1", volume: 0.4, retime: { rate: 0.9 }, trimStart: s(3), trimEnd: s(0), sourceDuration: s(180) } as El<"audio">;
	const main: VideoTrack = { id: `${id}-main`, name: "Main", type: "video", muted: false, hidden: false, elements: [beach, logo] };
	const text: TextTrack = { id: `${id}-text`, name: "Titles", type: "text", hidden: false, elements: [title] };
	const gfx: GraphicTrack = { id: `${id}-gfx`, name: "Graphics", type: "graphic", hidden: true, elements: [star, ...graphics] };
	const fx: EffectTrack = { id: `${id}-fx`, name: "Adjust", type: "effect", hidden: false, elements: [grade] };
	const audio: AudioTrack = { id: `${id}-a1`, name: "Music", type: "audio", muted: true, elements: [song] };
	return {
		id, name: isMain ? "Main" : "B-roll", isMain, createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T01:00:00.000Z",
		bookmarks: [{ time: s(2), note: "Cut here", color: "#ff0000", duration: s(1) }, { time: s(9) }],
		tracks: { main, overlay: [text, gfx, fx], audio: [audio] },
	};
}

export interface CutFixture { project: SerializedProject; media: CutMedia[] }

/** The ids the builders drew at random (effects, masks, keyframes, channels), renamed in order of appearance: the same project every run. */
function steadyIds<T>(v: T): T {
	const seen = new Map<string, string>();
	const text = JSON.stringify(v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (u) => {
		if (!seen.has(u)) seen.set(u, `id-${String(seen.size + 1).padStart(3, "0")}`);
		return seen.get(u) as string;
	});
	return JSON.parse(text);
}

const BUILT: CutFixture = steadyIds<CutFixture>({
	project: {
		metadata: { id: "p1", name: "Trip", thumbnail: "data:image/png;base64,AAAA", duration: s(10), createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T02:00:00.000Z" },
		scenes: [scene("s1", true), scene("s2", false)],
		currentSceneId: "s2",
		settings: { fps: { numerator: 30000, denominator: 1001 }, canvasSize: { width: 1080, height: 1920 }, canvasSizeMode: "custom", lastCustomCanvasSize: { width: 1080, height: 1920 }, originalCanvasSize: null, background: { type: "blur", blurIntensity: 12 } },
		version: 23,
		timelineViewState: { zoomLevel: 2.5, scrollLeft: 340, playheadTime: s(3) },
	},
	media: [
		{ id: "m-video", name: "beach.mp4", type: "video", file: { id: F1, version: "v3" }, width: 1920, height: 1080, duration: 8, fps: 30, hasAudio: true },
		{ id: "m-image", name: "logo.png", type: "image", file: { id: F2, version: "v1" }, width: 512, height: 512 },
		{ id: "m-audio", name: "song.wav", type: "audio", file: { id: F3, version: "v9" }, duration: 180 },
	],
});

/** A fresh copy of the maximal project (plain JSON, as the editor stores it). */
export function maximal(): { project: Record<string, any>; media: CutMedia[] } {
	return JSON.parse(JSON.stringify(BUILT));
}
