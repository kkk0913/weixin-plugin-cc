# claude-plugin-weixin

WeChat channel plugin for Claude Code — bridge WeChat messages to Claude Code via MCP.

## Features

- **QR code login** — scan once, session saved for subsequent runs
- **Long-poll message delivery** — real-time WeChat message bridging
- **Media support** — send/receive images, video, files (up to 50MB)
- **Access control** — pairing mode (default), allowlist, or disabled
- **Auto-chunking** — long replies split at WeChat's ~2048 char limit
- **Permission relay** — approve/deny Claude Code tool permissions from WeChat
- **Typing indicator** — shows typing status while processing

## Requirements

- Node.js >= 22
- Claude Code with plugin support

## Installation

```bash
git clone https://github.com/kkk0913/claude-plugin-weixin.git
cd claude-plugin-weixin
npm install
npm run build

# Create symlink for Claude Code plugin system
ln -s "$(pwd)" ~/.claude/plugins/local/wechat
```

Then add to `~/.claude/plugins/installed_plugins.json`:

```json
{
  "version": 2,
  "plugins": {
    "wechat@local": [
      {
        "scope": "user",
        "installPath": "~/.claude/plugins/local/wechat",
        "version": "1.0.0",
        "installedAt": "2026-04-04T00:00:00.000Z"
      }
    ]
  }
}
```

Restart Claude Code or run `/reload-plugins`.

## First Run

On first launch, the server prints a QR code URL to stderr:

```
wechat channel: scan QR to login:
https://liteapp.weixin.qq.com/q/...?bot_type=3
```

Open the URL in a browser and scan with WeChat. Session is saved to `~/.claude/channels/weixin/account.json`.

## Access Control

New WeChat users require pairing by default:

1. Unknown user sends a message
2. Server generates a 6-char pairing code and replies to the user
3. Run in Claude Code: `/wechat:access pair <code>`
4. User is added to the allowlist

Modes (configured in `~/.claude/channels/weixin/access.json`):

| Mode | Behavior |
|------|----------|
| `pairing` | New users get a pairing code (default) |
| `allowlist` | Only pre-approved users can message |
| `disabled` | All inbound messages are dropped |

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
```

## Development

```bash
npm run dev    # Watch mode
npm run build  # One-time build
npm start      # Run server directly
```

## State Directory

`~/.claude/channels/weixin/` stores:

- `account.json` — login session (token, user ID, bot ID)
- `access.json` — access control config
- `inbox/` — downloaded media files

## License

MIT
