# Architecture

## Overview

This project is a single-process orchestration daemon with multiple protocol adapters:

- WeChat iLink Bot API for inbound/outbound messages
- Claude Code via local MCP proxy over a Unix socket
- Codex via `codex app-server` JSON-RPC

Deployment model:

- a local clone of this repository must run the daemon via `npm run start`
- standalone Claude Code plugin mode without the local daemon is not supported
- the Claude plugin only proxies MCP traffic to the local daemon

`server.ts` is only a role switch:

- daemon mode: starts the standalone bridge process
- proxy mode: exposes MCP over stdio and forwards requests/events to the daemon

## Runtime Flow

Inbound path:

1. `runtime/polling.ts` long-polls WeChat updates
2. `runtime/inbound-router.ts` applies access control and dispatches parsed inbound events
3. `runtime/backends.ts` delivers the message to either Claude or Codex

Outbound path:

- Claude tool calls are handled by `runtime/tool-handlers.ts`
- Codex assistant output is emitted from `codex/bridge.ts`
- Both use `weixin/api.ts` and `weixin/media.ts` for message delivery

## Module Responsibilities

### `src/runtime`

- `daemon.ts`: top-level dependency wiring and startup flow
- `backend-manager.ts`: backend readiness checks and Codex bridge lifecycle
- `backends.ts`: Claude/Codex backend adapters behind one interface
- `inbound-router.ts`: dispatches parsed inbound events
- `command-parser.ts`: parses switch/stats commands
- `inbound-parser.ts`: normalizes inbound messages into command/chat categories
- `polling-service.ts`: cursor-backed polling orchestration
- `lifecycle.ts`: shutdown and signal handling
- `login.ts`: QR login and re-login flow
- `stats-service.ts`: Claude usage + local stats + Codex rate limit formatting
- `tool-handlers.ts`: MCP tool execution and Claude permission relay
- `session-state.ts`: in-memory TTL state for context tokens and media handles
- `paths.ts`: shared runtime file paths

### `src/state`

This layer isolates file-backed state from business logic:

- account/session persistence
- access config
- backend route config
- Codex thread mapping
- poll cursor
- flag files such as `.auto-approve`
- usage cache

Most runtime/config modules now depend on repositories in this folder instead of reading and writing files directly.

### `src/config`

- `access.ts`: access control rules
- `backend-route.ts`: per-chat backend routing rules
- `poll-owner.ts`: single-consumer polling lease

### `src/codex`

- `app-server.ts`: JSON-RPC process client for `codex app-server`
- `bridge.ts`: thread lifecycle, turn tracking, approval handling, outbound reply assembly

### `src/claude`

- `proxy.ts`: MCP stdio proxy used by Claude Code

### `src/ipc`

- local daemon/proxy JSON-lines socket protocol

### `src/weixin`

- WeChat API client
- media upload/download
- inbound payload preparation

## State Model

Persistent state under `${XDG_STATE_HOME:-~/.local/state}/weixin-plugin-cc-cx/` by default,
or `WEIXIN_STATE_DIR` if set:

- `account.json`
- `access.json`
- `backend-route.json`
- `codex-threads.json`
- `.cursor`
- `.usage-cache.json`
- `.auto-approve`
- `daemon.sock`
- `poll-owner.json`
- `inbox/`

Ephemeral in-memory state:

- current context tokens per chat
- temporary media handles for attachment downloads
- pending Claude permission requests
- pending Codex approvals
- active Codex turns

## Testing Strategy

Tests use Node's built-in `node:test` runner with `tsx`.

Current coverage focuses on:

- command parsing
- inbound dispatch
- access control and backend route persistence
- poll lease behavior
- session TTL behavior
- Codex thread persistence and approval replies

Run:

```bash
npm test
npm run typecheck
npm run build
```
