# weixin-plugin-cc-cx

[![中文](https://img.shields.io/badge/README-中文-blue)](README.zh-CN.md)

WeChat bridge for Claude Code and Codex.

`cc-cx` stands for `Claude Code` and `Codex`.

> **Credits:** This project was primarily built by **MiMo-Pro** and **Kimi-2.5**, with **Opus** serving as the quality inspector who shows up at the end, squints at the code, and says "hmm, let me fix that for you." The Codex bridge portion was implemented mainly by **Codex** itself — which feels only fair, given that asking everyone else to fake being Codex was getting a little awkward. Think of it as two enthusiastic interns writing most of the app, a senior architect reviewing from a comfy chair, and Codex walking in to wire up its own extension cable. The result? A surprisingly functional WeChat bridge that almost none of them can actually use — because most of them still do not have a WeChat account.

## Features

- **QR code login** — scan to login, session saved and auto-restored across restarts
- **Long-poll message delivery** — real-time WeChat message bridging
- **Media support** — send/receive images, video, files (up to 50MB)
- **Access control** — pairing mode (default), allowlist, or disabled
- **Auto-chunking** — long replies split at WeChat's ~2048 char limit
- **Permission relay** — approve/deny Claude Code tool permissions from WeChat
- **Typing indicator** — shows typing status while processing
- **Codex backend** — optional standalone bridge to `codex app-server`

## Installation

Standalone Claude Code plugin mode is no longer supported. You must run the daemon from a local clone of this repository first, then connect Claude Code to it.

### 1. Clone And Start The Daemon

Clone the repository locally:

```bash
git clone https://github.com/kkk0913/weixin-plugin-cc.git
cd weixin-plugin-cc
```

Start the daemon from the cloned repo:

```bash
npm run start
```

Optional environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `WEIXIN_STATE_DIR` | `${XDG_STATE_HOME:-~/.local/state}/weixin-plugin-cc-cx` | State directory for session, routes, socket, cache, and inbox |
| `WEIXIN_CODEX_CWD` | current working directory | Workspace passed to `codex -C ... app-server` |
| `WEIXIN_CODEX_MODEL` | unset | Override Codex model |
| `WEIXIN_CODEX_APPROVAL_POLICY` | `on-request` | Codex approval policy |
| `WEIXIN_CODEX_SANDBOX` | `workspace-write` | Codex sandbox mode |
| `WEIXIN_CODEX_COMMAND` | `codex` | Codex CLI executable |

There are currently no dedicated `WEIXIN_CLAUDE_*` environment variables. Claude Code connects through the local proxy/socket path managed by the daemon.

Example:

```bash
WEIXIN_STATE_DIR=/path/to/state WEIXIN_CODEX_CWD=/path/to/repo WEIXIN_CODEX_MODEL=gpt-5.4 npm run start
```

### 2. Connect Claude Code

Add the marketplace in Claude Code:

```text
/plugin marketplace add kkk0913/weixin-plugin-cc
```

Install the plugin:

```text
/plugin install weixin@weixin-plugin-cc
```

Reload plugins.

Start Claude Code with the development channels flag:

```bash
claude --dangerously-load-development-channels plugin:weixin@weixin-plugin-cc
```

The Claude plugin process no longer polls WeChat by itself. It only proxies Claude's MCP channel over a local socket to the daemon started from your local clone.

## First Run

Prefer the npm entrypoints for setup and login. The cc skills remain available, but they are secondary.

1. Start the daemon with `npm run start`
2. Check current state with `npm run status`
3. Trigger login with `npm run login`
4. If Claude Code needs to reconnect its local proxy, run `/reload-plugins`
5. The daemon prints a browser login link to stderr — open it in your browser and scan with WeChat within 8 minutes
6. Session is saved under `${XDG_STATE_HOME:-~/.local/state}/weixin-plugin-cc-cx/account.json` by default, or `WEIXIN_STATE_DIR` if set

Equivalent optional cc skill entrypoints:

```bash
/weixin:configure
/weixin:configure login
```

Useful CLI helpers:

```bash
npm run status
npm run relogin
npm run clear
npm test
```

### Session Expiry

When the session expires, the server stops polling and logs the error code. Run:

```
npm run clear
npm run login
```

Then `/reload-plugins` if Claude Code needs to reconnect. The `/weixin:configure clear` and `/weixin:configure login` skill commands remain available, but npm is the preferred path.

## Access Control

New WeChat users require pairing by default:

1. Unknown user sends a message
2. Server generates a 6-char pairing code and replies to the user
3. Approve in your terminal: `/weixin:access pair <code>`
4. User is added to the allowlist

Modes (configured in `${XDG_STATE_HOME:-~/.local/state}/weixin-plugin-cc-cx/access.json` by default):

| Mode | Behavior |
|------|----------|
| `pairing` | New users get a pairing code (default) |
| `allowlist` | Only pre-approved users can message |
| `disabled` | All inbound messages are dropped |

## Backend Switching

Per-chat backend mode is remembered until changed.

| Message | Effect |
|---------|--------|
| `/claude` | Route subsequent messages from this WeChat user to Claude Code |
| `/cc` | Same as `/claude` |
| `/codex` | Route subsequent messages from this WeChat user to Codex |

You can also use short aliases such as `code s`, `code x`, `Claude`, `Codex`, `Cloud Code`, or natural commands like `switch to codex` / `切换到code x`.

## Skills

These skills are optional terminal shortcuts, not the primary workflow. For startup, login, relogin, clear, and status operations, prefer the npm scripts above.

| Skill | Description |
|-------|-------------|
| `/weixin:configure` | Optional shortcut for status/login/clear; prefer `npm run status/login/relogin/clear` |
| `/weixin:access` | Manage access control (pair, allow, remove, policy) |

## MCP Tools

| Tool | Description |
|------|-------------|
| `reply` | Send text + optional file attachments to a WeChat user |
| `react` | Not supported (WeChat has no emoji reactions) |
| `download_attachment` | Download an inbound media file to local inbox |
| `edit_message` | Send a replacement message (WeChat has no edit API) |

## Flow

```text
WeChat User
    |
    v
WeChat API
    |
    v
weixin-plugin-cc-cx daemon
  polling
    -> inbound-router
    -> state/config
    -> backend adapters
         |- Claude Path -> claude proxy -> Claude Code
         `- Codex Path  -> codex bridge -> codex app-server
```

## Project Structure

Detailed maintainer notes live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
server.ts                  # Entry point: daemon in terminal, Claude proxy over stdio in plugin mode

src/
├── claude/
│   └── proxy.ts           # Claude MCP stdio proxy -> local daemon socket
├── codex/
│   ├── app-server.ts      # Codex app-server JSON-RPC client
│   ├── bridge.ts          # WeChat <-> Codex thread bridge
│   └── types.ts           # Minimal Codex protocol types
├── config/
│   ├── access.ts          # Access control (pairing/allowlist/disabled)
│   ├── backend-route.ts   # Per-chat backend selection
│   └── poll-owner.ts      # Single-consumer poll lease
├── ipc/
│   ├── client.ts          # Claude proxy -> daemon client
│   ├── protocol.ts        # Local IPC message schema
│   └── wire.ts            # JSON-lines socket framing
├── runtime/
│   ├── daemon.ts          # Top-level wiring and startup
│   ├── backend-manager.ts # Backend readiness and Codex bridge lifecycle
│   ├── backends.ts        # Claude/Codex backend adapters
│   ├── inbound-router.ts  # Parsed inbound dispatcher
│   ├── command-parser.ts  # Backend switch/stats command parsing
│   ├── inbound-parser.ts  # Inbound message classification
│   ├── polling-service.ts # Cursor-backed polling wrapper
│   ├── polling.ts         # Long-poll loop
│   ├── lifecycle.ts       # Shutdown and signal handling
│   ├── login.ts           # QR login and re-login flow
│   ├── session-state.ts   # In-memory TTL state
│   ├── stats-service.ts   # Claude/Codex stats aggregation
│   ├── tool-handlers.ts   # MCP tool execution and permission relay
│   └── paths.ts           # Shared runtime paths
├── state/
│   ├── json-file.ts       # Shared JSON file persistence helper
│   ├── access-repository.ts
│   ├── account-repository.ts
│   ├── backend-route-repository.ts
│   ├── codex-thread-repository.ts
│   ├── cursor-repository.ts
│   ├── flag-file.ts
│   ├── login-trigger-repository.ts
│   └── usage-cache-repository.ts
├── weixin/
│   ├── api.ts             # WeChat iLink bot API client
│   ├── types.ts           # TypeScript interfaces
│   ├── crypto.ts          # AES-128-ECB for CDN media
│   ├── inbound.ts         # Claude/Codex inbound payload preparation
│   └── media.ts           # Upload/download media files
└── util/
    └── helpers.ts         # Utility functions

test/
├── codex/
│   └── bridge.test.ts
├── config/
│   ├── access.test.ts
│   ├── backend-route.test.ts
│   └── poll-owner.test.ts
└── runtime/
    ├── command-parser.test.ts
    ├── inbound-parser.test.ts
    ├── inbound-router.test.ts
    └── session-state.test.ts

skills/
├── access/
│   └── SKILL.md           # Access control skill
└── configure/
    └── SKILL.md           # Setup and login skill
```

## State Directory

`${XDG_STATE_HOME:-~/.local/state}/weixin-plugin-cc-cx/` stores by default
or `WEIXIN_STATE_DIR` if set:

- `account.json` — login session (token, user ID, bot ID)
- `access.json` — access control config
- `backend-route.json` — per-chat Claude/Codex route
- `codex-threads.json` — WeChat user → Codex thread mapping (Codex mode)
- `.cursor` — WeChat long-poll cursor
- `.usage-cache.json` — cached Claude usage snapshot
- `.auto-approve` — session-scoped approval flag
- `daemon.sock` — local IPC socket between Claude proxy and daemon
- `poll-owner.json` — active poll owner lease
- `inbox/` — downloaded media files

## Development

```bash
npm run typecheck
npm test
npm run build
```

## License

MIT
