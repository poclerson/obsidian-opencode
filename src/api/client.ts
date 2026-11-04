import { requestUrl } from "obsidian";
import type {
  CommandInfo,
  DataResponse,
  FileSystemEntry,
  LocationDataResponse,
  MessagesResponse,
  ModelInfo,
  ModelRef,
  PermissionRequest,
  ProviderInfo,
  ServerInfo,
  SessionInfo,
  SessionsResponse,
  FileAttachmentInput,
} from "./types";

export interface ClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  workspaceDirectory: string;
}

type QueryValue = string | number | boolean | undefined;

interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  auth?: boolean;
}

export class OpenCodeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body = "",
  ) {
    super(message);
    this.name = "OpenCodeApiError";
  }
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.append(key, String(value));
  }
  const result = params.toString();
  return result ? `?${result}` : "";
}

function describeError(status: number, text: string): string {
  let serverMessage = "";
  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown; _tag?: unknown };
    if (typeof parsed.message === "string") serverMessage = parsed.message;
    else if (typeof parsed.error === "string") serverMessage = parsed.error;
    else if (typeof parsed._tag === "string") serverMessage = parsed._tag;
  } catch {
    serverMessage = text.slice(0, 300);
  }

  if (status === 401) return "Authentication failed. Pair again or check the server password.";
  if (status === 403) return `Permission denied${serverMessage ? `: ${serverMessage}` : ""}.`;
  if (status === 404) return `Not found${serverMessage ? `: ${serverMessage}` : ""}.`;
  if (status === 503) return "The OpenCode service is not ready. Try again in a moment.";
  return serverMessage || `Request failed with HTTP ${status}.`;
}

export class OpenCodeClient {
  readonly baseUrl: string;
  private readonly authorization: string;

  constructor(readonly options: ClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.authorization = basicAuth(options.username || "opencode", options.password);
  }

  get directory(): string {
    return this.options.workspaceDirectory.trim();
  }

  private locationQuery(): Record<string, QueryValue> {
    return this.directory ? { "location[directory]": this.directory } : {};
  }

  private async send<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.auth !== false) headers.Authorization = this.authorization;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    const response = await requestUrl({
      url: `${this.baseUrl}${path}${buildQuery(options.query)}`,
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new OpenCodeApiError(describeError(response.status, response.text), response.status, response.text);
    }

    if (!response.text.trim()) return undefined as T;
    try {
      return JSON.parse(response.text) as T;
    } catch {
      throw new OpenCodeApiError("The OpenCode server returned invalid JSON.", response.status, response.text);
    }
  }

  info(): Promise<ServerInfo> {
    return this.send<ServerInfo>("GET", "/api/info");
  }

  models(): Promise<LocationDataResponse<ModelInfo[]>> {
    return this.send("GET", "/api/model", { query: { ...this.locationQuery(), types: "chat" } });
  }

  providers(): Promise<LocationDataResponse<ProviderInfo[]>> {
    return this.send("GET", "/api/provider", { query: this.locationQuery() });
  }

  commands(): Promise<LocationDataResponse<CommandInfo[]>> {
    return this.send("GET", "/api/command", { query: this.locationQuery() });
  }

  sessions(limit = 50): Promise<SessionsResponse> {
    const directory = this.directory;
    return this.send("GET", "/api/session", {
      query: {
        limit,
        order: "desc",
        parentID: "null",
        ...(directory ? { directory } : {}),
      },
    });
  }

  session(sessionID: string): Promise<DataResponse<SessionInfo>> {
    return this.send("GET", `/api/session/${encodeURIComponent(sessionID)}`);
  }

  createSession(input: { title?: string; model?: ModelRef }): Promise<DataResponse<SessionInfo>> {
    return this.send("POST", "/api/session", {
      body: {
        ...(input.title ? { title: input.title } : {}),
        ...(this.directory ? { location: { directory: this.directory } } : {}),
        ...(input.model ? { model: input.model } : {}),
      },
    });
  }

  async messages(sessionID: string, limit = 200): Promise<MessagesResponse> {
    // The API pages from the requested end, so ask for the newest page and flip
    // it back to chronological order for the transcript view.
    const response = await this.send<MessagesResponse>(
      "GET",
      `/api/session/${encodeURIComponent(sessionID)}/message`,
      { query: { order: "desc", limit } },
    );
    response.data = [...(response.data ?? [])].reverse();
    return response;
  }

  prompt(
    sessionID: string,
    input: { text: string; files?: FileAttachmentInput[] },
  ): Promise<unknown> {
    return this.send("POST", `/api/session/${encodeURIComponent(sessionID)}/prompt`, {
      body: {
        text: input.text,
        ...(input.files?.length ? { files: input.files } : {}),
      },
    });
  }

  command(
    sessionID: string,
    input: { name: string; text: string; files?: FileAttachmentInput[] },
  ): Promise<void> {
    return this.send("POST", `/api/session/${encodeURIComponent(sessionID)}/command`, {
      body: {
        name: input.name,
        text: input.text,
        ...(input.files?.length ? { files: input.files } : {}),
      },
    });
  }

  switchModel(sessionID: string, model: ModelRef): Promise<void> {
    return this.send("POST", `/api/session/${encodeURIComponent(sessionID)}/model`, {
      body: { model },
    });
  }

  interrupt(sessionID: string): Promise<unknown> {
    return this.send("POST", `/api/session/${encodeURIComponent(sessionID)}/interrupt`);
  }

  compact(sessionID: string): Promise<unknown> {
    return this.send("POST", `/api/session/${encodeURIComponent(sessionID)}/compact`, {
      // The endpoint requires an object body even though every field is optional.
      body: {},
    });
  }

  activeSessions(): Promise<DataResponse<Record<string, { type: "running" }>>> {
    return this.send("GET", "/api/session/active");
  }

  permissions(sessionID: string): Promise<DataResponse<PermissionRequest[]>> {
    return this.send("GET", `/api/session/${encodeURIComponent(sessionID)}/permission`);
  }

  replyPermission(
    sessionID: string,
    requestID: string,
    decision: "once" | "always" | "reject",
  ): Promise<void> {
    return this.send(
      "POST",
      `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`,
      { body: { decision } },
    );
  }

  findFiles(query: string, limit = 24): Promise<LocationDataResponse<FileSystemEntry[]>> {
    return this.send("GET", "/api/fs/find", {
      query: { ...this.locationQuery(), query, type: "file", limit },
    });
  }
}

/**
 * Redeems an `opencode pair` link. This endpoint is intentionally unauthenticated:
 * the one-time code is the credential, and the response token becomes the Basic
 * auth password used for every later request.
 */
export async function redeemPairingCode(serverUrl: string, code: string): Promise<string> {
  const base = normalizeBaseUrl(serverUrl);
  const response = await requestUrl({
    url: `${base}/auth/connect/${encodeURIComponent(code)}`,
    method: "GET",
    headers: { Accept: "application/json" },
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new OpenCodeApiError(describeError(response.status, response.text), response.status, response.text);
  }
  const parsed = (() => {
    try {
      return JSON.parse(response.text) as { token?: unknown };
    } catch {
      throw new OpenCodeApiError(
        "The pairing response was not valid JSON.",
        response.status,
        response.text,
      );
    }
  })();
  if (typeof parsed.token !== "string" || !parsed.token) {
    throw new OpenCodeApiError("The pairing response did not include a token.", response.status, response.text);
  }
  return parsed.token;
}
