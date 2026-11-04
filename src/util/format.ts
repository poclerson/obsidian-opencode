import type {
  FileAttachment,
  ModelInfo,
  ModelRef,
  SessionMessage,
  SessionInfo,
  ToolContent,
} from "../api/types";

export function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatTokens(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "0";
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

export function formatCost(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return "";
  if (value < 0.0001) return "<$0.0001";
  return `$${value.toFixed(value < 0.01 ? 4 : value < 1 ? 3 : 2)}`;
}

export function truncate(value: string, max = 4000): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n… (${value.length - max} more characters)`;
}

export function modelLabel(model: ModelInfo): string {
  return model.name || model.modelID || model.id;
}

export function modelRefLabel(ref: ModelRef | undefined, models: ModelInfo[]): string {
  if (!ref) return "";
  const model = models.find((item) => item.id === ref.id && item.providerID === ref.providerID);
  return model ? modelLabel(model) : ref.id;
}

export function titleForSession(session: SessionInfo): string {
  const title = session.title?.trim();
  if (title) return title;
  const suffix = session.id.replace(/^ses_/, "").slice(0, 6);
  return `Session ${suffix}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
}

export function attachmentUri(file: FileAttachment): string {
  if (file.uri) return file.uri;
  return file.source?.type === "uri" ? file.source.uri : "";
}

function toolContentSignature(content: ToolContent[] | undefined): string {
  if (!content?.length) return "";
  return content
    .map((item) => (item.type === "text" ? `t${item.text.length}:${item.text.slice(-30)}` : `f${item.uri}`))
    .join(",");
}

/**
 * A cheap revision string for one message. Deliberately excludes base64 attachment
 * data so polling a session with images stays inexpensive.
 */
export function messageSignature(message: SessionMessage): string {
  const parts: string[] = [message.id, message.type];

  if (message.type === "user") {
    parts.push(message.text);
    for (const file of message.files ?? []) parts.push(attachmentUri(file), file.name ?? "");
  } else if (message.type === "assistant") {
    for (const content of message.content) {
      if (content.type === "text" || content.type === "reasoning") {
        parts.push(content.type, String(content.text.length), content.text.slice(-48));
      } else {
        parts.push(
          content.id,
          content.state.status,
          JSON.stringify(content.state.input).slice(0, 120),
          toolContentSignature("content" in content.state ? content.state.content : undefined),
        );
      }
    }
    if (message.error) parts.push("error", message.error.message);
    if (message.retry) parts.push("retry", String(message.retry.attempt));
    parts.push(message.finish ?? "");
  } else if (message.type === "idle") {
    parts.push(message.outcome, message.error?.message ?? "");
  } else if (message.type === "compaction") {
    parts.push(message.status, message.summary ?? "", message.error?.message ?? "");
  } else if (message.type === "shell") {
    parts.push(message.status, message.command, message.output?.output.slice(-48) ?? "");
  } else if (message.type === "system" || message.type === "synthetic") {
    parts.push(message.text);
  } else if (message.type === "skill") {
    parts.push(message.name, message.text);
  } else if (message.type === "model-switched") {
    parts.push(message.model?.providerID ?? "", message.model?.id ?? "", message.model?.variant ?? "");
  } else {
    parts.push(hashString(JSON.stringify(message)));
  }

  return hashString(parts.join("|"));
}
