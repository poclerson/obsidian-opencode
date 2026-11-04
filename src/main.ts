import { Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import { normalizeBaseUrl, OpenCodeClient, redeemPairingCode } from "./api/client";
import type { ParsedPairing } from "./api/pairing";
import type { ServerInfo } from "./api/types";
import { VIEW_TYPE_OPENCODE } from "./constants";
import { DEFAULT_SETTINGS, OpenCodeSettingTab, type OpenCodeSettings } from "./settings";
import { errorMessage } from "./util/format";
import { ChatView } from "./view/chat-view";
import { PairModal } from "./view/pair-modal";

export default class OpenCodePlugin extends Plugin {
  settings!: OpenCodeSettings;
  private viewInstances = new Set<ChatView>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_OPENCODE, (leaf) => new ChatView(leaf, this));

    this.addRibbonIcon("bot", "Open OpenCode chat", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-chat",
      name: "Open chat",
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: "focus-chat",
      name: "Focus chat",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "o" }],
      callback: () => void this.focusView(),
    });

    this.addCommand({
      id: "new-session",
      name: "New session",
      callback: async () => {
        const view = await this.activateView();
        await view?.newSession();
      },
    });

    this.addCommand({
      id: "pair-server",
      name: "Pair with server",
      callback: () => this.openPairModal(),
    });

    this.addSettingTab(new OpenCodeSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<OpenCodeSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
    if (!this.settings.username) this.settings.username = DEFAULT_SETTINGS.username;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(location = this.settings.openLocation): Promise<ChatView | null> {
    let leaf: WorkspaceLeaf | null =
      this.app.workspace.getLeavesOfType(VIEW_TYPE_OPENCODE)[0] ?? null;
    if (!leaf) {
      const preferred =
        location === "left"
          ? this.app.workspace.getLeftLeaf(false)
          : this.app.workspace.getRightLeaf(false);
      leaf =
        preferred ??
        this.app.workspace.getRightLeaf(false) ??
        this.app.workspace.getLeftLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: VIEW_TYPE_OPENCODE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    return leaf.view instanceof ChatView ? leaf.view : null;
  }

  async focusView(): Promise<ChatView | null> {
    const view = await this.activateView();
    view?.focusComposer();
    return view;
  }

  registerViewInstance(view: ChatView): void {
    this.viewInstances.add(view);
  }

  unregisterViewInstance(view: ChatView): void {
    this.viewInstances.delete(view);
  }

  refreshViews(): void {
    for (const view of this.viewInstances) view.reloadSettings();
  }

  /** Re-renders display-only settings without dropping the current session. */
  rerenderViews(): void {
    for (const view of this.viewInstances) view.rerender();
  }

  openPairModal(): void {
    new PairModal(this.app, this).open();
  }

  async pairWithLink(pair: ParsedPairing): Promise<void> {
    const token = await redeemPairingCode(pair.serverUrl, pair.code);
    this.settings.serverUrl = pair.serverUrl;
    this.settings.username = "opencode";
    this.settings.password = token;
    await this.saveSettings();

    try {
      const info = await this.testConnection();
      this.refreshViews();
      new Notice(`Paired with OpenCode ${info.version}.`);
    } catch (error) {
      this.refreshViews();
      throw new Error(`Pairing token saved, but the connection test failed: ${errorMessage(error)}`);
    }
  }

  async testConnection(settings: OpenCodeSettings = this.settings): Promise<ServerInfo> {
    const client = new OpenCodeClient({
      baseUrl: normalizeBaseUrl(settings.serverUrl),
      username: settings.username || "opencode",
      password: settings.password,
      workspaceDirectory: settings.workspaceDirectory,
    });
    return client.info();
  }

  async testConnectionFromSettings(): Promise<void> {
    if (!this.settings.serverUrl.trim() || !this.settings.password.trim()) {
      new Notice("Enter a server URL and pairing token first.");
      return;
    }
    try {
      const info = await this.testConnection();
      const location = this.settings.workspaceDirectory
        ? ` Workspace: ${this.settings.workspaceDirectory}.`
        : "";
      new Notice(`Connected to OpenCode ${info.version}.${location}`, 8000);
    } catch (error) {
      new Notice(`Connection failed: ${errorMessage(error)}`, 10000);
    }
  }
}
