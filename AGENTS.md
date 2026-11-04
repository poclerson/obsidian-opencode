# AGENTS.md

## Project

`obsidian-opencode` is an Obsidian community plugin (`id: better-opencode`) that provides a sidebar chat client for a **remote OpenCode V2 server**. It must work on macOS, iPhone, and iPad. The plugin never runs the OpenCode server locally.

## Commands

```bash
npm install
npm run dev        # esbuild watch -> main.js
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run build      # typecheck + production bundle
```

Always run `npm run build` before handing off. Tests live in `tests/` and cover pure utilities only.

## Architecture

- `src/main.ts` — plugin lifecycle, view registration, commands, pairing.
- `src/view/chat-view.ts` — the entire sidebar UI, polling loop, composer, slash/mention menus, message rendering.
- `src/api/client.ts` — REST client built on Obsidian `requestUrl` (not `fetch`).
- `src/api/pairing.ts` — pairing-link and QR payload parsing.
- `src/api/types.ts` — hand-written API types.
- `src/settings.ts` — settings schema and settings tab.
- `src/util/*` — pure helpers with unit tests.
- `styles.css` — Obsidian theme variables, mobile-safe composer layout.

## API contract (OpenCode V2)

Base URL is the server origin, optionally with a reverse-proxy path prefix. Auth is HTTP Basic with username `opencode` and the pairing token as password.

Important endpoints:

- `GET /api/info` — version and URLs.
- `GET /api/model?types=chat` and `GET /api/provider` — model catalog; responses have `{ location, data }`.
- `GET /api/command` — server slash commands.
- `GET /api/session?limit=…&order=desc&parentID=null&directory=…` — root sessions. `parentID=null` is a literal string.
- `POST /api/session` — create; optional `model` and `location.directory`.
- `GET /api/session/{id}/message?order=desc&limit=200` — **descending** newest page. `OpenCodeClient.messages()` reverses it to chronological order.
- `POST /api/session/{id}/prompt` — body `{ text, files? }`.
- `POST /api/session/{id}/command` — body `{ name, text, files? }`; `text` is required, even when empty.
- `POST /api/session/{id}/model` — body `{ model: { providerID, id, variant? } }`.
- `POST /api/session/{id}/compact` — request body is required; send `{}`.
- `POST /api/session/{id}/interrupt` — no body.
- `GET /api/session/active` — map of running session IDs.
- `GET` / `POST /api/session/{id}/permission...` — pending permission requests and replies (`once`, `always`, `reject`).
- `GET /api/fs/find?location[directory]=…&query=…&type=file&limit=…` — `@` file search.
- `GET /auth/connect/{code}` with `Accept: application/json` — redeem a one-time pairing code for `{ token }`.

Gotchas:

- Use `requestUrl` from `obsidian`; `fetch` is blocked by CORS in Obsidian's renderer.
- File attachments are `{ uri: "file:///absolute/path", name, mention? }`. `mention` offsets must refer to the final prompt text.
- `PromptInput.FileAttachment` rejects unknown properties (`additionalProperties: false`). Do not send `source` or `data` for local files.
- Reasoning effort is a model `variant`. The picker maps `variant.id` / `variant.settings.reasoningEffort` to labels.
- The server may add message types. Keep the `else` branch in `buildMessage` and render unknown types as a neutral system line.
- `data.json` contains secrets. Never log or commit it.

## UI conventions

- Use Obsidian theme variables and `setIcon`; avoid hard-coded colors and inline styles.
- Keep the composer usable at 320 px width and with the iOS keyboard open.
- Do not collapse the user's scroll position while a run streams. `updateTyping()` only auto-scrolls when already near the bottom.
- Preserve an open native picker: background refreshes skip rebuilding a focused `<select>`; user-driven changes call the render helpers with `force = true`.
- New user-facing commands go through `addCommand`; avoid default hotkeys.
- Display-only settings should call `plugin.rerenderViews()`, not `plugin.refreshViews()`, so the session is not dropped.

## Code style

- TypeScript strict mode, ES2018 target, CommonJS bundle for Obsidian.
- Keep pure logic in `src/util/` so it can be unit tested without the Obsidian runtime.
- Prefer small functions and explicit types at API boundaries.
- Do not add dependencies unless they are essential; the bundle ships to mobile.

## Release checklist

1. Update `version` in `manifest.json` and add the matching entry to `versions.json`.
2. `npm test && npm run build`.
3. Attach `main.js`, `manifest.json`, and `styles.css` to the GitHub release.
