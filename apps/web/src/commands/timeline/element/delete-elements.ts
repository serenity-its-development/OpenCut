import { Command, type CommandResult } from "@/commands/base-command";
import type { SceneTracks } from "@/timeline";
import { EditorCore } from "@/core";
import type { TimelineTrack } from "@/timeline";
import { withLinked } from "@/timeline/linked";

function removeTrackElements<TTrack extends TimelineTrack>({
	track,
	elements,
}: {
	track: TTrack;
	elements: { trackId: string; elementId: string }[];
}): TTrack {
	const nextElements = track.elements.filter(
		(element) =>
			!elements.some(
				(target) =>
					target.trackId === track.id && target.elementId === element.id,
			),
	);

	return { ...track, elements: nextElements } as TTrack;
}

export class DeleteElementsCommand extends Command {
	private savedState: SceneTracks | null = null;
	private readonly elements: { trackId: string; elementId: string }[];

	constructor({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}) {
		super();
		this.elements = elements;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;
		// OneOS (files/989, "Build linked audio"): deleting an element deletes its linked partners too.
		const elements = withLinked({ tracks: this.savedState, refs: this.elements });

		const updatedTracks: SceneTracks = {
			overlay: this.savedState.overlay.map((track) =>
				removeTrackElements({ track, elements }),
			),
			main: removeTrackElements({
				track: this.savedState.main,
				elements,
			}),
			audio: this.savedState.audio.map((track) =>
				removeTrackElements({ track, elements }),
			),
		};

		editor.timeline.updateTracks(updatedTracks);

		return {
			selection: {
				selectedElements: [],
				selectedKeyframes: [],
				keyframeSelectionAnchor: null,
				selectedMaskPoints: null,
			},
		};
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
