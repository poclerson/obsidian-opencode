export interface ModelRef {
  id: string;
  providerID: string;
  variant?: string;
}

export interface ModelVariant {
  id: string;
  settings?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface ModelInfo {
  id: string;
  modelID: string;
  providerID: string;
  canonical?: string;
  type?: string;
  family?: string;
  name: string;
  capabilities?: {
    tools: boolean;
    input: string[];
    output: string[];
    temperature?: boolean;
  };
  variants: ModelVariant[];
  time?: { released: number };
  cost?: Array<{
    input: number;
    output: number;
    cache: { read: number; write: number };
  }>;
  status?: string;
  enabled?: boolean;
  limit?: { context: number; input?: number; output: number };
}

export interface ProviderInfo {
  id: string;
  name: string;
  activation?: "auto" | "enabled" | "disabled";
}

export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  mode?: "subagent" | "primary" | "all";
  hidden?: boolean;
  model?: ModelRef;
}

export interface CommandInfo {
  name: string;
  description?: string;
}

export interface SessionInfo {
  id: string;
  parentID?: string;
  projectID: string;
  title?: string;
  agent?: string;
  model?: ModelRef;
  cost?: number;
  time: {
    created: number;
    updated?: number;
    busy?: number;
    idle?: number;
    archived?: number;
  };
  location?: { directory: string };
  outcome?: "succeeded" | "failed" | "interrupted";
}

export interface PromptMention {
  start: number;
  end: number;
  text: string;
}

export interface FileAttachmentInput {
  uri: string;
  name?: string;
  description?: string;
  mention?: PromptMention;
}

/**
 * Attachments returned on user messages. Newer servers describe the source
 * explicitly, while older/simple payloads may carry a top-level `uri`.
 */
export interface FileAttachment {
  uri?: string;
  data?: string;
  mime?: string;
  source?: { type: "inline" } | { type: "uri"; uri: string };
  name?: string;
  description?: string;
  mention?: PromptMention;
}

export interface FileSystemEntry {
  path: string;
  type: "file" | "directory";
}

export interface StructuredError {
  type: string;
  message: string;
  status?: number;
  retryAfterMs?: number;
}

export interface ToolContentText {
  type: "text";
  text: string;
}

export interface ToolContentFile {
  type: "file";
  uri: string;
  mime: string;
  name?: string | null;
}

export type ToolContent = ToolContentText | ToolContentFile;

export type ToolState =
  | { status: "streaming"; input: string }
  | { status: "running"; input: Record<string, unknown>; metadata?: Record<string, unknown> }
  | {
      status: "completed";
      input: Record<string, unknown>;
      content: ToolContent[];
      metadata?: Record<string, unknown>;
    }
  | {
      status: "error";
      input: Record<string, unknown>;
      error: StructuredError;
      content?: ToolContent[];
      metadata?: Record<string, unknown>;
    };

export interface AssistantTextPart {
  type: "text";
  text: string;
  time?: { created?: number; completed?: number };
}

export interface AssistantReasoningPart {
  type: "reasoning";
  text: string;
  time?: { created?: number; completed?: number };
}

export interface AssistantToolPart {
  type: "tool";
  id: string;
  name: string;
  executed?: boolean;
  state: ToolState;
  time?: { created?: number; ran?: number; completed?: number };
}

export type AssistantContent = AssistantTextPart | AssistantReasoningPart | AssistantToolPart;

export interface MessageBase {
  id: string;
  type: string;
  time: { created: number; [key: string]: number | undefined };
  metadata?: Record<string, unknown>;
}

export interface UserMessage extends MessageBase {
  type: "user";
  text: string;
  files?: FileAttachment[];
  agents?: Array<{ name: string; mention?: PromptMention }>;
  skills?: Array<{ id: string; name: string; text?: string; mention?: PromptMention }>;
}

export interface AssistantMessage extends MessageBase {
  type: "assistant";
  agent?: string;
  model?: ModelRef;
  content: AssistantContent[];
  finish?: string;
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  error?: StructuredError;
  retry?: { attempt: number; at: number; error: StructuredError };
}

export interface IdleMessage extends MessageBase {
  type: "idle";
  outcome: "succeeded" | "failed" | "interrupted";
  error?: StructuredError;
}

export interface SystemMessage extends MessageBase {
  type: "system";
  text: string;
  description?: string;
}

export interface SyntheticMessage extends MessageBase {
  type: "synthetic";
  text: string;
  description?: string;
}

export interface CompactionMessage extends MessageBase {
  type: "compaction";
  status: "running" | "completed" | "failed";
  reason?: "auto" | "manual";
  summary?: string;
  error?: StructuredError;
}

export interface ShellMessage extends MessageBase {
  type: "shell";
  command: string;
  status: "running" | "exited" | "timeout" | "killed";
  exit?: number;
  output?: { output: string; cursor: number; size: number; truncated: boolean };
}

export interface SkillMessage extends MessageBase {
  type: "skill";
  skill: string;
  name: string;
  text: string;
}

export interface SwitchedMessage extends MessageBase {
  type: "model-switched" | "agent-switched" | "location-switched";
  model?: ModelRef;
  previous?: ModelRef;
  agent?: string;
  location?: { directory: string };
}

/**
 * Known message shapes. The server may add new types; the view renders those as a
 * neutral system line after a narrow cast at the boundary.
 */
export type SessionMessage =
  | UserMessage
  | AssistantMessage
  | IdleMessage
  | SystemMessage
  | SyntheticMessage
  | CompactionMessage
  | ShellMessage
  | SkillMessage
  | SwitchedMessage;

export interface PermissionRequest {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  metadata?: Record<string, unknown>;
  source?: Record<string, unknown>;
  message?: string;
}

export interface ServerInfo {
  version: string;
  pid: number;
  hostname?: string | null;
  urls: string[];
  paths: { tmp: string };
}

export interface LocationInfo {
  directory: string;
  project?: { id: string; directory: string; canonical: string };
}

export interface MessagesResponse {
  data: SessionMessage[];
  cursor?: { previous?: string | null; next?: string | null };
}

export interface SessionsResponse {
  data: SessionInfo[];
  cursor?: { previous?: string | null; next?: string | null };
}

export interface DataResponse<T> {
  data: T;
}

export interface LocationDataResponse<T> {
  location: { directory: string };
  data: T;
}
