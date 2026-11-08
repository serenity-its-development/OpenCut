"use client";

/**
 * Cut inside OneOS (doctrine files/016, files/989): the page the Craft frame loads. It opens the file the host hands over and saves to the
 * host; it never lists, creates or stores projects of its own (`oneos/host-mode.ts`). A page loaded with no declared host says so, by name.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { EditorProvider } from "@/components/providers/editor-provider";
import { EditorWorkspace } from "@/components/editor/editor-workspace";
import { HostHeader } from "@/components/editor/host-header";
import { useEditor } from "@/editor/use-editor";
import { HOST_PROJECT_ID, HostMode, type HostState } from "@/oneos/host-mode";

const WAITING: HostState = { stage: "waiting" };

export default function OneOSHostEditor() {
	const [mode, setMode] = useState<HostMode | { refused: string } | null>(null);
	useEffect(() => {
		setMode(HostMode.start(globalThis));
	}, []);
	const host = mode instanceof HostMode ? mode : null;
	const state = useSyncExternalStore(
		(l) => (host ? host.subscribe(l) : () => {}),
		() => (host ? host.getState() : WAITING),
		() => WAITING,
	);

	if (mode && !(mode instanceof HostMode)) return <Message text={mode.refused} />;
	if (state.stage === "refused") return <Message text={state.error} />;
	if (!host || state.stage === "waiting") return <Message text="Opening the file..." busy />;
	return (
		<EditorProvider projectId={HOST_PROJECT_ID}>
			<Settle host={host} />
			<EditorWorkspace header={<HostHeader host={host} state={state} />} />
		</EditorProvider>
	);
}

/** Once the editor has loaded the project, what it holds is the unedited state the host mode measures edits against. */
function Settle({ host }: { host: HostMode }) {
	const loaded = useEditor((e) => e.project.getActiveOrNull() !== null && !e.project.getIsLoading());
	useEffect(() => {
		if (loaded) void host.settle();
	}, [loaded, host]);
	return null;
}

function Message({ text, busy = false }: { text: string; busy?: boolean }) {
	return (
		<div className="bg-background flex h-screen w-screen items-center justify-center">
			<div className="flex max-w-lg flex-col items-center gap-4 px-6 text-center">
				{busy && <Loader2 className="text-muted-foreground size-8 animate-spin" />}
				<p className={busy ? "text-muted-foreground text-sm" : "text-destructive text-sm"}>{text}</p>
			</div>
		</div>
	);
}
