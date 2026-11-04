import { App, Modal, Platform, Setting } from "obsidian";
import type OpenCodePlugin from "../main";
import { parsePairingLink, parseServerUrl } from "../api/pairing";

export class PairModal extends Modal {
  private link = "";
  private serverUrl = "";
  private code = "";
  private statusEl: HTMLElement | null = null;
  private linkInput: HTMLInputElement | null = null;
  private busy = false;

  constructor(
    app: App,
    private readonly plugin: OpenCodePlugin,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("opencode-pair-modal");
    contentEl.createEl("h2", { text: "Pair with OpenCode" });

    contentEl.createEl("p", {
      text: "On the computer running OpenCode, run `opencode pair` and paste one of the links below. The link works once and expires after a few minutes.",
    });

    new Setting(contentEl)
      .setName("Pairing link")
      .setDesc("Example: http://192.168.1.20:49374/auth/connect/abc_DEF-123")
      .addText((text) => {
        this.linkInput = text.inputEl;
        text
          .setPlaceholder("http://host:port/auth/connect/code")
          .setValue(this.link)
          .onChange((value) => {
            this.link = value;
          });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void this.submit();
          }
        });
        text.inputEl.focus();
      });

    contentEl.createEl("p", {
      cls: "opencode-pair-or",
      text: "or enter the server address and code separately",
    });

    new Setting(contentEl)
      .setName("Server URL")
      .addText((text) =>
        text
          .setPlaceholder("http://192.168.1.20:49374")
          .setValue(this.serverUrl)
          .onChange((value) => {
            this.serverUrl = value;
          }),
      );

    new Setting(contentEl)
      .setName("Code")
      .addText((text) =>
        text
          .setPlaceholder("abc_DEF-123")
          .setValue(this.code)
          .onChange((value) => {
            this.code = value;
          }),
      );

    this.statusEl = contentEl.createDiv({ cls: "opencode-pair-status" });

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText("Pair")
          .setCta()
          .onClick(() => void this.submit()),
      )
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => {
          this.close();
        }),
      );

    void this.prefillFromClipboard();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async prefillFromClipboard(): Promise<void> {
    // Reading the clipboard on mobile triggers a system paste prompt, which is
    // intrusive when the user opened the modal to type the link by hand.
    if (Platform.isMobile) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text || this.link || !parsePairingLink(text)) return;
      this.link = text.trim();
      if (this.linkInput) this.linkInput.value = this.link;
    } catch {
      // Clipboard access is optional and can be denied by the OS.
    }
  }

  private setStatus(message: string, error = false): void {
    if (!this.statusEl) return;
    this.statusEl.setText(message);
    this.statusEl.toggleClass("mod-error", error);
    this.statusEl.toggleClass("mod-success", !error && !!message);
  }

  private async submit(): Promise<void> {
    if (this.busy) return;

    let pairing = parsePairingLink(this.link);
    if (!pairing) {
      const serverUrl = parseServerUrl(this.serverUrl);
      const code = this.code.trim();
      if (serverUrl && code) pairing = { serverUrl, code };
    }

    if (!pairing) {
      this.setStatus("Paste a complete pairing link, or enter a server URL and code.", true);
      return;
    }

    this.busy = true;
    this.setStatus("Pairing…");
    try {
      await this.plugin.pairWithLink(pairing);
      this.setStatus("Paired.");
      this.close();
    } catch (error) {
      this.setStatus(
        `${error instanceof Error ? error.message : String(error)} The token was saved; use Test connection to retry.`,
        true,
      );
    } finally {
      this.busy = false;
    }
  }
}
