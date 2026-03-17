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
  void session;
  void deps;
  void options;
  return { kind: "new" };
}
