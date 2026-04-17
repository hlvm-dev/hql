// Compat domain: runtime submit / stream adapter.
//
// Purpose: the v2 shell shouldn't reach directly into host-client or
// agent-runner. Every path that needs to kick off an agent turn, cancel
// one, or read streaming state goes through this adapter so when CC slices
// are transplanted they see a stable HLVM-shaped API, not the raw HLVM
// runtime.
//
// STATUS: scaffold. The actual implementation in TranscriptWorkbench still
// calls `ensureRuntimeHostAvailable` / `runAgentQueryViaHost` directly; move
// those call-sites here as Phase 1 closes.

export type StreamingPhase = "idle" | "thinking" | "streaming" | "tool";

export interface RuntimeSubmitRequest {
  readonly text: string;
  readonly attachments: readonly unknown[];
  readonly mode: "prompt" | "bash";
  readonly permissionMode: "default" | "accept-edits" | "plan";
}

export interface RuntimeAdapter {
  submit(request: RuntimeSubmitRequest): Promise<void>;
  abort(): void;
  getModelLabel(): string | undefined;
  getStreamingPhase(): StreamingPhase;
}
