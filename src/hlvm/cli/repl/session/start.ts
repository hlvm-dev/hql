import type { SessionInitOptions, SessionMeta } from "./types.ts";

export const SESSION_PICKER_LIMIT = 20;

export interface SessionStartResolverOptions {
  defaultBehavior?: "latest" | "new";
}

export type SessionStartResolution =
  | {
    kind: "picker";
    sessions: SessionMeta[];
  }
  | {
    kind: "resume";
    sessionId: string;
  }
  | {
    kind: "missing";
    sessionId: string;
  }
  | {
    kind: "new";
  }
  | {
    kind: "latest";
    sessionId: string | null;
  };

export interface SessionStartResolverDeps {
  listSessions: (options?: {
    limit?: number;
    sortOrder?: "recent" | "oldest" | "alpha";
  }) => Promise<SessionMeta[]>;
  hasSession: (sessionId: string) => Promise<boolean>;
}

export async function resolveSessionStart(
  session: SessionInitOptions | undefined,
  deps: SessionStartResolverDeps,
  options?: SessionStartResolverOptions,
): Promise<SessionStartResolution> {
  if (session?.forceNew) {
    return { kind: "new" };
  }

  if (session?.openPicker) {
    return {
      kind: "picker",
      sessions: await deps.listSessions({ limit: SESSION_PICKER_LIMIT }),
    };
  }

  if (session?.resumeId) {
    const exists = await deps.hasSession(session.resumeId);
    return exists
      ? { kind: "resume", sessionId: session.resumeId }
      : { kind: "missing", sessionId: session.resumeId };
  }

  if (session?.continue) {
    const latest = (await deps.listSessions({ limit: 1 }))[0] ?? null;
    return {
      kind: "latest",
      sessionId: latest?.id ?? null,
    };
  }

  if (options?.defaultBehavior === "new") {
    return { kind: "new" };
  }

  const latest = (await deps.listSessions({ limit: 1 }))[0] ?? null;
  return {
    kind: "latest",
    sessionId: latest?.id ?? null,
  };
}
