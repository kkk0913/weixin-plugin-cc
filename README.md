# weixin-plugin-cc

[![中文](https://img.shields.io/badge/README-中文-blue)](README.zh-CN.md)

WeChat channel plugin for Claude Code — bridge WeChat messages to Claude Code via MCP.

> **Credits:** This project was primarily built by **MiMo-Pro** and **Kimi-2.5**, with **Opus** serving as the quality inspector who shows up at the end, squints at the code, and says "hmm, let me fix that for you." Think of it as two enthusiastic interns writing the whole app while a senior architect reviews from a comfy chair. The result? A surprisingly functional WeChat bridge that none of them can actually use — because none of them have a WeChat account.

## Features

- **QR code login** — scan to login, session saved and auto-restored across restarts
- **Long-poll message delivery** — real-time WeChat message bridging
- **Media support** — send/receive images, video, files (up to 50MB)
- **Access control** — pairing mode (default), allowlist, or disabled
- **Auto-chunking** — long replies split at WeChat's ~2048 char limit
- **Permission relay** — approve/deny Claude Code tool permissions from WeChat
- **Typing indicator** — shows typing status while processing

## Installation

Add the marketplace in Claude Code:

```
/plugin marketplace add kkk0913/weixin-plugin-cc
```

Install the plugin:

```
/plugin install weixin@weixin-plugin-cc
```

Reload plugins.

> **Note:** This is a channel plugin. You must start Claude Code with the development channels flag:
>
> ```
> claude --dangerously-load-development-channels plugin:weixin@weixin-plugin-cc
> ```
>
> Without this flag, WeChat messages will not be delivered to Claude Code.

## First Run

1. Run `/weixin:configure` to check status
2. Run `/weixin:configure login` — then `/reload-plugins` to restart the server
3. The server prints a browser login link to stderr — open it in your browser and scan with WeChat within 8 minutes
4. Session is saved to `~/.claude/channels/weixin/account.json`

### Session Expiry

When the session expires, the server stops polling and logs the error code. Run:

```
/weixin:configure clear
/weixin:configure login
```

Then `/reload-plugins` to restart with a fresh QR login.

## Access Control

New WeChat users require pairing by default:

1. Unknown user sends a message
2. Server generates a 6-char pairing code and replies to the user
3. Run in Claude Code: `/weixin:access pair <code>`
4. User is added to the allowlist

Modes (configured in `~/.claude/channels/weixin/access.json`):

| Mode | Behavior |
|------|----------|
| `pairing` | New users get a pairing code (default) |
| `allowlist` | Only pre-approved users can message |
| `disabled` | All inbound messages are dropped |

## Skills

| Skill | Description |
|-------|-------------|
| `/weixin:configure` | Check status, login, clear session |
| `/weixin:access` | Manage access control (pair, allow, remove, policy) |

## MCP Tools

| Tool | Description |
|------|-------------|
| `reply` | Send text + optional file attachments to a WeChat user |
| `react` | Not supported (WeChat has no emoji reactions) |
| `download_attachment` | Download an inbound media file to local inbox |
| `edit_message` | Send a replacement message (WeChat has no edit API) |

## Project Structure

```
src/
├── server.ts              # MCP server, polling loop, message routing
├── config/
│   └── access.ts          # Access control (pairing/allowlist/disabled)
├── weixin/
│   ├── api.ts             # WeChat iLink bot API client
│   ├── types.ts           # TypeScript interfaces
│   ├── crypto.ts          # AES-128-ECB for CDN media
│   └── media.ts           # Upload/download media files
└── util/
    └── helpers.ts         # Utility functions

skills/
├── access/
│   └── SKILL.md           # Access control skill
└── configure/
    └── SKILL.md           # Setup and login skill
```

## State Directory

`~/.claude/channels/weixin/` stores:

- `account.json` — login session (token, user ID, bot ID)
- `access.json` — access control config
- `inbox/` — downloaded media files

## License

MIT
