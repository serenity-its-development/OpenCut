"use client";

import { useParams } from "next/navigation";
import { EditorHeader } from "@/components/editor/editor-header";
import { EditorProvider } from "@/components/providers/editor-provider";
import { Onboarding } from "@/components/editor/onboarding";
import { MigrationDialog } from "@/project/components/migration-dialog";
import { MobileGate } from "@/components/editor/mobile-gate";
import { ChangelogNotification } from "@/changelog/components/changelog-notification";
import { EditorWorkspace } from "@/components/editor/editor-workspace";

export default function Editor() {
	const params = useParams();
	const projectId = params.project_id as string;

	return (
		<MobileGate>
			<EditorProvider projectId={projectId}>
				<EditorWorkspace header={<EditorHeader />} />
				<Onboarding />
				<MigrationDialog />
				<ChangelogNotification />
			</EditorProvider>
		</MobileGate>
	);
}
