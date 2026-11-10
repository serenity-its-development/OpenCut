import type { ElementAnimations } from "@/animation/types";
import type { Effect } from "@/effects/types";
import type { Mask } from "@/masks/types";
import type { ParamValues } from "@/params";
import type { BlendMode, Transform } from "@/rendering";
import type { MediaTime } from "@/wasm";

export type ElementRef = {
	trackId: string;
	elementId: string;
};

export interface Bookmark {
	time: MediaTime;
	note?: string;
	color?: string;
	duration?: MediaTime;
}

export interface TScene {
	id: string;
	name: string;
	isMain: boolean;
	tracks: SceneTracks;
	bookmarks: Bookmark[];
	createdAt: Date;
	updatedAt: Date;
}

export type TrackType = "video" | "text" | "audio" | "graphic" | "effect" | "caption";

interface BaseTrack {
	id: string;
	name: string;
}

export interface VideoTrack extends BaseTrack {
	type: "video";
	elements: (VideoElement | ImageElement)[];
	muted: boolean;
	hidden: boolean;
}

export interface TextTrack extends BaseTrack {
	type: "text";
	elements: TextElement[];
	hidden: boolean;
}

/**
 * OneOS (files/989, Mona 2026-11-10: "Caption track in the .otio"): a caption track, as Film keeps one (`metadata.filmcraft.caption_track` in
 * the .otio): its captions are text elements drawn in the track's ONE style (`oneos/captions.ts` derives each caption's look from it), each
 * caption's text is its content. Its data is Film's, in Film's names, so both tools edit the same values.
 */
export interface CaptionTrack extends BaseTrack {
	type: "caption";
	elements: TextElement[];
	hidden: boolean;
	caption: CaptionTrackData;
}

/** Film's caption track data (filmcraft `project/src/caption.rs` `CaptionTrack`, less its captions and switches Cut holds itself). */
export interface CaptionTrackData {
	format: string;
	language: string;
	style: CaptionStyle;
	locked: boolean;
	sync_lock: boolean;
	vtt_blocks: string[];
}

/** Film's caption style (filmcraft `CaptionStyle`): sizes in pixels of a 1080-line frame, colours sRGB + alpha. */
export interface CaptionStyle {
	font: string;
	size: number;
	color: [number, number, number, number];
	background: boolean;
	background_color: [number, number, number, number];
	align: "Left" | "Center" | "Right";
	anchor: "Top" | "Middle" | "Bottom";
	margin: number;
	line_spacing: number;
	outline: number;
	outline_color: [number, number, number, number];
	font_style: string;
}

/** A caption's own data beside its text (Film's `Caption`): the speaker, the WebVTT cue id and cue settings. */
export interface CaptionCue {
	speaker: string | null;
	cue_id: string | null;
	settings: string;
}

export interface AudioTrack extends BaseTrack {
	type: "audio";
	elements: AudioElement[];
	muted: boolean;
}

export interface GraphicTrack extends BaseTrack {
	type: "graphic";
	elements: (StickerElement | GraphicElement)[];
	hidden: boolean;
}

export interface EffectTrack extends BaseTrack {
	type: "effect";
	elements: EffectElement[];
	hidden: boolean;
}

export type TimelineTrack =
	| VideoTrack
	| TextTrack
	| AudioTrack
	| GraphicTrack
	| EffectTrack
	| CaptionTrack;

export type OverlayTrack = VideoTrack | TextTrack | GraphicTrack | EffectTrack | CaptionTrack;

export interface SceneTracks {
	overlay: OverlayTrack[];
	main: VideoTrack;
	audio: AudioTrack[];
}

export interface RetimeConfig {
	rate: number;
	maintainPitch?: boolean;
	/** OneOS (files/989, 2c): the clip shows its source span backwards, as Film's reverse does. */
	reverse?: boolean;
}

interface BaseAudioElement extends BaseTimelineElement {
	type: "audio";
	volume: number;
	muted?: boolean;
	buffer?: AudioBuffer;
	retime?: RetimeConfig;
}

export interface UploadAudioElement extends BaseAudioElement {
	sourceType: "upload";
	mediaId: string;
}

export interface LibraryAudioElement extends BaseAudioElement {
	sourceType: "library";
	sourceUrl: string;
}

export type AudioElement = UploadAudioElement | LibraryAudioElement;

interface BaseTimelineElement {
	id: string;
	name: string;
	duration: MediaTime;
	startTime: MediaTime;
	trimStart: MediaTime;
	trimEnd: MediaTime;
	sourceDuration?: MediaTime;
	animations?: ElementAnimations;
	/** OneOS (files/989): elements sharing this label are linked (a clip's picture and its sound), edited as one (`timeline/linked.ts`). */
	link?: string;
}

export interface VideoElement extends BaseTimelineElement {
	type: "video";
	mediaId: string;
	volume?: number;
	muted?: boolean;
	isSourceAudioEnabled?: boolean;
	hidden?: boolean;
	retime?: RetimeConfig;
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
	effects?: Effect[];
	masks?: Mask[];
}

export interface ImageElement extends BaseTimelineElement {
	type: "image";
	mediaId: string;
	hidden?: boolean;
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
	effects?: Effect[];
	masks?: Mask[];
}

export interface TextBackground {
	enabled: boolean;
	color: string;
	cornerRadius?: number;
	paddingX?: number;
	paddingY?: number;
	offsetX?: number;
	offsetY?: number;
}

export interface TextElement extends BaseTimelineElement {
	type: "text";
	content: string;
	fontSize: number;
	fontFamily: string;
	color: string;
	background: TextBackground;
	textAlign: "left" | "center" | "right";
	fontWeight: "normal" | "bold";
	fontStyle: "normal" | "italic";
	textDecoration: "none" | "underline" | "line-through";
	letterSpacing?: number;
	lineHeight?: number;
	hidden?: boolean;
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
	effects?: Effect[];
	/** On a caption track: the caption's speaker, cue id and settings (files/989, "Caption track in the .otio"). */
	caption?: CaptionCue;
}

export interface StickerElement extends BaseTimelineElement {
	type: "sticker";
	stickerId: string;
	/** Natural dimensions of the sticker asset, stored at insert time. Used by renderer and preview bounds to avoid split-brain geometry. */
	intrinsicWidth?: number;
	intrinsicHeight?: number;
	hidden?: boolean;
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
	effects?: Effect[];
}

export interface GraphicElement extends BaseTimelineElement {
	type: "graphic";
	definitionId: string;
	params: ParamValues;
	hidden?: boolean;
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
	effects?: Effect[];
	masks?: Mask[];
}

export interface EffectElement extends BaseTimelineElement {
	type: "effect";
	effectType: string;
	params: ParamValues;
}

export type ElementUpdatePatch =
	| { transform: Transform }
	| { opacity: number }
	| { volume: number };

export type TimelineElement =
	| AudioElement
	| VideoElement
	| ImageElement
	| TextElement
	| StickerElement
	| GraphicElement
	| EffectElement;

export type ElementType = TimelineElement["type"];

function elementTypes<T extends ElementType[]>(...types: T): T {
	return types;
}

export const MASKABLE_ELEMENT_TYPES = elementTypes("video", "image", "graphic");

export type MaskableElement = Extract<
	TimelineElement,
	{ type: (typeof MASKABLE_ELEMENT_TYPES)[number] }
>;

export const RETIMABLE_ELEMENT_TYPES = elementTypes("video", "audio");

export type RetimableElement = Extract<
	TimelineElement,
	{ type: (typeof RETIMABLE_ELEMENT_TYPES)[number] }
>;

export const VISUAL_ELEMENT_TYPES = elementTypes(
	"video",
	"image",
	"text",
	"sticker",
	"graphic",
);

export type VisualElement = Extract<
	TimelineElement,
	{ type: (typeof VISUAL_ELEMENT_TYPES)[number] }
>;

export type CreateUploadAudioElement = Omit<UploadAudioElement, "id">;
export type CreateLibraryAudioElement = Omit<LibraryAudioElement, "id">;
export type CreateAudioElement =
	| CreateUploadAudioElement
	| CreateLibraryAudioElement;
export type CreateVideoElement = Omit<VideoElement, "id">;
export type CreateImageElement = Omit<ImageElement, "id">;
export type CreateTextElement = Omit<TextElement, "id">;
export type CreateStickerElement = Omit<StickerElement, "id">;
export type CreateGraphicElement = Omit<GraphicElement, "id">;
export type CreateEffectElement = Omit<EffectElement, "id">;
export type CreateTimelineElement =
	| CreateAudioElement
	| CreateVideoElement
	| CreateImageElement
	| CreateTextElement
	| CreateStickerElement
	| CreateGraphicElement
	| CreateEffectElement;

export interface ElementDragState {
	isDragging: boolean;
	elementId: string | null;
	dragElementIds: string[];
	dragTimeOffsets: Record<string, MediaTime>;
	trackId: string | null;
	startMouseX: number;
	startMouseY: number;
	startElementTime: MediaTime;
	clickOffsetTime: MediaTime;
	currentTime: MediaTime;
	currentMouseY: number;
}

export type ElementDragView =
	| { readonly kind: "idle" }
	| {
			readonly kind: "dragging";
			readonly anchorElementId: string;
			readonly trackId: string;
			readonly memberTimeOffsets: ReadonlyMap<string, MediaTime>;
			readonly startMouseX: number;
			readonly startMouseY: number;
			readonly startElementTime: MediaTime;
			readonly clickOffsetTime: MediaTime;
			readonly currentTime: MediaTime;
			readonly currentMouseX: number;
			readonly currentMouseY: number;
			readonly dropTarget: DropTarget | null;
	  };

export interface DropTarget {
	trackIndex: number;
	isNewTrack: boolean;
	insertPosition: "above" | "below" | null;
	xPosition: MediaTime;
	targetElement: { elementId: string; trackId: string } | null;
}

export interface ComputeDropTargetParams {
	elementType: ElementType;
	mouseX: number;
	mouseY: number;
	tracks: SceneTracks;
	playheadTime: MediaTime;
	isExternalDrop: boolean;
	elementDuration: MediaTime;
	pixelsPerSecond: number;
	zoomLevel: number;
	verticalDragDirection?: "up" | "down" | null;
	startTimeOverride?: MediaTime;
	excludeElementId?: string;
	targetElementTypes?: string[];
}

export interface ClipboardItem {
	trackId: string;
	trackType: TrackType;
	element: CreateTimelineElement;
}
