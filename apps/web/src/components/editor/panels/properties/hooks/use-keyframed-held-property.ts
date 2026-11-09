import { useEditor } from "@/editor/use-editor";
import { getKeyframeAtTime, hasKeyframesForPath } from "@/animation";
import type { AnimationPropertyPath, ElementAnimations } from "@/animation/types";
import type { TimelineElement } from "@/timeline";
import type { MediaTime } from "@/wasm";

/**
 * A value held from key to key (a text's font or content; OneOS files/989, Mona 2026-11-09: "Build text animation in Cut"): while it is
 * keyed and the playhead is on the element, a change sets the key at the playhead; otherwise it changes the element's own value.
 */
export function useKeyframedHeldProperty({
	trackId,
	elementId,
	animations,
	propertyPath,
	localTime,
	isPlayheadWithinElementRange,
	valueAtPlayhead,
	buildBaseUpdates,
}: {
	trackId: string;
	elementId: string;
	animations: ElementAnimations | undefined;
	propertyPath: AnimationPropertyPath;
	localTime: MediaTime;
	isPlayheadWithinElementRange: boolean;
	valueAtPlayhead: string;
	buildBaseUpdates: ({ value }: { value: string }) => Partial<TimelineElement>;
}) {
	const editor = useEditor();
	const hasAnimatedKeyframes = hasKeyframesForPath({ animations, propertyPath });
	const keyframeAtTime = isPlayheadWithinElementRange
		? getKeyframeAtTime({ animations, propertyPath, time: localTime })
		: null;
	const keyframeIdAtTime = keyframeAtTime?.id ?? null;
	const setKey = (value: string) =>
		editor.timeline.upsertKeyframes({
			keyframes: [{ trackId, elementId, propertyPath, time: localTime, value }],
		});

	const toggleKeyframe = () => {
		if (!isPlayheadWithinElementRange) {
			return;
		}
		if (keyframeIdAtTime) {
			editor.timeline.removeKeyframes({
				keyframes: [{ trackId, elementId, propertyPath, keyframeId: keyframeIdAtTime }],
			});
			return;
		}
		setKey(valueAtPlayhead);
	};

	const commitValue = ({ value }: { value: string }) => {
		if (hasAnimatedKeyframes && isPlayheadWithinElementRange) {
			setKey(value);
			return;
		}
		editor.timeline.updateElements({
			updates: [{ trackId, elementId, patch: buildBaseUpdates({ value }) }],
		});
	};

	return { hasAnimatedKeyframes, isKeyframedAtTime: keyframeAtTime !== null, keyframeIdAtTime, toggleKeyframe, commitValue };
}
