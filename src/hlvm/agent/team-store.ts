/**
 * File-Based Team Store
 *
 * Provides persistent team coordination matching Claude Code's agent teams
 * architecture. Wraps the in-memory TeamRuntime with file-based persistence:
 *
 *   ~/.hlvm/teams/{teamName}/config.json    — team config + members
 *   ~/.hlvm/teams/{teamName}/inboxes/*.json — per-agent message inboxes
 *   ~/.hlvm/tasks/{teamName}/               — task files
 *
 * All file I/O goes through getPlatform().fs (SSOT).
 */

import { getPlatform } from "../../platform/platform.ts";
import {
  ensureTeamDirs,
  getTeamConfigPath,
  getTeamDir,
  getTeamHighwatermarkPath,
  getTeamInboxesDir,
  getTeamInboxPath,
  getTeamTasksDir,
  removeTeamDirs,
} from "../../common/paths.ts";
import { getAgentLogger } from "./logger.ts";
import {
  createTeamRuntime,
  type TeamMember,
  type TeamMessage,
  type TeamRuntime,
  type TeamRuntimeSnapshot,
  type TeamTask,
  type TeamTaskStatus,
} from "./team-runtime.ts";

// ── Types ─────────────────────────────────────────────────────────────

/** Persistent team config matching Claude Code's config.json schema. */
export interface TeamConfig {
  teamId: string;
  teamName: string;
  leadMemberId: string;
  createdAt: number;
  members: TeamConfigMember[];
}

export interface TeamConfigMember {
  name: string;
  agentId: string;
  agentType: string;
  model?: string;
  status?: string;
  joinedAt?: number;
  backendType?: string;
  planModeRequired?: boolean;
}

/** Persistent task file matching Claude Code's task schema. */
export interface TaskFile {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
  owner?: string;
  blocks: string[];
  blockedBy: string[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

/** Inbox message for file-based inter-agent messaging. */
export interface InboxMessage {
  id: string;
  type:
    | "message"
    | "broadcast"
    | "shutdown_request"
    | "shutdown_response"
    | "plan_approval_request"
    | "plan_approval_response";
  from: string;
  content: string;
  summary?: string;
  timestamp: number;
  // shutdown fields
  requestId?: string;
  approve?: boolean;
  // plan approval fields
  recipient?: string;
}

// ── File I/O Helpers ──────────────────────────────────────────────────

const fs = () => getPlatform().fs;
const pathMod = () => getPlatform().path;

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const text = await fs().readTextFile(filePath);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function readJsonSync<T>(filePath: string): T | null {
  try {
    const text = fs().readTextFileSync(filePath);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs().writeTextFile(filePath, JSON.stringify(data, null, 2) + "\n");
}

function writeJsonSync(filePath: string, data: unknown): void {
  fs().writeTextFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

// ── Task ID counter (file-backed highwatermark) ──────────────────────

/** Per-store counter so each store instance manages its own ID sequence. */
class TaskIdCounter {
  private _value: number;
  private _teamName: string;

  constructor(teamName: string, initial = 0) {
    this._teamName = teamName;
    this._value = initial;
  }

  next(): string {
    this._value++;
    this._persist();
    return String(this._value);
  }

  sync(tasks: TaskFile[]): void {
    let max = this._value;
    for (const t of tasks) {
      const n = parseInt(t.id, 10);
      if (!isNaN(n) && n > max) max = n;
    }
    this._value = max;
  }

  get value(): number {
    return this._value;
  }

  reset(): void {
    this._value = 0;
  }

  private _persist(): void {
    try {
      fs().writeTextFileSync(
        getTeamHighwatermarkPath(this._teamName),
        String(this._value),
      );
    } catch { /* best effort */ }
  }

  static load(teamName: string): TaskIdCounter {
    try {
      const text = fs().readTextFileSync(
        getTeamHighwatermarkPath(teamName),
      ).trim();
      const n = parseInt(text, 10);
      if (!isNaN(n) && n > 0) return new TaskIdCounter(teamName, n);
    } catch { /* file may not exist yet */ }
    return new TaskIdCounter(teamName, 0);
  }
}

// ── Team Store ────────────────────────────────────────────────────────

export interface TeamStore {
  readonly teamName: string;
  readonly runtime: TeamRuntime;

  // Config
  getConfig(): TeamConfig;
  persistConfig(): Promise<void>;

  // Tasks (Claude Code API: TaskCreate/Get/Update/List)
  createTask(input: {
    subject: string;
    description: string;
    activeForm?: string;
    metadata?: Record<string, unknown>;
  }): Promise<TaskFile>;

  getTask(taskId: string): Promise<TaskFile | null>;

  updateTask(
    taskId: string,
    patch: {
      status?: "pending" | "in_progress" | "completed" | "deleted";
      subject?: string;
      description?: string;
      activeForm?: string;
      owner?: string;
      addBlocks?: string[];
      addBlockedBy?: string[];
      metadata?: Record<string, unknown>;
    },
  ): Promise<TaskFile | null>;

  listTasks(): Promise<TaskFile[]>;

  // Messaging (Claude Code API: SendMessage)
  sendMessage(msg: InboxMessage): Promise<void>;
  readInbox(agentName: string): Promise<InboxMessage[]>;

  // Lifecycle
  cleanup(): Promise<void>;
}

/** Map Claude Code task status ↔ TeamRuntime task status */
function toRuntimeStatus(
  s: "pending" | "in_progress" | "completed",
): TeamTaskStatus {
  if (s === "in_progress") return "in_progress";
  return s;
}

function toFileStatus(
  s: TeamTaskStatus,
): "pending" | "in_progress" | "completed" {
  if (s === "claimed" || s === "blocked" || s === "cancelled" || s === "errored") return "pending";
  return s as "pending" | "in_progress" | "completed";
}

/**
 * Create a file-backed team store matching Claude Code's agent teams.
 *
 * Usage:
 *   const store = await createTeamStore("my-team", "lead");
 */
export async function createTeamStore(
  teamName: string,
  leadAgent = "lead",
  leadMemberId = "lead",
  options?: {
    snapshot?: TeamRuntimeSnapshot;
    onChange?: (snapshot: TeamRuntimeSnapshot) => void;
  },
): Promise<TeamStore> {
  // Ensure directories exist
  await ensureTeamDirs(teamName);

  // Create or restore in-memory runtime
  const runtime = createTeamRuntime(leadAgent, leadMemberId, {
    snapshot: options?.snapshot,
    onChange: (snapshot, _summary) => {
      options?.onChange?.(snapshot);
    },
  });

  // In-memory task file cache (synced to disk)
  const taskCache = new Map<string, TaskFile>();
  const taskIdCounter = TaskIdCounter.load(teamName);

  // Load existing tasks from disk
  const tasksDir = getTeamTasksDir(teamName);
  try {
    for await (const entry of fs().readDir(tasksDir)) {
      if (entry.name.endsWith(".json") && entry.isFile) {
        const taskPath = pathMod().join(tasksDir, entry.name);
        const task = await readJson<TaskFile>(taskPath);
        if (task) {
          taskCache.set(task.id, task);
        }
      }
    }
    taskIdCounter.sync([...taskCache.values()]);
  } catch {
    // No existing tasks
  }

  // Load existing config (if restoring)
  const existingConfig = readJsonSync<TeamConfig>(getTeamConfigPath(teamName));

  const config: TeamConfig = existingConfig ?? {
    teamId: runtime.teamId,
    teamName,
    leadMemberId,
    createdAt: Date.now(),
    members: [{
      name: leadMemberId,
      agentId: runtime.teamId,
      agentType: leadAgent,
    }],
  };

  // ── Task file persistence ──

  function taskFilePath(taskId: string): string {
    return pathMod().join(getTeamTasksDir(teamName), `${taskId}.json`);
  }

  async function persistTask(task: TaskFile): Promise<void> {
    taskCache.set(task.id, task);
    await writeJson(taskFilePath(task.id), task);
  }

  function buildBlocks(taskId: string): string[] {
    const blocks: string[] = [];
    for (const t of taskCache.values()) {
      if (t.blockedBy.includes(taskId)) blocks.push(t.id);
    }
    return blocks;
  }

  function buildBlockedBy(taskId: string): string[] {
    const task = taskCache.get(taskId);
    return task?.blockedBy ?? [];
  }

  // ── Store implementation ──

  const store: TeamStore = {
    teamName,
    runtime,

    getConfig(): TeamConfig {
      // Sync members from runtime
      const runtimeMembers = runtime.listMembers();
      config.members = runtimeMembers.map((m) => ({
        name: m.id,
        agentId: m.id,
        agentType: m.agent,
        status: m.status,
        joinedAt: m.createdAt,
        backendType: m.role === "lead" ? undefined : "in-process",
      }));
      return { ...config };
    },

    async persistConfig(): Promise<void> {
      const cfg = store.getConfig();
      await writeJson(getTeamConfigPath(teamName), cfg);
    },

    async createTask(input): Promise<TaskFile> {
      const id = taskIdCounter.next();
      const now = Date.now();
      const task: TaskFile = {
        id,
        subject: input.subject,
        description: input.description,
        activeForm: input.activeForm,
        status: "pending",
        blocks: [],
        blockedBy: [],
        createdAt: now,
        updatedAt: now,
        metadata: input.metadata,
      };
      // Also create in runtime for dependency tracking
      runtime.ensureTask({
        id,
        goal: input.subject,
        status: "pending",
        artifacts: input.activeForm ? { activeForm: input.activeForm } : undefined,
      });
      await persistTask(task);
      return task;
    },

    async getTask(taskId): Promise<TaskFile | null> {
      // Check cache first
      const cached = taskCache.get(taskId);
      if (cached) return { ...cached };
      // Try disk
      const task = await readJson<TaskFile>(taskFilePath(taskId));
      if (task) {
        taskCache.set(taskId, task);
        return { ...task };
      }
      return null;
    },

    async updateTask(taskId, patch): Promise<TaskFile | null> {
      const task = taskCache.get(taskId) ??
        await readJson<TaskFile>(taskFilePath(taskId));
      if (!task) return null;

      // Handle delete
      if (patch.status === "deleted") {
        taskCache.delete(taskId);
        try {
          await fs().remove(taskFilePath(taskId));
        } catch { /* may not exist */ }
        return null;
      }

      const now = Date.now();
      if (patch.status) task.status = patch.status;
      if (patch.subject !== undefined) task.subject = patch.subject;
      if (patch.description !== undefined) task.description = patch.description;
      if (patch.activeForm !== undefined) task.activeForm = patch.activeForm;
      if (patch.owner !== undefined) task.owner = patch.owner;
      if (patch.metadata) {
        task.metadata = { ...(task.metadata ?? {}), ...patch.metadata };
        // Remove null keys
        for (const [k, v] of Object.entries(task.metadata)) {
          if (v === null) delete task.metadata[k];
        }
      }

      // Handle dependency updates
      if (patch.addBlocks) {
        for (const blockedId of patch.addBlocks) {
          const blocked = taskCache.get(blockedId);
          if (blocked && !blocked.blockedBy.includes(taskId)) {
            blocked.blockedBy.push(taskId);
            blocked.updatedAt = now;
            await persistTask(blocked);
          }
          if (!task.blocks.includes(blockedId)) {
            task.blocks.push(blockedId);
          }
        }
      }
      if (patch.addBlockedBy) {
        for (const blockerId of patch.addBlockedBy) {
          if (!task.blockedBy.includes(blockerId)) {
            task.blockedBy.push(blockerId);
          }
          const blocker = taskCache.get(blockerId);
          if (blocker && !blocker.blocks.includes(taskId)) {
            blocker.blocks.push(taskId);
            blocker.updatedAt = now;
            await persistTask(blocker);
          }
        }
      }

      task.updatedAt = now;

      // Sync to runtime (skip assignee if not a registered member)
      const runtimeStatus = toRuntimeStatus(task.status);
      const memberIds = new Set(runtime.listMembers().map((m) => m.id));
      runtime.ensureTask({
        id: taskId,
        goal: task.subject,
        status: runtimeStatus,
        assigneeMemberId: task.owner && memberIds.has(task.owner)
          ? task.owner
          : undefined,
        dependencies: task.blockedBy,
        artifacts: task.activeForm ? { activeForm: task.activeForm } : undefined,
      });

      await persistTask(task);
      return { ...task };
    },

    async listTasks(): Promise<TaskFile[]> {
      return [...taskCache.values()].sort(
        (a, b) => parseInt(a.id) - parseInt(b.id),
      );
    },

    async sendMessage(msg): Promise<void> {
      const recipient = msg.recipient ?? msg.from; // fallback
      if (msg.type === "broadcast") {
        // Send to all members except sender
        const members = runtime.listMembers();
        for (const member of members) {
          if (member.id !== msg.from) {
            const inboxPath = getTeamInboxPath(teamName, member.id);
            const existing = readJsonSync<InboxMessage[]>(inboxPath) ?? [];
            existing.push({ ...msg, recipient: member.id });
            writeJsonSync(inboxPath, existing);
          }
        }
      } else {
        // DM or protocol message
        const target = msg.recipient ?? recipient;
        const inboxPath = getTeamInboxPath(teamName, target);
        const existing = readJsonSync<InboxMessage[]>(inboxPath) ?? [];
        existing.push(msg);
        writeJsonSync(inboxPath, existing);
      }

      // Also sync to runtime messaging
      const kind = msg.type === "broadcast"
        ? "broadcast" as const
        : msg.type === "shutdown_request"
        ? "shutdown_request" as const
        : msg.type === "shutdown_response"
        ? "shutdown_ack" as const
        : "direct" as const;

      try {
        runtime.sendMessage({
          fromMemberId: msg.from,
          toMemberId: msg.type === "broadcast" ? undefined : msg.recipient,
          kind,
          content: msg.content,
        });
      } catch {
        // Member might not be registered in runtime yet
      }
    },

    async readInbox(agentName): Promise<InboxMessage[]> {
      const inboxPath = getTeamInboxPath(teamName, agentName);
      const messages = await readJson<InboxMessage[]>(inboxPath);
      if (!messages || messages.length === 0) return [];
      // Clear inbox after reading
      await writeJson(inboxPath, []);
      return messages;
    },

    async cleanup(): Promise<void> {
      // Check for active members
      const active = runtime.listMembers().filter(
        (m) => m.role !== "lead" && m.status === "active",
      );
      if (active.length > 0) {
        throw new Error(
          `Cannot cleanup: ${active.length} active teammate(s). Shut them down first.`,
        );
      }
      await removeTeamDirs(teamName);
      taskCache.clear();
      taskIdCounter.reset();
      getAgentLogger().info(`Team '${teamName}' cleaned up`);
    },
  };

  // Persist initial config
  await store.persistConfig();

  return store;
}

// ── Singleton team store per session ──────────────────────────────────

let _activeStore: TeamStore | null = null;

export function getActiveTeamStore(): TeamStore | null {
  return _activeStore;
}

export function setActiveTeamStore(store: TeamStore | null): void {
  _activeStore = store;
}

export function resetTeamStoreForTests(): void {
  _activeStore = null;
}
