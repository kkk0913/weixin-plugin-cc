---
name: status
description: Show WeChat bridge connection and runtime status. Use when the user wants to check whether the daemon, Claude Code, or Codex backend is connected.
user-invocable: true
allowed-tools:
  - Read
  - Bash(ls *)
  - Bash(cat *)
---

# /weixin:status - WeChat Bridge Status

Show the current connection and runtime status of the WeChat bridge.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args - show status

1. Check if the daemon socket file exists (default: `${XDG_STATE_HOME:-~/.local/state}/weixin-plugin-cc-cx/daemon.sock`).
2. Check if a daemon process is running (via `pgrep`).
3. Read `access.json` to show access mode and allowed users count.
4. Read `account.json` to check login session status.
5. Summarize:
   - Daemon: running / not running
   - Socket: exists / missing
   - Session: logged in / not logged in
   - Access mode: pairing / allowlist / disabled
   - Allowed users: count

### `--help` - show usage

Show available commands:

| Command | Description |
|---------|-------------|
| `/weixin:status` | Show daemon and connection status |
