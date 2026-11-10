/**
 * OneOS (files/989, Mona 2026-11-10: "Simple ones only"): the commands that place, change and remove a transition at a cut. Each is one
 * undo step over the scene's tracks; what cannot be (`timeline/transitions.ts`) is refused by name and changes nothing.
 */
import { Command, type CommandResult } from "@/commands/base-command";
import type { SceneTracks, TimelineTrack } from "@/timeline";
import { EditorCore } from "@/core";
import { findTrackInSceneTracks, updateTrackInSceneTracks } from "@/timeline";
import { generateUUID } from "@/utils/id";
import {
	PICTURE_TRANSITIONS,
	SOUND_TRANSITIONS,
	type TransitionKind,
	defaultTransitionKind,
	withTransitionAdded,
	withTransitionChanged,
	withTransitionRemoved,
} from "@/timeline/transitions";

const KINDS: readonly string[] = [...PICTURE_TRANSITIONS, ...SOUND_TRANSITIONS];
function kindOf(kind: unknown): TransitionKind | undefined {
	if (kind === undefined) return undefined;
	if (typeof kind !== "string" || !KINDS.includes(kind)) throw new Error(`'${String(kind)}' is not a transition Cut draws (${KINDS.join(", ")})`);
	return kind as TransitionKind;
}

/** Edit one track of the active scene as one step; the tracks before it, for undo. */
function editTrack(trackId: string, edit: (track: TimelineTrack) => TimelineTrack): SceneTracks {
	const editor = EditorCore.getInstance();
	const tracks = editor.scenes.getActiveScene().tracks;
	const track = findTrackInSceneTracks({ tracks, trackId });
	if (!track) throw new Error(`the scene holds no track ${trackId}`);
	const next = edit(track);
	editor.timeline.updateTracks(updateTrackInSceneTracks({ tracks, trackId, update: () => next as never }));
	return tracks;
}
const restore = (tracks: SceneTracks | null) => {
	if (tracks) EditorCore.getInstance().timeline.updateTracks(tracks);
};

export class AddTransitionCommand extends Command {
	readonly transitionId = generateUUID();
	private savedState: SceneTracks | null = null;
	constructor(private args: { trackId: string; fromId?: string | null; toId?: string | null; kind?: string; duration?: number }) {
		super();
	}
	execute(): CommandResult | undefined {
		this.savedState = editTrack(this.args.trackId, (track) =>
			withTransitionAdded(track, {
				id: this.transitionId,
				kind: kindOf(this.args.kind) ?? defaultTransitionKind(track),
				fromId: this.args.fromId ?? null,
				toId: this.args.toId ?? null,
				duration: this.args.duration,
			}),
		);
		return undefined;
	}
	undo(): void {
		restore(this.savedState);
	}
}

export class UpdateTransitionCommand extends Command {
	private savedState: SceneTracks | null = null;
	constructor(private args: { trackId: string; transitionId: string; kind?: string; duration?: number }) {
		super();
	}
	execute(): CommandResult | undefined {
		this.savedState = editTrack(this.args.trackId, (track) => withTransitionChanged(track, this.args.transitionId, { kind: kindOf(this.args.kind), duration: this.args.duration }));
		return undefined;
	}
	undo(): void {
		restore(this.savedState);
	}
}

export class RemoveTransitionCommand extends Command {
	private savedState: SceneTracks | null = null;
	constructor(private args: { trackId: string; transitionId: string }) {
		super();
	}
	execute(): CommandResult | undefined {
		this.savedState = editTrack(this.args.trackId, (track) => withTransitionRemoved(track, this.args.transitionId));
		return undefined;
	}
	undo(): void {
		restore(this.savedState);
	}
}
