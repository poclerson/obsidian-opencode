import { App, PluginSettingTab, Setting } from "obsidian";
import type OpenCodePlugin from "./main";
import type { ModelRef } from "./api/types";
import { PairModal } from "./view/pair-modal";

export interface OpenCodeSettings {
  serverUrl: string;
  username: string;
  password: string;
  workspaceDirectory: string;
  pollIntervalMs: number;
  enterToSend: boolean;
  showReasoning: boolean;
  showToolOutput: boolean;
  openLocation: "right" | "left";
  lastSessionID: string | null;
  lastModel: ModelRef | null;
}

export const DEFAULT_SETTINGS: OpenCodeSettings = {
  serverUrl: "",
  username: "opencode",
  password: "",
  workspaceDirectory: "",
  pollIntervalMs: 1000,
  enterToSend: true,
  showReasoning: true,
  showToolOutput: true,
  openLocation: "right",
  lastSessionID: null,
  lastModel: null,
};

export class OpenCodeSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: OpenCodePlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("opencode-settings");

    new Setting(containerEl).setName("Overview").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Connect Obsidian to an OpenCode V2 server. On iPhone and iPad, OpenCode must be running on another machine, such as your Mac.",
    });

    new Setting(containerEl).setName("Connection").setHeading();

    new Setting(containerEl)
      .setName("Server URL")
      .setDesc("For example http://192.168.1.20:49374. Use `opencode service status` on the server to find the port.")
      .addText((text) => {
        let dirty = false;
        text
          .setPlaceholder("http://192.168.1.20:49374")
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            const next = value.trim();
            if (next === this.plugin.settings.serverUrl) return;
            this.plugin.settings.serverUrl = next;
            dirty = true;
            await this.plugin.saveSettings();
          });
        text.inputEl.addEventListener("blur", () => {
          if (!dirty) return;
          dirty = false;
          this.plugin.refreshViews();
        });
      });

    new Setting(containerEl)
      .setName("Username")
      .setDesc("OpenCode uses the basic-auth username `opencode`.")
      .addText((text) => {
        let dirty = false;
        text
          .setPlaceholder("opencode")
          .setValue(this.plugin.settings.username)
          .onChange(async (value) => {
            const next = value.trim() || "opencode";
            if (next === this.plugin.settings.username) return;
            this.plugin.settings.username = next;
            dirty = true;
            await this.plugin.saveSettings();
          });
        text.inputEl.addEventListener("blur", () => {
          if (!dirty) return;
          dirty = false;
          this.plugin.refreshViews();
        });
      });

    new Setting(containerEl)
      .setName("Password or pairing token")
      .setDesc("The token from a pairing link, or the password in ~/.config/opencode/service.json.")
      .addText((text) => {
        let dirty = false;
        text.inputEl.type = "password";
        text
          .setPlaceholder("Pairing token")
          .setValue(this.plugin.settings.password)
          .onChange(async (value) => {
            const next = value.trim();
            if (next === this.plugin.settings.password) return;
            this.plugin.settings.password = next;
            dirty = true;
            await this.plugin.saveSettings();
          });
        text.inputEl.addEventListener("blur", () => {
          if (!dirty) return;
          dirty = false;
          this.plugin.refreshViews();
        });
      });

    new Setting(containerEl)
      .setName("Workspace directory")
      .setDesc("Absolute path on the OpenCode machine that sessions and @ file search use. Set this to your vault folder for local access.")
      .addText((text) => {
        let dirty = false;
        text
          .setPlaceholder("/Users/you/Notes")
          .setValue(this.plugin.settings.workspaceDirectory)
          .onChange(async (value) => {
            const next = value.trim();
            if (next === this.plugin.settings.workspaceDirectory) return;
            this.plugin.settings.workspaceDirectory = next;
            dirty = true;
            await this.plugin.saveSettings();
          });
        text.inputEl.addEventListener("blur", () => {
          if (!dirty) return;
          dirty = false;
          this.plugin.refreshViews();
        });
      });

    new Setting(containerEl)
      .setName("Pair this device")
      .setDesc("Run `opencode pair` on the OpenCode machine, then paste one of its links.")
      .addButton((button) =>
        button.setButtonText("Pair with OpenCode").setCta().onClick(() => new PairModal(this.app, this.plugin).open()),
      )
      .addButton((button) =>
        button.setButtonText("Test connection").onClick(async () => {
          await this.plugin.testConnectionFromSettings();
        }),
      )
      .addButton((button) =>
        button.setButtonText("Open chat").onClick(() => {
          void this.plugin.activateView();
        }),
      );

    new Setting(containerEl).setName("Chat").setHeading();

    new Setting(containerEl)
      .setName("Poll interval")
      .setDesc("How often the sidebar refreshes while OpenCode is working. Polling works on desktop and mobile without CORS setup.")
      .addDropdown((dropdown) => {
        for (const [value, label] of [
          ["500", "0.5 seconds"],
          ["1000", "1 second"],
          ["1500", "1.5 seconds"],
          ["2000", "2 seconds"],
          ["3000", "3 seconds"],
        ] as const) {
          dropdown.addOption(value, label);
        }
        return dropdown.setValue(String(this.plugin.settings.pollIntervalMs)).onChange(async (value) => {
          this.plugin.settings.pollIntervalMs = Number(value);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Enter sends the message")
      .setDesc("When off, Enter inserts a newline and the send button submits. Shift+Enter always inserts a newline.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enterToSend).onChange(async (value) => {
          this.plugin.settings.enterToSend = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Show reasoning")
      .setDesc("Display model reasoning in a collapsed block.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showReasoning).onChange(async (value) => {
          this.plugin.settings.showReasoning = value;
          await this.plugin.saveSettings();
          this.plugin.rerenderViews();
        }),
      );

    new Setting(containerEl)
      .setName("Show tool output")
      .setDesc("Show expanded tool results. Turning this off keeps tool calls compact.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showToolOutput).onChange(async (value) => {
          this.plugin.settings.showToolOutput = value;
          await this.plugin.saveSettings();
          this.plugin.rerenderViews();
        }),
      );

    new Setting(containerEl)
      .setName("Open sidebar in")
      .setDesc("Where the chat view opens on desktop. On mobile both are drawers.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("right", "Right sidebar")
          .addOption("left", "Left sidebar")
          .setValue(this.plugin.settings.openLocation)
          .onChange(async (value) => {
            this.plugin.settings.openLocation = value === "left" ? "left" : "right";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("About").setHeading();
    const about = containerEl.createDiv({ cls: "opencode-settings-about" });
    about.createEl("p", {
      text: `Plugin version ${this.plugin.manifest.version}. Works with OpenCode V2 servers.`,
    });
    about.createEl("p", {
      text: "On iOS and iPadOS, allow Obsidian local network access when prompted and keep the server reachable over your LAN, Tailscale, or a secure tunnel.",
    });
  }
}
