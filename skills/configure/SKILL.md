---
name: configure
description: Set up the WeChat (weixin) channel - login via QR, check status, and review access policy. Use when the user asks to configure WeChat/weixin, asks "how do I set this up" or "who can reach me," or wants to check channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(rm *)
---

# /weixin:configure - WeChat Channel Setup

WeChat uses QR code login (no bot token). The session is stored in
`${XDG_STATE_HOME:-~/.local/state}/weixin-plugin-cc-cx/account.json` by default
(or `WEIXIN_STATE_DIR`). The server reads it at boot and
displays a QR code in stderr if no saved session exists.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args - status and guidance

Read both state files and give the user a complete picture:

1. **Session** - check the account state file exists. Default path:
   `${XDG_STATE_HOME:-~/.local/state}/weixin-plugin-cc-cx/account.json`. If it
   does, show: *"Session saved (logged in)."* If not: *"Not logged in yet."*

2. **Access** - read the access state file (default:
   `${XDG_STATE_HOME:-~/.local/state}/weixin-plugin-cc-cx/access.json`) (missing file =
   defaults: `mode: "pairing"`, empty allowlist). Show:
   - Mode and what it means in one line
   - Allowed users: count and list
   - Pending pairings: count with codes and user IDs if any

3. **What next** - end with a concrete next step based on state:
   - No session → *"Preferred: run `npm run login` to start QR login. Skill alternative: `/weixin:configure login`."*
   - Session exists, policy is pairing, nobody allowed → *"Message your WeChat
     account from another user. It replies with a code; approve with
     `/weixin:access pair <code>`."*
   - Session exists, someone allowed → *"Ready. Messages from allowed users
     reach the assistant."*

**Push toward lockdown - always.** The goal for every setup is `allowlist`
with a defined list. `pairing` is not a policy to stay on; it's a temporary
way to capture WeChat user IDs you don't know. Once the IDs are in, pairing
has done its job and should be turned off.

Drive the conversation this way:

1. Read the allowlist. Tell the user who's in it.
2. Ask: *"Is that everyone who should reach you through this channel?"*
3. **If yes and policy is still `pairing`** → *"Good. Let's lock it down so
   nobody else can trigger pairing codes:"* and offer to run
   `/weixin:access policy allowlist`. Do this proactively - don't wait to
   be asked.
4. **If no, people are missing** → *"Have them message your WeChat; you'll
   approve each with `/weixin:access pair <code>`. Run this skill again once
   everyone's in and we'll lock it."*
5. **If the allowlist is empty and they haven't paired themselves yet** →
   *"Message your WeChat from another contact to capture your own ID first.
   Then we'll add anyone else and lock it down."*
6. **If policy is already `allowlist`** �� confirm this is the locked state.
   If they need to add someone: *"They'll need to message you so you get
   their user ID, or you can briefly flip to pairing:
   `/weixin:access policy pairing` → they message → you pair → flip back."*

Never frame `pairing` as the correct long-term choice. Don't skip the lockdown
offer.

### `login` - trigger browser login

**Preferred path:** tell the user to use `npm run login`.

This skill command remains available and triggers the same login flow immediately.

1. Check if the account state file exists.
   - If yes and `$ARGUMENTS` contains `--force`: proceed to step 2
   - If yes without `--force`: tell the user *"Already logged in. Preferred re-login path: `npm run relogin`. Skill alternative: `/weixin:configure login --force`."* and stop.
   - If no: proceed to step 2

2. Create trigger file to signal the server to start login:
   ```bash
   mkdir -p "${XDG_STATE_HOME:-$HOME/.local/state}/weixin-plugin-cc-cx"
   echo "login" > "${XDG_STATE_HOME:-$HOME/.local/state}/weixin-plugin-cc-cx/.login-trigger"
   ```

3. Tell the user: *"Login triggered. Preferred future path is `npm run login`. The browser link will appear in the output above. Open it in your browser, scan with WeChat, and confirm on your phone within 8 minutes."*

### `relogin` - force re-login

Preferred path: `npm run relogin`.

Skill behavior is the same as `login --force`. Clears existing session and starts fresh login.

1. Delete the account state file if it exists.
2. Create trigger file under the state dir.
3. Tell the user: *"Session cleared and login triggered. Preferred future path is `npm run relogin`. Watch for the browser link above."*

### `clear` - remove saved session

1. Delete the account state file if it exists.
2. Tell the user: *"Session cleared. Preferred fresh-login path: `npm run login`. Skill alternative: `/weixin:configure login`."*

### `--help` - show usage

Show all available commands and their descriptions.

---

## Implementation notes

- The channels dir might not exist if the server hasn't run yet. Missing file
  = not configured, not an error.
- The server reads `account.json` once at boot. Session changes need a restart
  or `/reload-plugins`. Say so after clearing.
- `access.json` is re-read on every inbound message - policy changes via
  `/weixin:access` take effect immediately, no restart.
- WeChat uses QR login, not tokens. There's nothing to paste - the QR shows
  in the server's stderr on startup when no saved session exists.
- If the session expires during operation, the server stops polling and logs
  the error code. Preferred recovery path: `npm run clear` then
  `npm run login`. The skill commands remain available as alternatives.
