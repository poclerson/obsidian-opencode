# OpenCode for Obsidian

A mobile-friendly Obsidian sidebar chat for a **remote OpenCode V2 server**. It works on macOS, iPhone, and iPad, and talks to OpenCode over HTTP instead of trying to run the server inside Obsidian.

## Features

- Chat from an Obsidian sidebar or mobile drawer.
- Session picker, new-session button, and automatic session restore.
- Model picker grouped by provider.
- Reasoning effort picker backed by OpenCode model variants.
- `/` command palette for local actions and server-side slash commands.
- `@` file picker that attaches workspace files to the prompt.
- Streaming-style polling with tool calls, reasoning blocks, permissions, and compaction messages.
- One-time pairing via an `opencode pair` link or QR payload.

## Requirements

- Obsidian **1.6.0 or newer**.
- An OpenCode **V2** server reachable from the device running Obsidian.
- On iPhone and iPad, OpenCode must run on another machine. Obsidian mobile cannot host the server.

## Install

### From source

```bash
npm install
npm run build
```

Copy these files into `<your-vault>/.obsidian/plugins/opencode-sidebar/`:

- `main.js`
- `manifest.json`
- `styles.css`

Then enable **OpenCode** under **Settings → Community plugins**.

### Development

```bash
npm run dev      # rebuild on change
npm test         # unit tests
npm run build    # typecheck + production bundle
```

For live development, symlink the repository into your vault's plugin folder:

```bash
ln -s "$PWD" "<your-vault>/.obsidian/plugins/opencode-sidebar"
```

## Connect to a server

1. Start the OpenCode service on the machine that will run the agent:

   ```bash
   opencode service start
   opencode service status
   ```

2. Make the server reachable from the other device. For a Mac on the same LAN:

   ```bash
   opencode service set hostname 0.0.0.0
   opencode service restart
   ```

   A Tailscale, VPN, or HTTPS tunnel also works and is safer than exposing the port to the public internet.

3. Print a pairing link with an address the other device can reach:

   ```bash
   opencode pair --url http://192.168.1.20:49374
   ```

   Replace the address with your Mac's LAN IP, Tailscale name, or tunnel URL. A link using `127.0.0.1` only works on the server itself.

4. In Obsidian, open the command palette and run **OpenCode: Pair with OpenCode server**, then paste the link.

If the pairing link expires, run `opencode pair` again.

## Settings

| Setting | Purpose |
| --- | --- |
| **Server URL** | Base URL of the OpenCode server, for example `http://192.168.1.20:49374`. |
| **Username** | Basic-auth username. OpenCode uses `opencode`. |
| **Password or pairing token** | Token returned by the pairing flow. |
| **Workspace directory** | Absolute path **on the server** for sessions and `@` file search. Set this to your vault folder when OpenCode runs on the same machine. |
| **Poll interval** | Refresh rate while a run is active. |
| **Enter sends** | Turn off to make Enter insert a newline. Shift+Enter always inserts a newline. |
| **Show reasoning / tool output** | Display controls for assistant messages. |
| **Open sidebar in** | Left or right sidebar on desktop. On mobile both are drawers. |

## Slash commands

Type `/` at the start of the composer to open the command palette.

Local commands:

- `/new` — start a new session
- `/stop` — interrupt the current run
- `/model` — focus the model picker
- `/effort` — focus the reasoning effort picker
- `/sessions` — focus the session picker
- `/compact` — compact the conversation context
- `/settings` — open plugin settings
- `/help` — show the command list

Server commands come from `GET /api/command` and are sent to the session's command endpoint. Arguments after the command name are passed as `text`.

## File attachments

Type `@` followed by part of a path. The plugin calls `GET /api/fs/find` inside the configured workspace directory and attaches the selected file as a `file://` URI, matching OpenCode's own clients.

Make sure **Workspace directory** points at the vault folder on the server. Otherwise `@` searches the server process's current directory.

## Security notes

- The pairing token is stored in the plugin's `data.json` inside your vault. It is not encrypted.
- Prefer a private LAN, Tailscale, or a tunnel with HTTPS. `opencode pair --remote` exposes the server to the internet; only use it when you understand the trade-off.
- The plugin sends requests with Obsidian's `requestUrl`, which bypasses browser CORS restrictions on desktop and mobile.

## How it works

Obsidian mobile cannot run a local Node process, so the plugin is a network client:

- `requestUrl` handles HTTP and avoids CORS problems in Obsidian's renderer.
- Polling (rather than SSE) keeps the implementation portable across iOS and Android WebViews.
- The sidebar polls the newest 200 messages and updates only the messages whose content changed.
- Basic auth uses the pairing token as the password with the username `opencode`.

## Troubleshooting

**“Could not reach the OpenCode server”**

- Confirm `opencode service status` shows a running server.
- Open the server URL in Safari on the same device. If it does not load, the address or firewall is the problem.
- On iOS/iPadOS, allow Obsidian **Local Network** access in Settings.
- `opencode pair` with `--url` must use an address other devices can reach, not `127.0.0.1`.

**401 / authentication failed**

- Pairing codes are single-use and expire after a few minutes, and the issued session token can expire too. Run `opencode pair` again and paste a fresh link.

**`@` finds no files**

- Set **Workspace directory** to the absolute path of the vault on the OpenCode machine.
- Check that OpenCode has permission to read that folder.

**Only older messages appear**

- The client intentionally fetches the newest 200 messages. Very long sessions are truncated to that window.

## License

MIT. See [LICENSE](LICENSE).
