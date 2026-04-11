---
name: permission
description: Manage WeChat channel permission mode - switch between auto-approve, manual, and bypass modes. Use when the user wants to change how tool permissions are handled via WeChat.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(cat *)
  - Bash(rm *)
  - Bash(mkdir *)
---

# /weixin:permission - Permission Mode Management

Manage how Claude Code tool permission requests are handled via the WeChat channel.

State file: `${XDG_STATE_HOME:-~/.local/state}/weixin-plugin-cc-cx/.auto-approve` by default
(or `WEIXIN_STATE_DIR`)
- File exists → auto-approve mode (all permissions automatically allowed)
- File absent → manual mode (each permission sent to WeChat for yes/no)

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args - show current mode

1. Check if the auto-approve flag file exists.
2. Show current mode:
   - File exists: *"Permission mode: **auto** — all tool permissions are automatically approved. Send `stopall` in WeChat or run `/weixin:permission manual` to switch to manual."*
   - File absent: *"Permission mode: **manual** — each permission request is sent to WeChat for approval. Reply `yes`/`no` per request, or `yesall` to switch to auto-approve."*

### `auto` - enable auto-approve

1. Create the flag file:
   ```bash
   mkdir -p "${XDG_STATE_HOME:-$HOME/.local/state}/weixin-plugin-cc-cx"
   echo "1" > "${XDG_STATE_HOME:-$HOME/.local/state}/weixin-plugin-cc-cx/.auto-approve"
   ```
2. Tell the user: *"Auto-approve enabled ✓ All tool permissions will be automatically approved. Run `/weixin:permission manual` to disable."*

### `manual` - disable auto-approve

1. Remove the flag file:
   ```bash
   rm -f "${XDG_STATE_HOME:-$HOME/.local/state}/weixin-plugin-cc-cx/.auto-approve"
   ```
2. Tell the user: *"Manual mode enabled ✗ Tool permissions will be sent to WeChat for approval."*

### `bypass` - use Claude Code's built-in bypass

This is not handled by the WeChat plugin. Tell the user:

*"To bypass all permission prompts at the Claude Code level, start with:"*

```
claude --dangerously-skip-permissions
```

*"This skips ALL permission checks, not just WeChat relay. Use with caution."*

### `--help` - show usage

Show available commands:

| Command | Description |
|---------|-------------|
| `/weixin:permission` | Show current permission mode |
| `/weixin:permission auto` | Auto-approve all permissions |
| `/weixin:permission manual` | Require manual approval via WeChat |
| `/weixin:permission bypass` | Info on Claude Code's built-in bypass |

---

## WeChat commands

Users can also control permission mode directly from WeChat:

| Message | Action |
|---------|--------|
| `yes` / `no` | Approve or deny the current pending request |
| `yesall` | Enable auto-approve mode |
| `stopall` | Disable auto-approve, return to manual mode |
