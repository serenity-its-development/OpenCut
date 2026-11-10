/**
 * Cut's command ids (OneOS doctrine files/025, files/999): the editor's 43 command classes (40, and files/989's three transition commands), each named once. The assistant runs a step by
 * this id through `craft:command` (`command-host.ts`); what it may not run is listed with its reason. Pure: the classes themselves are made
 * in `command-host.ts`.
 *
 * A step's arguments are checked here by shape before anything is made, and refused by name: a missing or mistyped argument, or any text
 * that names a file or an address (media come only from Files, through the host; Freesound is off).
 */

/** Every id, and the class it names. */
export const CUT_COMMAND_IDS = {
	"element.insert": "InsertElementCommand",
	"element.update": "UpdateElementsCommand",
	"element.delete": "DeleteElementsCommand",
	"element.duplicate": "DuplicateElementsCommand",
	"element.split": "SplitElementsCommand",
	"element.toggleSourceAudio": "ToggleSourceAudioSeparationCommand",
	"element.move": "MoveElementCommand",
	"effect.add": "AddClipEffectCommand",
	"effect.remove": "RemoveClipEffectCommand",
	"effect.reorder": "ReorderClipEffectsCommand",
	"effect.toggle": "ToggleClipEffectCommand",
	"effect.updateParams": "UpdateClipEffectParamsCommand",
	"keyframe.upsert": "UpsertKeyframeCommand",
	"keyframe.remove": "RemoveKeyframeCommand",
	"keyframe.retime": "RetimeKeyframeCommand",
	"keyframe.updateCurve": "UpdateScalarKeyframeCurveCommand",
	"effectKeyframe.upsert": "UpsertEffectParamKeyframeCommand",
	"effectKeyframe.remove": "RemoveEffectParamKeyframeCommand",
	"mask.insertPoint": "InsertCustomMaskPointCommand",
	"mask.deletePoints": "DeleteCustomMaskPointsCommand",
	"mask.remove": "RemoveMaskCommand",
	"mask.toggleInverted": "ToggleMaskInvertedCommand",
	"track.add": "AddTrackCommand",
	"track.remove": "RemoveTrackCommand",
	"track.toggleMute": "ToggleTrackMuteCommand",
	"track.toggleVisibility": "ToggleTrackVisibilityCommand",
	"transition.add": "AddTransitionCommand",
	"transition.update": "UpdateTransitionCommand",
	"transition.remove": "RemoveTransitionCommand",
	"scene.create": "CreateSceneCommand",
	"scene.delete": "DeleteSceneCommand",
	"scene.rename": "RenameSceneCommand",
	"bookmark.toggle": "ToggleBookmarkCommand",
	"bookmark.remove": "RemoveBookmarkCommand",
	"bookmark.move": "MoveBookmarkCommand",
	"bookmark.update": "UpdateBookmarkCommand",
	"project.updateSettings": "UpdateProjectSettingsCommand",
	"media.remove": "RemoveMediaAssetCommand",
	"media.add": "AddMediaAssetCommand",
	"clipboard.paste": "PasteCommand",
	"clipboard.pasteKeyframes": "PasteKeyframesCommand",
	"tracks.snapshot": "TracksSnapshotCommand",
	batch: "BatchCommand",
} as const;

export type CutCommandId = keyof typeof CUT_COMMAND_IDS;

/** What the assistant may not run, each with its reason. */
export const CUT_LEFT_OUT: ReadonlyArray<{ reason: string; ids: CutCommandId[] }> = [
	{ reason: "files: a medium comes into a project only from Files, through the host (Insert); the assistant names no file and no address", ids: ["media.add"] },
	{ reason: "the system clipboard is the person's (paste reads what they copied in their own window)", ids: ["clipboard.paste", "clipboard.pasteKeyframes"] },
	{ reason: "planned by the window: a drag's moves (placement, snapping, ripple) and a mask point placed on the drawn canvas are measured by the person's window; the assistant moves an element with element.update {startTime} and shapes a mask by its parameters", ids: ["element.move", "mask.insertPoint"] },
	{ reason: "internal: a run is already ONE batch (command.batch, one undo step), and a whole-tracks snapshot is made by the timeline itself", ids: ["batch", "tracks.snapshot"] },
];

const LEFT = new Set(CUT_LEFT_OUT.flatMap((g) => g.ids));
/** The ids the assistant may run, in the registry's order. */
export const CUT_RUN_COMMANDS: string[] = (Object.keys(CUT_COMMAND_IDS) as CutCommandId[]).filter((id) => !LEFT.has(id));

type Kind = "s" | "n" | "b" | "o" | "a" | "v";
/** Each allowed id's arguments: name -> kind, a trailing `?` when optional (`v`: any value). */
const ARGS: Record<string, Record<string, Kind | `${Kind}?`>> = {
	"element.insert": { element: "o", placement: "o" },
	"element.update": { updates: "a" },
	"element.delete": { elements: "a" },
	"element.duplicate": { elements: "a" },
	"element.split": { elements: "a", splitTime: "n", retainSide: "s?" },
	"element.toggleSourceAudio": { trackId: "s", elementId: "s" },
	"effect.add": { trackId: "s", elementId: "s", effectType: "s" },
	"effect.remove": { trackId: "s", elementId: "s", effectId: "s" },
	"effect.reorder": { trackId: "s", elementId: "s", fromIndex: "n", toIndex: "n" },
	"effect.toggle": { trackId: "s", elementId: "s", effectId: "s" },
	"effect.updateParams": { trackId: "s", elementId: "s", effectId: "s", params: "o" },
	"keyframe.upsert": { trackId: "s", elementId: "s", propertyPath: "s", time: "n", value: "v", interpolation: "s?", keyframeId: "s?" },
	"keyframe.remove": { trackId: "s", elementId: "s", propertyPath: "s", keyframeId: "s", valueAtPlayhead: "v?" },
	"keyframe.retime": { trackId: "s", elementId: "s", propertyPath: "s", keyframeId: "s", nextTime: "n" },
	"keyframe.updateCurve": { trackId: "s", elementId: "s", propertyPath: "s", componentKey: "s", keyframeId: "s", patch: "o" },
	"effectKeyframe.upsert": { trackId: "s", elementId: "s", effectId: "s", paramKey: "s", time: "n", value: "v", interpolation: "s?", keyframeId: "s?" },
	"effectKeyframe.remove": { trackId: "s", elementId: "s", effectId: "s", paramKey: "s", keyframeId: "s" },
	"mask.deletePoints": { trackId: "s", elementId: "s", maskId: "s", pointIds: "a" },
	"mask.remove": { trackId: "s", elementId: "s", maskId: "s" },
	"mask.toggleInverted": { trackId: "s", elementId: "s", maskId: "s" },
	"track.add": { type: "s", index: "n?" },
	"track.remove": { trackId: "s" },
	"track.toggleMute": { trackId: "s" },
	"track.toggleVisibility": { trackId: "s" },
	"transition.add": { trackId: "s", fromId: "s?", toId: "s?", kind: "s?", duration: "n?" },
	"transition.update": { trackId: "s", transitionId: "s", kind: "s?", duration: "n?" },
	"transition.remove": { trackId: "s", transitionId: "s" },
	"scene.create": { name: "s", isMain: "b?" },
	"scene.delete": { sceneId: "s" },
	"scene.rename": { sceneId: "s", newName: "s" },
	"bookmark.toggle": { time: "n" },
	"bookmark.remove": { time: "n" },
	"bookmark.move": { fromTime: "n", toTime: "n" },
	"bookmark.update": { time: "n", updates: "o" },
	"project.updateSettings": { updates: "o" },
	"media.remove": { assetId: "s" },
};

/** Text that names a file or an address (a scheme, a protocol-relative or rooted path, a drive). */
const ADDRESS = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|[a-z]:\\)/i;

function namesAddress(v: unknown, depth = 0): string | null {
	if (depth > 32) return "is nested too deep";
	if (typeof v === "string") return ADDRESS.test(v.trim()) && !/^#[0-9a-f]{3,8}$/i.test(v) ? `"${v.slice(0, 60)}" names a file or an address` : null;
	if (Array.isArray(v)) { for (const x of v) { const w = namesAddress(x, depth + 1); if (w) return w; } return null; }
	if (v && typeof v === "object") { for (const x of Object.values(v)) { const w = namesAddress(x, depth + 1); if (w) return w; } }
	return null;
}

const isKind = (v: unknown, k: Kind) =>
	k === "v" ? v !== undefined
		: k === "s" ? typeof v === "string" && v.length > 0 && v.length <= 4096
			: k === "n" ? typeof v === "number" && Number.isFinite(v)
				: k === "b" ? typeof v === "boolean"
					: k === "a" ? Array.isArray(v)
						: v !== null && typeof v === "object" && !Array.isArray(v);

/** Why a step may not run (`null`: it may). */
export function checkArgs(id: string, args: unknown): string | null {
	if (!(id in CUT_COMMAND_IDS)) return `'${id}' is not a command of Cut`;
	if (LEFT.has(id as CutCommandId)) return `'${id}' is left out for the assistant: ${CUT_LEFT_OUT.find((g) => g.ids.includes(id as CutCommandId))?.reason}`;
	const a = (args ?? {}) as Record<string, unknown>;
	if (typeof a !== "object" || Array.isArray(a)) return `the arguments of '${id}' are not an object`;
	const spec = ARGS[id];
	for (const k of Object.keys(a)) if (!(k in spec)) return `'${id}' takes no argument '${k}'`;
	for (const [k, kind] of Object.entries(spec)) {
		const optional = kind.endsWith("?");
		const v = a[k];
		if (v === undefined) { if (optional) continue; return `'${id}' needs the argument '${k}'`; }
		if (!isKind(v, kind.replace("?", "") as Kind)) return `the argument '${k}' of '${id}' is not ${({ s: "a text", n: "a number", b: "true or false", a: "a list", o: "an object", v: "a value" } as const)[kind.replace("?", "") as Kind]}`;
	}
	const addr = namesAddress(a);
	return addr ? `an argument of '${id}' ${addr}; the assistant names no file and no address` : null;
}

/**
 * The editor's ACTIONS (`apps/web/src/actions/definitions.ts`) the assistant may run as a step, by their own ids; the rest are left out with
 * their reason. With the command ids above they are Cut's whole registry.
 */
export const CUT_RUN_ACTIONS: readonly string[] = [
	"frame-step-forward", "frame-step-backward", "jump-forward", "jump-backward", "goto-start", "goto-end", "split", "split-left", "split-right",
	"delete-selected", "copy-selected", "paste-copied", "toggle-snapping", "toggle-ripple-editing", "toggle-source-audio", "select-all", "deselect-all",
	"duplicate-selected", "toggle-elements-muted-selected", "toggle-elements-visibility-selected", "toggle-bookmark", "remove-media-asset", "remove-media-assets",
];
export const CUT_LEFT_OUT_ACTIONS: ReadonlyArray<{ reason: string; ids: string[] }> = [
	{ reason: "playback: plays, stops and scrubs the person's own preview (sound and picture in their window), not an edit of the project", ids: ["toggle-play", "stop-playback", "seek-forward", "seek-backward"] },
	{ reason: "history: Undo and Redo are the person's, and a run is already ONE undo step", ids: ["undo", "redo"] },
	{ reason: "interaction: cancels the person's own drag or trim in progress in their window", ids: ["cancel-interaction"] },
];
