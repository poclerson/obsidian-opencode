import { Component, ItemView, MarkdownRenderer, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import type OpenCodePlugin from "../main";
import { normalizeBaseUrl, OpenCodeApiError, OpenCodeClient } from "../api/client";
import type {
  AssistantMessage,
  AssistantReasoningPart,
  AssistantToolPart,
  CommandInfo,
  FileAttachmentInput,
  FileSystemEntry,
  ModelInfo,
  ModelRef,
  PermissionRequest,
  ServerInfo,
  SessionInfo,
  SessionMessage,
  UserMessage,
} from "../api/types";
import { VIEW_TYPE_OPENCODE } from "../constants";
import {
  attachmentUri,
  errorMessage,
  formatCost,
  formatRelativeTime,
  formatTokens,
  messageSignature,
  modelRefLabel,
  titleForSession,
  truncate,
} from "../util/format";
import { mentionContext, insertMention, mentionForText, type MentionContext } from "../util/mention";
import { baseName, fileUri } from "../util/path";
import {
  commandInsertion,
  filterCommands,
  parseInvocation,
  slashContext,
  type SlashContext,
} from "../util/slash";

interface Attachment {
  path: string;
  uri: string;
  name: string;
}

interface PopupState<T> {
  context: SlashContext | MentionContext;
  items: T[];
  index: number;
}

interface BannerAction {
  label: string;
  cta?: boolean;
  action: () => void;
}

const LOCAL_COMMANDS: CommandInfo[] = [
  { name: "new", description: "Start a new session" },
  { name: "stop", description: "Interrupt the current run" },
  { name: "model", description: "Focus the model picker" },
  { name: "effort", description: "Focus the reasoning effort picker" },
  { name: "sessions", description: "Focus the session picker" },
  { name: "compact", description: "Compact the conversation context" },
  { name: "settings", description: "Open OpenCode settings" },
  { name: "help", description: "Show commands and shortcuts" },
];

const EFFORT_LABELS: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

export class ChatView extends ItemView {
  private client: OpenCodeClient | null = null;
  private generation = 0;
  private connected = false;
  private connecting = false;
  private connectionError = "";
  private serverInfo: ServerInfo | null = null;

  private sessions: SessionInfo[] = [];
  private session: SessionInfo | null = null;
  private messages: SessionMessage[] = [];
  private permissions: PermissionRequest[] = [];
  private models: ModelInfo[] = [];
  private providers = new Map<string, string>();
  private commands: CommandInfo[] = [];
  private modelChoice: ModelRef | null = null;
  private resolvedDirectory = "";

  private attachments: Attachment[] = [];
  private busy = false;
  private sending = false;
  private lastPollAt = 0;
  private lastSessionsPoll = 0;
  private pollInFlight = false;
  private messageOrder = "";
  private messageNodes = new Map<string, HTMLElement>();
  private messageSigs = new Map<string, string>();
  private messageComponents = new Map<string, Component>();
  private replying = new Set<string>();

  private slashMenu: PopupState<CommandInfo> | null = null;
  private mentionMenu: PopupState<FileSystemEntry> | null = null;
  private mentionRequest = 0;
  private mentionTimer: number | null = null;
  private mentionLoading = false;

  private statusEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private sessionSelect!: HTMLSelectElement;
  private messagesEl!: HTMLElement;
  private permissionsEl!: HTMLElement;
  private chipsEl!: HTMLElement;
  private popupEl!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private modelSelect!: HTMLSelectElement;
  private effortSelect!: HTMLSelectElement;
  private sendButton!: HTMLButtonElement;
  private typingEl: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: OpenCodePlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_OPENCODE;
  }

  getDisplayText(): string {
    return "OpenCode";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    this.plugin.registerViewInstance(this);
    this.contentEl.empty();
    this.contentEl.addClass("opencode-view");
    this.buildSkeleton();
    this.registerInterval(window.setInterval(() => this.pollTick(), 500));
    await this.connect();
  }

  async onClose(): Promise<void> {
    this.cancelMentionSearch();
    this.plugin.unregisterViewInstance(this);
    this.unloadMessageComponents();
    this.messageNodes.clear();
    this.messageSigs.clear();
  }

  /** Called by the plugin after settings change or pairing. */
  reloadSettings(): void {
    this.generation++;
    this.client = null;
    this.connected = false;
    this.connecting = false;
    this.serverInfo = null;
    this.sessions = [];
    this.session = null;
    this.messages = [];
    this.permissions = [];
    this.models = [];
    this.commands = [];
    this.messageOrder = "";
    this.messageNodes.clear();
    this.messageSigs.clear();
    this.unloadMessageComponents();
    this.typingEl = null;
    this.attachments = [];
    this.hideBanner();
    this.hidePopups();
    this.setStatus("disconnected");
    this.messagesEl.empty();
    this.permissionsEl.empty();
    this.renderChips();
    this.renderEmptyState();
    void this.connect();
  }

  /** Re-renders display settings without reconnecting or losing the session. */
  rerender(): void {
    this.renderModelOptions();
    this.renderEffortOptions();
    this.renderSessionOptions();
    this.renderChips();
    this.renderPermissions();
    this.renderSendButton();
    this.renderMessages(true);
  }

  private buildSkeleton(): void {
    const header = this.contentEl.createDiv({ cls: "opencode-header" });

    const titleRow = header.createDiv({ cls: "opencode-title-row" });
    const brand = titleRow.createDiv({ cls: "opencode-brand" });
    const logo = brand.createSpan({ cls: "opencode-logo" });
    setIcon(logo, "bot");
    brand.createSpan({ cls: "opencode-brand-text", text: "OpenCode" });
    this.statusEl = brand.createSpan({ cls: "opencode-status" });

    const actions = titleRow.createDiv({ cls: "opencode-actions" });
    this.iconButton(actions, "plus", "New session", () => void this.newSession());
    this.iconButton(actions, "refresh-cw", "Refresh", () => void this.refresh());
    this.iconButton(actions, "settings", "OpenCode settings", () => this.openSettings());

    const sessionRow = header.createDiv({ cls: "opencode-session-row" });
    this.sessionSelect = sessionRow.createEl("select", {
      cls: "dropdown opencode-select opencode-session-select",
    });
    this.sessionSelect.setAttribute("aria-label", "Session");
    this.sessionSelect.addEventListener("change", () => {
      const value = this.sessionSelect.value;
      if (value === "__new__") {
        void this.newSession();
        return;
      }
      const session = this.sessions.find((item) => item.id === value);
      if (session) void this.selectSession(session);
    });

    this.bannerEl = this.contentEl.createDiv({ cls: "opencode-banner is-hidden" });

    this.messagesEl = this.contentEl.createDiv({ cls: "opencode-messages" });
    this.messagesEl.addEventListener("scroll", () => {
      // Scrolling is handled by renderMessages; this listener keeps mobile momentum smooth.
    });

    this.permissionsEl = this.contentEl.createDiv({ cls: "opencode-permissions" });

    const composer = this.contentEl.createDiv({ cls: "opencode-composer" });
    this.chipsEl = composer.createDiv({ cls: "opencode-chips is-hidden" });

    const inputWrap = composer.createDiv({ cls: "opencode-input-wrap" });
    this.popupEl = inputWrap.createDiv({ cls: "opencode-popup is-hidden" });
    this.textarea = inputWrap.createEl("textarea", {
      cls: "opencode-input",
      attr: {
        rows: "1",
        placeholder: "Ask OpenCode…  / commands  @ files",
        "aria-label": "Message OpenCode",
      },
    });
    this.textarea.addEventListener("input", () => this.onInput());
    this.textarea.addEventListener("keydown", (event) => this.onKeyDown(event));
    this.textarea.addEventListener("blur", () => {
      // Let a menu click win before the popup disappears.
      window.setTimeout(() => this.hidePopups(), 150);
    });

    const controls = composer.createDiv({ cls: "opencode-controls" });
    const pickers = controls.createDiv({ cls: "opencode-pickers" });

    const modelPicker = pickers.createEl("label", { cls: "opencode-picker" });
    modelPicker.createSpan({ cls: "opencode-picker-label", text: "Model" });
    this.modelSelect = modelPicker.createEl("select", {
      cls: "dropdown opencode-select opencode-model-select",
    });
    this.modelSelect.setAttribute("aria-label", "Model");
    this.modelSelect.addEventListener("change", () => void this.onModelChange());

    const effortPicker = pickers.createEl("label", { cls: "opencode-picker" });
    effortPicker.createSpan({ cls: "opencode-picker-label", text: "Effort" });
    this.effortSelect = effortPicker.createEl("select", {
      cls: "dropdown opencode-select opencode-effort-select",
    });
    this.effortSelect.setAttribute("aria-label", "Reasoning effort");
    this.effortSelect.addEventListener("change", () => void this.onEffortChange());

    this.sendButton = controls.createEl("button", {
      cls: "opencode-send mod-cta",
      attr: { "aria-label": "Send message" },
    });
    this.sendButton.addEventListener("click", () => {
      if (this.busy) void this.stop();
      else void this.send();
    });

    this.setStatus("disconnected");
    this.renderSendButton();
    this.renderModelOptions();
    this.renderEffortOptions();
    this.renderSessionOptions();
    this.renderChips();
    this.renderEmptyState();
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "opencode-icon-button",
      attr: { "aria-label": label, title: label },
    });
    setIcon(button, icon);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      onClick();
    });
    return button;
  }

  private async connect(): Promise<void> {
    const generation = ++this.generation;
    const settings = this.plugin.settings;
    this.hideBanner();

    if (!settings.serverUrl.trim() || !settings.password.trim()) {
      this.connected = false;
      this.setStatus("disconnected");
      this.showBanner(
        "Connect Obsidian to your OpenCode server. Run `opencode pair` on the server, then paste the link here.",
        [
          { label: "Pair", cta: true, action: () => this.plugin.openPairModal() },
          { label: "Settings", action: () => this.openSettings() },
        ],
        "info",
      );
      this.renderEmptyState();
      return;
    }

    this.connecting = true;
    this.setStatus("connecting");
    this.client = new OpenCodeClient({
      baseUrl: normalizeBaseUrl(settings.serverUrl),
      username: settings.username || "opencode",
      password: settings.password,
      workspaceDirectory: settings.workspaceDirectory,
    });

    try {
      const info = await this.client.info();
      if (generation !== this.generation) return;
      this.serverInfo = info;
      this.connected = true;
      this.connectionError = "";
      this.setStatus("connected");

      await Promise.all([this.loadCatalog(), this.loadSessions()]);
      if (generation !== this.generation) return;

      const restored = await this.restoreSession();
      if (generation !== this.generation) return;

      if (restored) await this.selectSession(restored, true, false);
      else {
        this.renderSessionOptions();
        this.renderEmptyState();
      }
      this.hideBanner();
    } catch (error) {
      if (generation !== this.generation) return;
      this.connected = false;
      this.connectionError = this.describeError(error);
      this.setStatus("error");
      this.showBanner(this.connectionError, [
        { label: "Retry", cta: true, action: () => void this.connect() },
        { label: "Pair", action: () => this.plugin.openPairModal() },
        { label: "Settings", action: () => this.openSettings() },
      ]);
      this.renderEmptyState();
    } finally {
      if (generation === this.generation) this.connecting = false;
    }
  }

  private async loadCatalog(): Promise<void> {
    if (!this.client) return;
    const [models, providers, commands] = await Promise.all([
      this.client.models(),
      this.client.providers().catch(() => undefined),
      this.client.commands().catch(() => undefined),
    ]);

    if (models.location?.directory) this.resolvedDirectory = models.location.directory;
    this.models = (models.data ?? [])
      .filter((model) => model.enabled !== false && (model.type ?? "chat") === "chat")
      .sort((a, b) => a.name.localeCompare(b.name));

    this.providers.clear();
    for (const provider of providers?.data ?? []) this.providers.set(provider.id, provider.name);

    this.commands = commands?.data ?? [];
    this.renderModelOptions();
    this.renderEffortOptions();
    this.allCommands();
  }

  private async loadSessions(): Promise<void> {
    if (!this.client) return;
    const response = await this.client.sessions(50);
    this.sessions = response.data ?? [];
    this.lastSessionsPoll = Date.now();
    this.renderSessionOptions();
  }

  private async restoreSession(): Promise<SessionInfo | null> {
    const last = this.plugin.settings.lastSessionID;
    if (last) {
      const existing = this.sessions.find((session) => session.id === last);
      if (existing) return existing;
      try {
        const fetched = await this.client?.session(last);
        if (fetched?.data) {
          this.sessions.unshift(fetched.data);
          return fetched.data;
        }
      } catch {
        // The session may have been deleted; fall through to the newest session.
      }
    }
    return this.sessions[0] ?? null;
  }

  private async selectSession(
    session: SessionInfo,
    loadMessages = true,
    remember = true,
  ): Promise<void> {
    this.session = session;
    this.messages = [];
    this.permissions = [];
    this.attachments = [];
    this.busy = false;
    this.messageOrder = "";
    this.messageNodes.clear();
    this.messageSigs.clear();
    this.unloadMessageComponents();
    this.typingEl = null;
    this.modelChoice = session.model ?? this.plugin.settings.lastModel ?? null;
    this.renderSessionOptions(true);
    this.renderModelOptions(true);
    this.renderEffortOptions(true);
    this.renderChips();
    this.renderPermissions();
    this.renderSendButton();
    this.renderMessages(true);
    this.lastPollAt = 0;

    if (remember) {
      this.plugin.settings.lastSessionID = session.id;
      void this.plugin.saveSettings();
    }

    if (loadMessages) {
      try {
        await this.loadMessages();
      } catch (error) {
        new Notice(`Could not load messages: ${this.describeError(error)}`);
      }
    }
    this.renderMessages(true);
    void this.pollNow(true);
  }

  private async loadMessages(): Promise<void> {
    if (!this.client || !this.session) return;
    const response = await this.client.messages(this.session.id, 200);
    this.messages = response.data ?? [];
  }

  private async refresh(): Promise<void> {
    if (!this.connected) {
      await this.connect();
      return;
    }
    try {
      await Promise.all([this.loadCatalog(), this.loadSessions()]);
      if (this.session) {
        const updated = this.sessions.find((item) => item.id === this.session?.id);
        if (updated) this.session = updated;
        await this.loadMessages();
        this.renderModelOptions();
        this.renderEffortOptions();
        this.renderSessionOptions();
        this.renderMessages(true);
      } else {
        this.renderEmptyState();
      }
      void this.pollNow(true);
    } catch (error) {
      new Notice(`Refresh failed: ${this.describeError(error)}`);
    }
  }

  private pollTick(): void {
    if (!this.connected || !this.client || !this.session) {
      // Still refresh the empty state if a stale banner is showing.
      return;
    }
    if (!this.containerEl.isShown()) return;
    const interval = this.busy ? this.plugin.settings.pollIntervalMs : 15000;
    if (Date.now() - this.lastPollAt < interval) return;
    void this.pollNow();
  }

  private async pollNow(force = false): Promise<void> {
    if (!this.client || !this.session || this.pollInFlight) return;
    if (!force && !this.containerEl.isShown()) return;

    const sessionID = this.session.id;
    const generation = this.generation;
    this.pollInFlight = true;
    this.lastPollAt = Date.now();

    try {
      const [messages, active, permissions] = await Promise.allSettled([
        this.client.messages(sessionID, 200),
        this.client.activeSessions(),
        this.client.permissions(sessionID),
      ]);

      if (generation !== this.generation || this.session?.id !== sessionID) return;

      let changed = false;

      if (messages.status === "fulfilled") {
        const next = messages.value.data ?? [];
        const signature = next.map(messageSignature).join("|");
        const current = this.messages.map(messageSignature).join("|");
        if (signature !== current) {
          this.messages = next;
          changed = true;
        }
      } else if (messages.reason instanceof OpenCodeApiError && messages.reason.status === 404) {
        this.session = null;
        this.messages = [];
        this.busy = false;
        this.plugin.settings.lastSessionID = null;
        void this.plugin.saveSettings();
        void this.loadSessions();
        changed = true;
      }

      if (active.status === "fulfilled") {
        const running = active.value.data?.[sessionID]?.type === "running";
        if (running !== this.busy) {
          this.busy = running;
          this.renderSendButton();
          changed = true;
        }
      }

      if (permissions.status === "fulfilled") {
        const next = permissions.value.data ?? [];
        const before = this.permissions.map((item) => item.id).join("|");
        const after = next.map((item) => item.id).join("|");
        if (before !== after) {
          this.permissions = next;
          this.renderPermissions();
          changed = true;
        }
      }

      if (changed) this.renderMessages(false);
      if (this.busy) this.updateTyping();

      if (Date.now() - this.lastSessionsPoll > 10000) {
        this.lastSessionsPoll = Date.now();
        this.loadSessions().catch(() => undefined);
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  async newSession(): Promise<void> {
    if (!this.client || !this.connected) {
      new Notice("Connect to an OpenCode server first.");
      return;
    }
    try {
      const model = this.currentModelRef() ?? undefined;
      const response = await this.client.createSession({ model });
      const session = response.data;
      this.sessions.unshift(session);
      this.renderSessionOptions(true);
      await this.selectSession(session);
      this.textarea.focus();
    } catch (error) {
      new Notice(`Could not create a session: ${this.describeError(error)}`);
    }
  }

  private async ensureSession(): Promise<SessionInfo | null> {
    if (this.session) return this.session;
    if (!this.client || !this.connected) return null;
    try {
      const response = await this.client.createSession({ model: this.currentModelRef() ?? undefined });
      const session = response.data;
      this.sessions.unshift(session);
      this.session = session;
      this.renderSessionOptions();
      return session;
    } catch (error) {
      new Notice(`Could not create a session: ${this.describeError(error)}`);
      return null;
    }
  }

  private async send(): Promise<void> {
    if (this.sending) return;
    const text = this.textarea.value.trim();
    if (!text && this.attachments.length === 0) return;

    if (this.busy) {
      new Notice("OpenCode is still working. Stop the current run or wait for it to finish.");
      return;
    }

    const session = await this.ensureSession();
    if (!session || !this.client) {
      new Notice("Connect to an OpenCode server first.");
      return;
    }

    const invocation = parseInvocation(text);
    if (invocation) {
      const local = LOCAL_COMMANDS.find((command) => command.name === invocation.name);
      if (local) {
        await this.runLocalCommand(local.name, invocation.args);
        return;
      }
      const serverCommand = this.commands.find((command) => command.name === invocation.name);
      if (!serverCommand) {
        new Notice(`Unknown command /${invocation.name}. Type / to see available commands.`);
        return;
      }
    }

    const files = this.buildFiles(invocation ? invocation.args : text);
    this.sending = true;
    this.renderSendButton();

    try {
      if (invocation) {
        await this.client.command(session.id, {
          name: invocation.name,
          text: invocation.args,
          files,
        });
      } else {
        await this.client.prompt(session.id, { text, files });
      }

      this.textarea.value = "";
      this.attachments = [];
      this.renderChips();
      this.autoResize();
      this.hidePopups();
      this.busy = true;
      this.lastPollAt = 0;
      this.renderSendButton();
      this.updateTyping();
      window.setTimeout(() => void this.pollNow(true), 250);
      window.setTimeout(() => void this.loadSessions(), 1800);
    } catch (error) {
      new Notice(`Send failed: ${this.describeError(error)}`);
      this.busy = false;
    } finally {
      this.sending = false;
      this.renderSendButton();
    }
  }

  private buildFiles(text: string): FileAttachmentInput[] {
    const directory = this.resolvedDirectory || this.client?.directory || "";
    return this.attachments.map((attachment) => ({
      uri: attachment.uri || fileUri(directory, attachment.path),
      name: attachment.name,
      mention: mentionForText(text, attachment.path),
    }));
  }

  private async runLocalCommand(name: string, _args: string): Promise<void> {
    this.clearComposer();
    switch (name) {
      case "new":
        await this.newSession();
        break;
      case "stop":
        await this.stop();
        break;
      case "model":
        this.modelSelect.focus();
        new Notice("Choose a model below.");
        break;
      case "effort":
        this.effortSelect.focus();
        new Notice("Choose reasoning effort below.");
        break;
      case "sessions":
        this.sessionSelect.focus();
        break;
      case "compact":
        if (!this.session || !this.client) {
          new Notice("Start a session first.");
          break;
        }
        try {
          await this.client.compact(this.session.id);
          this.busy = true;
          this.renderSendButton();
          new Notice("Compacting the conversation…");
          window.setTimeout(() => void this.pollNow(true), 300);
        } catch (error) {
          new Notice(`Compact failed: ${this.describeError(error)}`);
        }
        break;
      case "settings":
        this.openSettings();
        break;
      case "help":
        new Notice(
          "Local: /new, /stop, /model, /effort, /sessions, /compact, /settings, /help. Server commands appear when you type /.",
          10000,
        );
        break;
    }
  }

  private async stop(): Promise<void> {
    if (!this.client || !this.session) return;
    try {
      await this.client.interrupt(this.session.id);
      new Notice("Stopping…");
      window.setTimeout(() => void this.pollNow(true), 400);
    } catch (error) {
      new Notice(`Stop failed: ${this.describeError(error)}`);
    }
  }

  private clearComposer(): void {
    this.textarea.value = "";
    this.attachments = [];
    this.renderChips();
    this.autoResize();
    this.hidePopups();
  }

  private onModelChange(): void {
    const value = this.modelSelect.value;
    const [providerID, ...rest] = value.split("/");
    const id = rest.join("/");
    const model = this.models.find((item) => item.providerID === providerID && item.id === id);
    if (!model) return;

    const previousVariant = this.modelChoice?.variant;
    const keepVariant =
      previousVariant && model.variants.some((variant) => variant.id === previousVariant)
        ? previousVariant
        : undefined;
    this.modelChoice = { id: model.id, providerID: model.providerID, variant: keepVariant };
    this.renderEffortOptions();
    this.persistModelChoice();
    void this.applyModelChoice();
  }

  private onEffortChange(): void {
    const model = this.currentModel();
    if (!model) return;
    const variant = this.effortSelect.value || undefined;
    this.modelChoice = { id: model.id, providerID: model.providerID, variant };
    this.persistModelChoice();
    void this.applyModelChoice();
  }

  private async applyModelChoice(): Promise<void> {
    if (!this.client || !this.session || !this.modelChoice) return;
    try {
      await this.client.switchModel(this.session.id, this.modelChoice);
      this.session.model = this.modelChoice;
      window.setTimeout(() => void this.pollNow(true), 250);
    } catch (error) {
      new Notice(`Model switch failed: ${this.describeError(error)}`);
      this.modelChoice = this.session.model ?? this.modelChoice;
      this.renderModelOptions(true);
      this.renderEffortOptions(true);
    }
  }

  private persistModelChoice(): void {
    this.plugin.settings.lastModel = this.modelChoice;
    void this.plugin.saveSettings();
  }

  private currentModelRef(): ModelRef | null {
    if (this.modelChoice) return this.modelChoice;
    const model = this.models[0];
    if (!model) return null;
    return { id: model.id, providerID: model.providerID };
  }

  private currentModel(): ModelInfo | undefined {
    const ref = this.currentModelRef();
    if (!ref) return undefined;
    return this.models.find((model) => model.id === ref.id && model.providerID === ref.providerID);
  }

  private renderModelOptions(force = false): void {
    if (!this.modelSelect) return;
    // Do not rebuild an open dropdown under the user's finger.
    if (!force && this.modelSelect === this.modelSelect.ownerDocument.activeElement) return;
    this.modelSelect.empty();
    if (this.models.length === 0) {
      this.modelSelect.createEl("option", { text: this.connected ? "No models" : "Not connected", value: "" });
      this.modelSelect.disabled = true;
      return;
    }
    this.modelSelect.disabled = false;

    const groups = new Map<string, ModelInfo[]>();
    for (const model of this.models) {
      const list = groups.get(model.providerID) ?? [];
      list.push(model);
      groups.set(model.providerID, list);
    }

    const sorted = [...groups.entries()].sort(([a], [b]) =>
      (this.providers.get(a) ?? a).localeCompare(this.providers.get(b) ?? b),
    );
    for (const [providerID, list] of sorted) {
      const group = this.modelSelect.createEl("optgroup", {
        attr: { label: this.providers.get(providerID) ?? providerID },
      });
      for (const model of list) {
        const suffix = model.status && model.status !== "active" ? ` (${model.status})` : "";
        group.createEl("option", {
          text: `${model.name || model.id}${suffix}`,
          value: `${model.providerID}/${model.id}`,
        });
      }
    }

    const ref = this.currentModelRef();
    if (ref) {
      const value = `${ref.providerID}/${ref.id}`;
      const exists = this.models.some((model) => model.providerID === ref.providerID && model.id === ref.id);
      if (exists) this.modelSelect.value = value;
      else {
        this.modelSelect.createEl("option", {
          text: `${ref.providerID}/${ref.id} (unavailable)`,
          value,
        });
        this.modelSelect.value = value;
      }
    }
  }

  private renderEffortOptions(force = false): void {
    if (!this.effortSelect) return;
    if (!force && this.effortSelect === this.effortSelect.ownerDocument.activeElement) return;
    this.effortSelect.empty();
    const model = this.currentModel();
    const variants = model?.variants ?? [];

    this.effortSelect.createEl("option", { text: "Default", value: "" });
    for (const variant of variants) {
      const reasoning =
        typeof variant.settings?.reasoningEffort === "string" ? variant.settings.reasoningEffort : undefined;
      const label =
        EFFORT_LABELS[reasoning ?? variant.id] ??
        (reasoning ?? variant.id).replace(/^./, (character) => character.toUpperCase());
      this.effortSelect.createEl("option", { text: label, value: variant.id });
    }

    const variant = this.modelChoice?.variant;
    this.effortSelect.value = variant && variants.some((item) => item.id === variant) ? variant : "";
    this.effortSelect.disabled = variants.length === 0;
    this.effortSelect.setAttribute(
      "title",
      variants.length ? "Reasoning effort (OpenCode model variant)" : "This model has no effort variants",
    );
  }

  private renderSessionOptions(force = false): void {
    if (!this.sessionSelect) return;
    if (!force && this.sessionSelect === this.sessionSelect.ownerDocument.activeElement) return;
    this.sessionSelect.empty();
    this.sessionSelect.createEl("option", { text: "＋ new session", value: "__new__" });
    if (this.sessions.length === 0) {
      this.sessionSelect.createEl("option", {
        text: this.connected ? "No sessions yet" : "Not connected",
        value: "",
      });
      this.sessionSelect.value = "__new__";
      return;
    }
    for (const session of this.sessions) {
      const updated = session.time.updated ?? session.time.created;
      this.sessionSelect.createEl("option", {
        text: `${titleForSession(session)} · ${formatRelativeTime(updated)}`,
        value: session.id,
      });
    }
    if (this.session) this.sessionSelect.value = this.session.id;
  }

  private renderChips(): void {
    if (!this.chipsEl) return;
    this.chipsEl.empty();
    this.chipsEl.toggleClass("is-hidden", this.attachments.length === 0);
    this.attachments.forEach((attachment, index) => {
      const chip = this.chipsEl.createDiv({ cls: "opencode-chip" });
      const icon = chip.createSpan({ cls: "opencode-chip-icon" });
      setIcon(icon, "file-text");
      chip.createSpan({ cls: "opencode-chip-name", text: attachment.name });
      chip.setAttribute("title", attachment.path);
      const remove = chip.createEl("button", {
        cls: "opencode-chip-remove",
        attr: { "aria-label": `Remove ${attachment.name}` },
      });
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        this.attachments.splice(index, 1);
        this.renderChips();
      });
    });
  }

  private renderPermissions(): void {
    if (!this.permissionsEl) return;
    this.permissionsEl.empty();
    this.permissionsEl.toggleClass("is-hidden", this.permissions.length === 0);
    for (const request of this.permissions) {
      const card = this.permissionsEl.createDiv({ cls: "opencode-permission" });
      const head = card.createDiv({ cls: "opencode-permission-head" });
      const icon = head.createSpan({ cls: "opencode-permission-icon" });
      setIcon(icon, "shield-alert");
      head.createSpan({ cls: "opencode-permission-title", text: `Permission: ${request.action}` });
      if (request.message) {
        card.createEl("p", { cls: "opencode-permission-message", text: request.message });
      }
      if (request.resources.length) {
        const list = card.createEl("ul", { cls: "opencode-permission-resources" });
        for (const resource of request.resources) list.createEl("li", { text: resource });
      }
      const actions = card.createDiv({ cls: "opencode-permission-actions" });
      const reply = (decision: "once" | "always" | "reject") => {
        if (!this.client || this.replying.has(request.id)) return;
        this.replying.add(request.id);
        void this.client
          .replyPermission(request.sessionID, request.id, decision)
          .then(() => {
            this.permissions = this.permissions.filter((item) => item.id !== request.id);
            this.renderPermissions();
          })
          .catch((error) => new Notice(`Permission reply failed: ${this.describeError(error)}`))
          .finally(() => this.replying.delete(request.id));
      };
      actions
        .createEl("button", { cls: "mod-cta", text: "Allow once" })
        .addEventListener("click", () => reply("once"));
      actions
        .createEl("button", { text: "Always allow" })
        .addEventListener("click", () => reply("always"));
      actions
        .createEl("button", { cls: "mod-warning", text: "Reject" })
        .addEventListener("click", () => reply("reject"));
    }
  }

  private renderSendButton(): void {
    if (!this.sendButton) return;
    this.sendButton.empty();
    setIcon(this.sendButton, this.busy ? "square" : "send");
    this.sendButton.createSpan({ text: this.busy ? "Stop" : "Send" });
    this.sendButton.toggleClass("mod-warning", this.busy);
    this.sendButton.toggleClass("mod-cta", !this.busy);
    this.sendButton.disabled = this.sending;
    this.sendButton.setAttribute("aria-label", this.busy ? "Stop OpenCode" : "Send message");
  }

  private visibleMessages(): SessionMessage[] {
    return this.messages.filter((message) => {
      if (message.type === "idle" && message.outcome === "succeeded") return false;
      return true;
    });
  }

  private renderMessages(force: boolean): void {
    if (!this.messagesEl) return;
    const list = this.visibleMessages();
    const order = list.map((message) => message.id).join("|");
    const nearBottom = this.isNearBottom();
    const before = this.messageNodes.size;
    const rebuild = force || order !== this.messageOrder;

    if (rebuild) {
      this.messagesEl.empty();
      this.unloadMessageComponents();
      this.messageNodes.clear();
      this.messageSigs.clear();
      for (const message of list) {
        const component = this.loadMessageComponent(message.id);
        const element = this.buildMessage(message, component);
        this.messagesEl.appendChild(element);
        this.messageNodes.set(message.id, element);
        this.messageSigs.set(message.id, messageSignature(message));
      }
      this.messageOrder = order;
    } else {
      for (const message of list) {
        const signature = messageSignature(message);
        if (this.messageSigs.get(message.id) === signature) continue;
        const previous = this.messageNodes.get(message.id);
        const component = this.loadMessageComponent(message.id);
        const element = this.buildMessage(message, component);
        if (previous) previous.replaceWith(element);
        else this.messagesEl.appendChild(element);
        this.messageNodes.set(message.id, element);
        this.messageSigs.set(message.id, signature);
      }
    }

    if (list.length === 0) {
      this.renderEmptyState();
    } else {
      this.messagesEl.querySelector(".opencode-empty")?.remove();
    }

    this.updateTyping();

    if (nearBottom || rebuild || list.length > before) this.scrollToBottom();
  }

  private renderEmptyState(): void {
    if (!this.messagesEl) return;
    this.messagesEl.querySelector(".opencode-empty")?.remove();
    if (this.visibleMessages().length > 0) return;

    const empty = this.messagesEl.createDiv({ cls: "opencode-empty" });
    const icon = empty.createDiv({ cls: "opencode-empty-icon" });
    setIcon(icon, "bot");

    if (!this.connected) {
      empty.createEl("h3", { text: this.connecting ? "Connecting to OpenCode…" : "Connect to OpenCode" });
      empty.createEl("p", {
        text: "OpenCode runs on your computer. Pair this device with a one-time link, then chat from the sidebar on desktop, iPhone, or iPad.",
      });
      const actions = empty.createDiv({ cls: "opencode-empty-actions" });
      actions
        .createEl("button", { cls: "mod-cta", text: "Pair with OpenCode" })
        .addEventListener("click", () => this.plugin.openPairModal());
      actions
        .createEl("button", { text: "Open settings" })
        .addEventListener("click", () => this.openSettings());
      return;
    }

    if (!this.session) {
      empty.createEl("h3", { text: "No session selected" });
      empty.createEl("p", { text: "Create a session to start talking to OpenCode." });
      const actions = empty.createDiv({ cls: "opencode-empty-actions" });
      actions
        .createEl("button", { cls: "mod-cta", text: "New session" })
        .addEventListener("click", () => void this.newSession());
      return;
    }

    empty.createEl("h3", { text: "Start the conversation" });
    empty.createEl("p", {
      text: "Type a message, use / for commands, and @ to attach files from the workspace.",
    });
    const tips = empty.createDiv({ cls: "opencode-empty-tips" });
    tips.createDiv({ text: "/ commands — run OpenCode commands and local actions" });
    tips.createDiv({ text: "@ file — add workspace files to the prompt" });
    tips.createDiv({ text: "Model + Effort — choose the model and reasoning variant" });
    if (this.serverInfo) {
      empty.createEl("p", {
        cls: "opencode-empty-server",
        text: `Connected to OpenCode ${this.serverInfo.version}`,
      });
    }
  }

  private loadMessageComponent(id: string): Component {
    this.messageComponents.get(id)?.unload();
    const component = new Component();
    component.load();
    this.messageComponents.set(id, component);
    return component;
  }

  private unloadMessageComponents(): void {
    for (const component of this.messageComponents.values()) component.unload();
    this.messageComponents.clear();
  }

  private buildMessage(message: SessionMessage, component: Component): HTMLElement {
    const element = createDiv({ cls: "opencode-msg" });
    element.dataset.messageId = message.id;

    if (message.type === "user") {
      this.buildUserMessage(element, message, component);
    } else if (message.type === "assistant") {
      this.buildAssistantMessage(element, message, component);
    } else if (message.type === "idle") {
      this.buildIdleMessage(element, message);
    } else if (message.type === "system" || message.type === "synthetic") {
      element.addClass("opencode-system");
      const icon = element.createSpan({ cls: "opencode-system-icon" });
      setIcon(icon, message.type === "system" ? "info" : "sparkles");
      element.createSpan({ text: message.text });
    } else if (message.type === "compaction") {
      this.buildCompaction(element, message);
    } else if (message.type === "shell") {
      this.buildShell(element, message);
    } else if (message.type === "skill") {
      element.addClass("opencode-system");
      const icon = element.createSpan({ cls: "opencode-system-icon" });
      setIcon(icon, "book-open");
      element.createSpan({ text: `Skill: ${message.name}` });
    } else if (message.type === "model-switched") {
      element.addClass("opencode-system");
      const icon = element.createSpan({ cls: "opencode-system-icon" });
      setIcon(icon, "cpu");
      element.createSpan({ text: `Model switched to ${modelRefLabel(message.model, this.models) || "another model"}` });
    } else if (message.type === "agent-switched") {
      element.addClass("opencode-system");
      const icon = element.createSpan({ cls: "opencode-system-icon" });
      setIcon(icon, "user-cog");
      element.createSpan({ text: `Agent switched to ${message.agent ?? "another agent"}` });
    } else {
      element.addClass("opencode-system");
      element.createSpan({ text: message.type });
    }

    return element;
  }

  private buildUserMessage(element: HTMLElement, message: UserMessage, component: Component): void {
    element.addClass("opencode-msg-user");
    const head = element.createDiv({ cls: "opencode-msg-head" });
    head.createSpan({ cls: "opencode-role", text: "You" });
    head.createSpan({ cls: "opencode-time", text: formatTime(message.time.created) });
    const body = element.createDiv({ cls: "opencode-msg-body" });
    this.renderMarkdown(body, message.text, component);
    if (message.files?.length) {
      const files = element.createDiv({ cls: "opencode-msg-files" });
      for (const file of message.files) {
        const chip = files.createSpan({ cls: "opencode-file-chip" });
        const icon = chip.createSpan();
        setIcon(icon, "file-text");
        const uri = attachmentUri(file);
        chip.createSpan({ text: file.name ?? (fileNameFromUri(uri) || "Attachment") });
        if (uri) chip.setAttribute("title", uri);
      }
    }
  }

  private buildAssistantMessage(
    element: HTMLElement,
    message: AssistantMessage,
    component: Component,
  ): void {
    element.addClass("opencode-msg-assistant");
    const head = element.createDiv({ cls: "opencode-msg-head" });
    head.createSpan({ cls: "opencode-role", text: "OpenCode" });
    if (message.model) {
      head.createSpan({
        cls: "opencode-model-tag",
        text: modelRefLabel(message.model, this.models),
      });
    }
    head.createSpan({ cls: "opencode-time", text: formatTime(message.time.created) });

    const body = element.createDiv({ cls: "opencode-msg-body" });
    for (const content of message.content) {
      if (content.type === "text") {
        if (content.text.trim()) this.renderMarkdown(body, content.text, component);
      } else if (content.type === "reasoning") {
        this.buildReasoning(body, content, component);
      } else if (content.type === "tool") {
        this.buildTool(body, content);
      }
    }

    if (message.error) this.buildError(element, message.error.message);
    if (message.retry) {
      element.createDiv({
        cls: "opencode-retry",
        text: `Retrying (attempt ${message.retry.attempt}): ${message.retry.error.message}`,
      });
    }

    const footer: string[] = [];
    const total =
      (message.tokens?.input ?? 0) + (message.tokens?.output ?? 0) + (message.tokens?.reasoning ?? 0);
    if (total > 0) footer.push(`${formatTokens(total)} tokens`);
    const cost = formatCost(message.cost);
    if (cost) footer.push(cost);
    if (message.finish && message.finish !== "stop") footer.push(message.finish);
    if (footer.length) element.createDiv({ cls: "opencode-msg-footer", text: footer.join(" · ") });
  }

  private buildReasoning(parent: HTMLElement, part: AssistantReasoningPart, component: Component): void {
    if (!this.plugin.settings.showReasoning) return;
    const details = parent.createEl("details", { cls: "opencode-reasoning" });
    details.createEl("summary", { text: "Reasoning" });
    const body = details.createDiv({ cls: "opencode-reasoning-body" });
    this.renderMarkdown(body, part.text, component);
  }

  private buildTool(parent: HTMLElement, part: AssistantToolPart): void {
    const status = part.state.status;
    const card = parent.createDiv({ cls: `opencode-tool is-${status}` });
    const head = card.createDiv({ cls: "opencode-tool-head" });
    const icon = head.createSpan({ cls: "opencode-tool-icon" });
    setIcon(icon, status === "completed" ? "check" : status === "error" ? "x" : "loader");
    head.createSpan({ cls: "opencode-tool-name", text: part.name });
    const summary = toolSummary(part);
    if (summary) head.createSpan({ cls: "opencode-tool-summary", text: summary });
    head.createSpan({ cls: "opencode-tool-status", text: toolStatusLabel(status) });

    const details = card.createEl("details", { cls: "opencode-tool-details" });
    if (this.plugin.settings.showToolOutput) details.open = true;
    details.createEl("summary", { text: "Details" });

    const input = details.createEl("pre");
    input.addClass("opencode-tool-pre");
    input.setText(typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input, null, 2));
    details.appendChild(input);

    const output = toolOutput(part);
    if (output) {
      const pre = details.createEl("pre");
      pre.addClass("opencode-tool-pre");
      pre.setText(output);
      details.appendChild(pre);
    }
    if (status === "error") this.buildError(details, part.state.error.message);
  }

  private buildIdleMessage(element: HTMLElement, message: Extract<SessionMessage, { type: "idle" }>): void {
    element.addClass("opencode-system");
    const icon = element.createSpan({ cls: "opencode-system-icon" });
    if (message.outcome === "failed") {
      setIcon(icon, "alert-triangle");
      element.addClass("mod-error");
      element.createSpan({ text: `Run failed${message.error ? `: ${message.error.message}` : ""}` });
    } else if (message.outcome === "interrupted") {
      setIcon(icon, "square");
      element.createSpan({ text: "Run interrupted" });
    } else {
      setIcon(icon, "check");
      element.createSpan({ text: "Done" });
    }
  }

  private buildCompaction(element: HTMLElement, message: Extract<SessionMessage, { type: "compaction" }>): void {
    element.addClass("opencode-system");
    const icon = element.createSpan({ cls: "opencode-system-icon" });
    setIcon(icon, "archive");
    if (message.status === "running") {
      element.createSpan({ text: "Compacting the conversation…" });
    } else if (message.status === "failed") {
      element.addClass("mod-error");
      element.createSpan({ text: `Compaction failed: ${message.error?.message ?? "unknown error"}` });
    } else {
      const details = element.createEl("details", { cls: "opencode-compaction" });
      details.createEl("summary", { text: "Conversation compacted" });
      details.createDiv({ text: message.summary ?? "" });
    }
  }

  private buildShell(element: HTMLElement, message: Extract<SessionMessage, { type: "shell" }>): void {
    element.addClass("opencode-shell");
    const head = element.createDiv({ cls: "opencode-shell-head" });
    const icon = head.createSpan();
    setIcon(icon, "terminal");
    head.createSpan({ text: message.command });
    head.createSpan({ cls: "opencode-tool-status", text: message.status });
    if (message.output?.output) {
      const pre = element.createEl("pre", { cls: "opencode-tool-pre" });
      pre.setText(truncate(message.output.output, 6000));
    }
  }

  private buildError(parent: HTMLElement, message: string): void {
    const error = parent.createDiv({ cls: "opencode-error" });
    const icon = error.createSpan();
    setIcon(icon, "alert-triangle");
    error.createSpan({ text: message });
  }

  private renderMarkdown(parent: HTMLElement, text: string, component: Component): void {
    const target = parent.createDiv({ cls: "opencode-markdown" });
    try {
      void MarkdownRenderer.render(
        this.app,
        text,
        target,
        this.app.workspace.getActiveFile()?.path ?? "",
        component,
      ).catch(() => {
        target.empty();
        target.setText(text);
      });
    } catch {
      target.setText(text);
    }
  }

  private updateTyping(): void {
    if (!this.messagesEl) return;
    if (!this.busy) {
      this.typingEl?.remove();
      this.typingEl = null;
      return;
    }
    if (!this.typingEl) {
      this.typingEl = this.messagesEl.createDiv({ cls: "opencode-typing" });
      const dots = this.typingEl.createDiv({ cls: "opencode-typing-dots" });
      dots.createSpan();
      dots.createSpan();
      dots.createSpan();
      this.typingEl.createSpan({ text: "OpenCode is working…" });
    }
    const nearBottom = this.isNearBottom();
    this.messagesEl.appendChild(this.typingEl);
    if (nearBottom) this.scrollToBottom();
  }

  private isNearBottom(): boolean {
    if (!this.messagesEl) return true;
    return (
      this.messagesEl.scrollHeight - this.messagesEl.scrollTop - this.messagesEl.clientHeight < 90
    );
  }

  private scrollToBottom(): void {
    if (!this.messagesEl) return;
    window.requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }

  private onInput(): void {
    this.autoResize();
    const cursor = this.textarea.selectionStart ?? 0;
    const text = this.textarea.value;

    const slash = slashContext(text, cursor);
    if (slash) {
      const items = filterCommands(this.allCommands(), slash.query);
      if (items.length) {
        this.cancelMentionSearch();
        this.mentionMenu = null;
        this.slashMenu = { context: slash, items, index: 0 };
        this.renderPopup();
        return;
      }
    }
    this.slashMenu = null;
    this.updateMentionMenu(text, cursor);
  }

  private updateMentionMenu(text: string, cursor: number): void {
    const context = mentionContext(text, cursor);
    if (!context || context.query.length === 0) {
      this.cancelMentionSearch();
      this.mentionMenu = null;
      this.renderPopup();
      return;
    }

    if (this.mentionTimer !== null) window.clearTimeout(this.mentionTimer);
    const request = ++this.mentionRequest;
    this.mentionLoading = true;
    this.mentionMenu = { context, items: [], index: 0 };
    this.renderPopup();

    this.mentionTimer = window.setTimeout(() => {
      this.mentionTimer = null;
      void this.searchMentions(context, request);
    }, 140);
  }

  private cancelMentionSearch(): void {
    if (this.mentionTimer !== null) {
      window.clearTimeout(this.mentionTimer);
      this.mentionTimer = null;
    }
    this.mentionLoading = false;
    this.mentionRequest++;
  }

  private async searchMentions(context: MentionContext, request: number): Promise<void> {
    if (!this.client) return;
    try {
      const response = await this.client.findFiles(context.query, 24);
      if (request !== this.mentionRequest || !this.mentionMenu) return;
      if (response.location?.directory) this.resolvedDirectory = response.location.directory;
      this.mentionLoading = false;
      this.mentionMenu = {
        context,
        items: (response.data ?? []).filter((entry) => entry.type === "file"),
        index: 0,
      };
      this.renderPopup();
    } catch {
      if (request === this.mentionRequest) {
        this.mentionLoading = false;
        this.mentionMenu = null;
        this.renderPopup();
      }
    }
  }

  private allCommands(): CommandInfo[] {
    const seen = new Set(LOCAL_COMMANDS.map((command) => command.name));
    return [...LOCAL_COMMANDS, ...this.commands.filter((command) => !seen.has(command.name))];
  }

  private renderPopup(): void {
    if (!this.popupEl) return;
    this.popupEl.empty();

    if (this.slashMenu) {
      this.popupEl.toggleClass("is-hidden", false);
      const header = this.popupEl.createDiv({ cls: "opencode-popup-title" });
      header.createSpan({ text: "Commands" });
      header.createSpan({ cls: "opencode-popup-hint", text: "↑↓  ↵" });
      this.slashMenu.items.forEach((command, index) => {
        const item = this.popupEl.createDiv({
          cls: `opencode-popup-item${index === this.slashMenu?.index ? " is-active" : ""}`,
        });
        item.createSpan({ cls: "opencode-popup-primary", text: `/${command.name}` });
        if (command.description) {
          item.createSpan({ cls: "opencode-popup-secondary", text: command.description });
        }
        item.addEventListener("mousedown", (event) => {
          event.preventDefault();
          this.selectSlash(index);
        });
      });
      return;
    }

    if (this.mentionMenu) {
      this.popupEl.toggleClass("is-hidden", false);
      const header = this.popupEl.createDiv({ cls: "opencode-popup-title" });
      header.createSpan({ text: "Files" });
      header.createSpan({ cls: "opencode-popup-hint", text: "↑↓  ↵" });
      if (this.mentionMenu.items.length === 0) {
        this.popupEl.createDiv({
          cls: "opencode-popup-empty",
          text: this.mentionLoading ? "Searching workspace…" : "No matching files",
        });
        return;
      }
      this.mentionMenu.items.forEach((entry, index) => {
        const item = this.popupEl.createDiv({
          cls: `opencode-popup-item${index === this.mentionMenu?.index ? " is-active" : ""}`,
        });
        const icon = item.createSpan({ cls: "opencode-popup-icon" });
        setIcon(icon, "file-text");
        item.createSpan({ cls: "opencode-popup-primary", text: entry.path });
        item.addEventListener("mousedown", (event) => {
          event.preventDefault();
          this.selectMention(index);
        });
      });
      return;
    }

    this.popupEl.toggleClass("is-hidden", true);
  }

  private hidePopups(): void {
    this.cancelMentionSearch();
    this.slashMenu = null;
    this.mentionMenu = null;
    if (this.popupEl) this.popupEl.toggleClass("is-hidden", true);
  }

  private movePopup(delta: number): void {
    const popup = this.slashMenu ?? this.mentionMenu;
    if (!popup || popup.items.length === 0) return;
    popup.index = (popup.index + delta + popup.items.length) % popup.items.length;
    this.renderPopup();
  }

  private selectActivePopup(): boolean {
    if (this.slashMenu) {
      this.selectSlash(this.slashMenu.index);
      return true;
    }
    if (this.mentionMenu && this.mentionMenu.items.length > 0) {
      this.selectMention(this.mentionMenu.index);
      return true;
    }
    return false;
  }

  private selectSlash(index: number): void {
    const menu = this.slashMenu;
    if (!menu) return;
    const command = menu.items[index];
    if (!command) return;
    const text = this.textarea.value;
    const insertion = commandInsertion(command.name);
    this.textarea.value = text.slice(0, menu.context.start) + insertion + text.slice(menu.context.end);
    const cursor = menu.context.start + insertion.length;
    this.textarea.setSelectionRange(cursor, cursor);
    this.hidePopups();
    this.autoResize();
    this.textarea.focus();
  }

  private selectMention(index: number): void {
    const menu = this.mentionMenu;
    if (!menu) return;
    const entry = menu.items[index];
    if (!entry) return;
    const inserted = insertMention(this.textarea.value, menu.context, entry.path);
    this.textarea.value = inserted.text;
    this.textarea.setSelectionRange(inserted.cursor, inserted.cursor);
    const directory = this.resolvedDirectory || this.client?.directory || "";
    const uri = fileUri(directory, entry.path);
    if (!this.attachments.some((attachment) => attachment.uri === uri)) {
      this.attachments.push({ path: entry.path, uri, name: baseName(entry.path) });
    }
    this.renderChips();
    this.hidePopups();
    this.autoResize();
    this.textarea.focus();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.slashMenu || this.mentionMenu) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.movePopup(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.movePopup(-1);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        if (this.selectActivePopup()) {
          event.preventDefault();
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.hidePopups();
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      const explicitSend = event.metaKey || event.ctrlKey;
      if (explicitSend || this.plugin.settings.enterToSend) {
        event.preventDefault();
        void this.send();
      }
    }
  }

  private autoResize(): void {
    if (!this.textarea) return;
    this.textarea.setCssProps({ height: "auto" });
    const max = 220;
    this.textarea.setCssProps({ height: `${Math.min(this.textarea.scrollHeight, max)}px` });
  }

  private setStatus(state: "connected" | "connecting" | "error" | "disconnected"): void {
    if (!this.statusEl) return;
    const labels = {
      connected: "Connected",
      connecting: "Connecting",
      error: "Connection error",
      disconnected: "Disconnected",
    };
    this.statusEl.className = `opencode-status is-${state}`;
    this.statusEl.setAttribute("title", labels[state]);
    this.statusEl.setAttribute("aria-label", labels[state]);
  }

  private showBanner(
    message: string,
    actions: BannerAction[] = [],
    kind: "info" | "error" = "error",
  ): void {
    if (!this.bannerEl) return;
    this.bannerEl.empty();
    this.bannerEl.toggleClass("is-hidden", false);
    this.bannerEl.toggleClass("mod-error", kind === "error");
    this.bannerEl.toggleClass("mod-info", kind === "info");
    this.bannerEl.createDiv({ cls: "opencode-banner-text", text: message });
    if (actions.length === 0) return;
    const row = this.bannerEl.createDiv({ cls: "opencode-banner-actions" });
    for (const action of actions) {
      const button = row.createEl("button", { text: action.label });
      if (action.cta) button.addClass("mod-cta");
      button.addEventListener("click", action.action);
    }
  }

  private hideBanner(): void {
    if (!this.bannerEl) return;
    this.bannerEl.toggleClass("is-hidden", true);
    this.bannerEl.empty();
  }

  private describeError(error: unknown): string {
    if (error instanceof OpenCodeApiError) return error.message;
    const message = errorMessage(error);
    if (/failed to fetch|network|load failed|timed out/i.test(message)) {
      return `Could not reach the OpenCode server at ${this.plugin.settings.serverUrl}. Check the address, local network access, and that OpenCode is running.`;
    }
    return message;
  }

  private openSettings(): void {
    const setting = (this.app as unknown as {
      setting?: { open(): void; openTabById(id: string): void };
    }).setting;
    setting?.open();
    setting?.openTabById(this.plugin.manifest.id);
  }
}

function formatTime(timestamp: number): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function fileNameFromUri(uri: string): string {
  try {
    const path = decodeURIComponent(new URL(uri).pathname);
    return baseName(path);
  } catch {
    return uri;
  }
}

function toolStatusLabel(status: string): string {
  if (status === "completed") return "done";
  if (status === "error") return "failed";
  if (status === "streaming") return "queued";
  return "running";
}

function toolSummary(part: AssistantToolPart): string {
  const input = part.state.input;
  if (typeof input === "string") return truncate(input, 80);
  for (const key of ["filePath", "path", "command", "pattern", "query", "url", "description"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return truncate(value, 80);
  }
  return "";
}

function toolOutput(part: AssistantToolPart): string {
  if (!("content" in part.state) || !part.state.content?.length) return "";
  const text = part.state.content
    .map((item) => (item.type === "text" ? item.text : `[file] ${item.name ?? item.uri}`))
    .join("\n");
  return truncate(text, 8000);
}
