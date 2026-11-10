"use client";

/**
 * OneOS (files/989, Mona 2026-11-10: "Simple ones only"): a track's transitions on the timeline. Each sits over its window at its cut; a
 * click opens it: its kind (the ones Cut draws for the track), its length, and Remove. Every change is one command, one undo step.
 */
import { useState } from "react";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import type { TimelineTrack } from "@/timeline";
import { timelineTimeToPixels, timelineTimeToSnappedPixels } from "@/timeline/pixel-utils";
import {
	PICTURE_TRANSITIONS,
	SOUND_TRANSITIONS,
	TRANSITION_NAME,
	type TrackTransition,
	type TransitionKind,
	transitionWindow,
	transitionsOf,
} from "@/timeline/transitions";
import { AddTransitionCommand, RemoveTransitionCommand, UpdateTransitionCommand } from "@/commands/timeline/transition";
import type { Command } from "@/commands/base-command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TICKS_PER_SECOND } from "@/wasm";

/** Run a transition command; a refusal is shown by name and changes nothing. */
export function useTransitionCommand() {
	const editor = useEditor();
	return (command: Command) => {
		try {
			editor.command.execute({ command });
		} catch (error) {
			toast.error((error as Error).message);
		}
	};
}

/** The cut an element's edge makes on its track: the element ending at its start, or starting at its end (null: nothing there). */
export function neighbourAt(track: TimelineTrack, elementId: string, edge: "start" | "end"): { fromId: string | null; toId: string | null } {
	const els = track.elements as Array<{ id: string; startTime: number; duration: number }>;
	const e = els.find((x) => x.id === elementId);
	if (!e) return { fromId: null, toId: null };
	if (edge === "start") return { fromId: els.find((x) => x.startTime + x.duration === e.startTime)?.id ?? null, toId: e.id };
	return { fromId: e.id, toId: els.find((x) => x.startTime === e.startTime + e.duration)?.id ?? null };
}

/** The element context menu's "Transition at start / end": Film's default kind for the track, one second, at that cut. */
export function addTransitionAt(run: (c: Command) => void, track: TimelineTrack, elementId: string, edge: "start" | "end") {
	run(new AddTransitionCommand({ trackId: track.id, ...neighbourAt(track, elementId, edge) }));
}

export function TimelineTransitions({ track, zoomLevel }: { track: TimelineTrack; zoomLevel: number }) {
	const transitions = transitionsOf(track);
	if (!transitions.length) return null;
	return (
		<>
			{transitions.map((x) => (
				<TransitionBlock key={x.id} track={track} transition={x} zoomLevel={zoomLevel} />
			))}
		</>
	);
}

function TransitionBlock({ track, transition, zoomLevel }: { track: TimelineTrack; transition: TrackTransition; zoomLevel: number }) {
	const run = useTransitionCommand();
	const [open, setOpen] = useState(false);
	const w = transitionWindow(track, transition);
	const [seconds, setSeconds] = useState(() => ((transition.before + transition.after) / TICKS_PER_SECOND).toString());
	if (typeof w === "string") return null;
	const left = timelineTimeToSnappedPixels({ time: w.start, zoomLevel });
	const width = Math.max(6, timelineTimeToPixels({ time: w.end - w.start, zoomLevel }));
	const kinds: readonly TransitionKind[] = track.type === "audio" ? SOUND_TRANSITIONS : PICTURE_TRANSITIONS;
	const name = TRANSITION_NAME[transition.kind];
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`${name}, ${(transition.before + transition.after) / TICKS_PER_SECOND} s`}
					title={name}
					className="bg-primary/35 border-primary absolute top-1 bottom-1 z-[5] rounded-sm border"
					style={{ left, width, backgroundImage: "linear-gradient(to top right, transparent 48%, currentColor 49%, currentColor 51%, transparent 52%)" }}
					onMouseDown={(event) => event.stopPropagation()}
				/>
			</PopoverTrigger>
			<PopoverContent className="flex w-64 flex-col gap-3">
				<Select
					value={transition.kind}
					onValueChange={(kind) => run(new UpdateTransitionCommand({ trackId: track.id, transitionId: transition.id, kind }))}
				>
					<SelectTrigger aria-label="Transition">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{kinds.map((k) => (
							<SelectItem key={k} value={k}>
								{TRANSITION_NAME[k]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<form
					className="flex items-center gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						const ticks = Math.round(Number(seconds) * TICKS_PER_SECOND);
						run(new UpdateTransitionCommand({ trackId: track.id, transitionId: transition.id, duration: ticks }));
					}}
				>
					<Input aria-label="Length in seconds" type="number" min={0.01} step={0.01} value={seconds} onChange={(event) => setSeconds(event.target.value)} />
					<span className="text-muted-foreground text-xs">s</span>
					<Button type="submit" size="sm" variant="secondary">
						Set
					</Button>
				</form>
				<Button
					variant="destructive"
					size="sm"
					onClick={() => {
						run(new RemoveTransitionCommand({ trackId: track.id, transitionId: transition.id }));
						setOpen(false);
					}}
				>
					Remove transition
				</Button>
			</PopoverContent>
		</Popover>
	);
}
