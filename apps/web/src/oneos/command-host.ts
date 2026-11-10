/**
 * The assistant's run, made real in Cut's window (OneOS doctrine files/025): `craft:command {method: "command.batch"}` from the host is run by
 * `runBatch` (judged whole first, then ONE undo step, nothing kept when a step fails), each action through the editor's own action registry
 * and each command id (`command-ids.ts`) as the editor's own command class.
 */
import { EditorCore } from "@/core";
import { invokeAction } from "@/actions";
import type { TActionWithOptionalArgs } from "@/actions";
import type { Command } from "@/commands";
import {
	AddClipEffectCommand, AddTrackCommand, AddTransitionCommand, RemoveTransitionCommand, UpdateTransitionCommand, CreateSceneCommand, DeleteCustomMaskPointsCommand, DeleteElementsCommand, DeleteSceneCommand,
	DuplicateElementsCommand, InsertElementCommand, MoveBookmarkCommand, RemoveBookmarkCommand, RemoveClipEffectCommand,
	RemoveEffectParamKeyframeCommand, RemoveKeyframeCommand, RemoveMaskCommand, RemoveMediaAssetCommand, RemoveTrackCommand, RenameSceneCommand,
	ReorderClipEffectsCommand, RetimeKeyframeCommand, SplitElementsCommand, ToggleBookmarkCommand, ToggleClipEffectCommand,
	ToggleMaskInvertedCommand, ToggleSourceAudioSeparationCommand, ToggleTrackMuteCommand, ToggleTrackVisibilityCommand, UpdateBookmarkCommand,
	UpdateClipEffectParamsCommand, UpdateElementsCommand, UpdateProjectSettingsCommand, UpdateScalarKeyframeCurveCommand,
	UpsertEffectParamKeyframeCommand, UpsertKeyframeCommand,
} from "@/commands";
import { runBatch, type RunAnswer } from "./command-run.ts";

// The arguments are judged by shape in `checkArgs` before anything is made; each class judges its own content as it runs.
type A = Record<string, any>;
const MAKE: Record<string, (a: A) => Command> = {
	"element.insert": (a) => new InsertElementCommand({ element: a.element, placement: a.placement }),
	"element.update": (a) => new UpdateElementsCommand({ updates: a.updates }),
	"element.delete": (a) => new DeleteElementsCommand({ elements: a.elements }),
	"element.duplicate": (a) => new DuplicateElementsCommand({ elements: a.elements }),
	"element.split": (a) => new SplitElementsCommand({ elements: a.elements, splitTime: a.splitTime, retainSide: a.retainSide }),
	"element.toggleSourceAudio": (a) => new ToggleSourceAudioSeparationCommand({ trackId: a.trackId, elementId: a.elementId }),
	"effect.add": (a) => new AddClipEffectCommand({ trackId: a.trackId, elementId: a.elementId, effectType: a.effectType }),
	"effect.remove": (a) => new RemoveClipEffectCommand({ trackId: a.trackId, elementId: a.elementId, effectId: a.effectId }),
	"effect.reorder": (a) => new ReorderClipEffectsCommand({ trackId: a.trackId, elementId: a.elementId, fromIndex: a.fromIndex, toIndex: a.toIndex }),
	"effect.toggle": (a) => new ToggleClipEffectCommand({ trackId: a.trackId, elementId: a.elementId, effectId: a.effectId }),
	"effect.updateParams": (a) => new UpdateClipEffectParamsCommand({ trackId: a.trackId, elementId: a.elementId, effectId: a.effectId, params: a.params }),
	"keyframe.upsert": (a) => new UpsertKeyframeCommand({ trackId: a.trackId, elementId: a.elementId, propertyPath: a.propertyPath, time: a.time, value: a.value, interpolation: a.interpolation, keyframeId: a.keyframeId }),
	"keyframe.remove": (a) => new RemoveKeyframeCommand({ trackId: a.trackId, elementId: a.elementId, propertyPath: a.propertyPath, keyframeId: a.keyframeId, valueAtPlayhead: a.valueAtPlayhead ?? null }),
	"keyframe.retime": (a) => new RetimeKeyframeCommand({ trackId: a.trackId, elementId: a.elementId, propertyPath: a.propertyPath, keyframeId: a.keyframeId, nextTime: a.nextTime }),
	"keyframe.updateCurve": (a) => new UpdateScalarKeyframeCurveCommand({ trackId: a.trackId, elementId: a.elementId, propertyPath: a.propertyPath, componentKey: a.componentKey, keyframeId: a.keyframeId, patch: a.patch }),
	"effectKeyframe.upsert": (a) => new UpsertEffectParamKeyframeCommand({ trackId: a.trackId, elementId: a.elementId, effectId: a.effectId, paramKey: a.paramKey, time: a.time, value: a.value, interpolation: a.interpolation, keyframeId: a.keyframeId }),
	"effectKeyframe.remove": (a) => new RemoveEffectParamKeyframeCommand({ trackId: a.trackId, elementId: a.elementId, effectId: a.effectId, paramKey: a.paramKey, keyframeId: a.keyframeId }),
	"mask.deletePoints": (a) => new DeleteCustomMaskPointsCommand({ trackId: a.trackId, elementId: a.elementId, maskId: a.maskId, pointIds: a.pointIds }),
	"mask.remove": (a) => new RemoveMaskCommand({ trackId: a.trackId, elementId: a.elementId, maskId: a.maskId }),
	"mask.toggleInverted": (a) => new ToggleMaskInvertedCommand({ trackId: a.trackId, elementId: a.elementId, maskId: a.maskId }),
	"track.add": (a) => new AddTrackCommand(a.type, a.index),
	"track.remove": (a) => new RemoveTrackCommand(a.trackId),
	"track.toggleMute": (a) => new ToggleTrackMuteCommand(a.trackId),
	"track.toggleVisibility": (a) => new ToggleTrackVisibilityCommand(a.trackId),
	"transition.add": (a) => new AddTransitionCommand({ trackId: a.trackId, fromId: a.fromId ?? null, toId: a.toId ?? null, kind: a.kind, duration: a.duration }),
	"transition.update": (a) => new UpdateTransitionCommand({ trackId: a.trackId, transitionId: a.transitionId, kind: a.kind, duration: a.duration }),
	"transition.remove": (a) => new RemoveTransitionCommand({ trackId: a.trackId, transitionId: a.transitionId }),
	"scene.create": (a) => new CreateSceneCommand(a.name, a.isMain ?? false),
	"scene.delete": (a) => new DeleteSceneCommand(a.sceneId),
	"scene.rename": (a) => new RenameSceneCommand(a.sceneId, a.newName),
	"bookmark.toggle": (a) => new ToggleBookmarkCommand(a.time),
	"bookmark.remove": (a) => new RemoveBookmarkCommand(a.time),
	"bookmark.move": (a) => new MoveBookmarkCommand(a.fromTime, a.toTime),
	"bookmark.update": (a) => new UpdateBookmarkCommand(a.time, a.updates),
	"project.updateSettings": (a) => new UpdateProjectSettingsCommand(a.updates),
	"media.remove": (a) => new RemoveMediaAssetCommand(EditorCore.getInstance().project.getActive().metadata.id, a.assetId),
};

/** The ids `MAKE` makes: every allowed command id, and no other (pinned against `CUT_RUN_COMMANDS` by the fork's tests). */
export const MADE_IDS = Object.keys(MAKE);

/** Run one assistant run in this window. */
export function runInEditor(params: unknown): RunAnswer {
	const editor = EditorCore.getInstance();
	return runBatch(params, {
		action: (id) => invokeAction(id as TActionWithOptionalArgs, undefined, "keypress"),
		command: (id, args) => {
			const make = MAKE[id];
			if (!make) throw new Error(`'${id}' is not made here`);
			editor.command.execute({ command: make(args) });
		},
		asOne: (fn) => editor.command.runAsOne(fn),
	});
}
