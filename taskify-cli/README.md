# taskify-cli

A command-line client for managing tasks over the Nostr protocol.

## Global Install

```bash
cd taskify-cli
npm install
npm link        # installs `taskify` globally
taskify --help
```

Note: Requires Node.js 22+.

If `npm link` fails due to permissions, try:

```bash
npm link --prefix ~/.local
```

Then add `~/.local/bin` to your `PATH`.

## Install & Setup

**Requirements:** Node.js 22+ (for `--experimental-strip-types`)

```bash
cd taskify-cli
npm install
npm link
```

### Configure your private key

```bash
# From file
taskify config set nsec nsec1...

# Or via environment variable (takes precedence over saved config)
export TASKIFY_NSEC=nsec1...
```

### Configure relays (optional — defaults provided)

```bash
taskify config set relay wss://relay.damus.io
```

### Show current config

```bash
taskify config show
```

---

## Command Reference

| Command | Options | Description |
|---|---|---|
| `list` | `--board <name>` `--status open\|done\|any` `--json` | List tasks, optionally filtered |
| `add <title>` | `--board <name>` `--due <YYYY-MM-DD>` `--priority <1\|2\|3>` `--note <text>` `--subtask <text>` | Create a new task |
| `show <taskId>` | `--board <name>` `--json` | Show full task details |
| `done <taskId>` | `--board <name>` | Mark a task as done (accepts 8-char prefix or full ID) |
| `reopen <taskId>` | `--board <name>` | Reopen a completed task (accepts 8-char prefix or full ID) |
| `delete <taskId>` | `--board <name>` `--force` | Publish status=deleted to Nostr (accepts 8-char prefix or full ID) |
| `subtask <taskId> <ref>` | `--board <name>` `--done` `--reopen` | Toggle a subtask done/incomplete (ref = 1-based index or title substring) |
| `update <taskId>` | `--title <t>` `--due <d>` `--priority <p>` `--note <n>` | Update task fields (accepts 8-char prefix or full ID) |
| `boards` | | List boards with task counts, sorted by count |
| `trust add <npub>` | | Mark an npub as trusted |
| `trust remove <npub>` | | Remove a trusted npub |
| `trust list` | | List all trusted npubs |
| `config set nsec <nsec>` | | Save your private key |
| `config set relay <url>` | | Add a relay URL |
| `config show` | | Show current config |

### `--board` fuzzy match

The `--board` filter is case-insensitive substring match:

```bash
taskify list --board dev   # matches board "Dev", "Development", etc.
```

---

## Example Output

### `taskify list`

```
Board: Dev
ID        TITLE                                     DUE           PRI   TRUST
e5100d28  Ship v2 release (2/4)                     2026-03-15    2     ✓ trusted
a8c2f4b0  Fix login bug                             2026-03-10    3     ✗ untrusted
```

- **ID** — first 8 hex chars of the Nostr event ID
- **TITLE** — truncated at 40 chars; `(N/M)` shows completed/total subtasks when present
- **DUE** — ISO date (YYYY-MM-DD)
- **PRI** — priority 1 (low) to 3 (high)
- **TRUST** — `✓ trusted` if `lastEditedBy` matches a trusted npub, `✗ untrusted` otherwise

### `taskify boards`

```
  Dev           3 tasks (2 open, 1 done)
  Personal      1 tasks (1 open, 0 done)
```

Sorted by total task count descending.

### `taskify list --json`

Outputs a JSON array. Each object contains all task fields:

```json
[
  {
    "id": "a8c2f4b0...",
    "boardId": "Dev",
    "title": "Ship v2 release",
    "note": "Includes changelog",
    "dueISO": "2026-03-15",
    "dueDateEnabled": true,
    "priority": 2,
    "completed": false,
    "completedAt": null,
    "createdBy": "1a2988df...",
    "lastEditedBy": "1a2988df...",
    "createdAt": 1773019736,
    "updatedAt": "2026-03-09T01:28:56.902Z"
  }
]
```

---

## Agent Usage

Taskify is designed for use by AI agents via the `--json` flag.

### Trust model

Every Nostr event carries the pubkey of its author (`createdBy`) and optionally an `editor` tag (`lastEditedBy`). The CLI compares `lastEditedBy` against your configured `trustedNpubs` list.

- **`✓ trusted`** — the last editor's npub is in your trusted list
- **`✗ untrusted`** — last editor is unknown or not in your list
- **`? unknown`** — no editor information available

### Agent workflow

```bash
# 1. List open tasks as JSON for processing
taskify list --status any --json

# 2. Update a task
taskify update <id> --title "New title" --priority 2

# 3. Mark done
taskify done <id>
```

All commands exit with code `0` on success, `1` on error. They do not hang — a 10-second relay timeout is enforced and WebSocket connections are torn down on exit.

### Environment override

Set `TASKIFY_NSEC` to override the saved private key without modifying config:

```bash
TASKIFY_NSEC=nsec1... taskify list --json
```

## Shell Completions

```bash
# zsh
taskify completions --shell zsh > ~/.zsh/completions/_taskify
echo "fpath=(~/.zsh/completions $fpath)" >> ~/.zshrc
echo "autoload -U compinit && compinit" >> ~/.zshrc
source ~/.zshrc

# bash
taskify completions --shell bash > ~/.bash_completion.d/taskify
source ~/.bash_completion.d/taskify

# fish
taskify completions --shell fish > ~/.config/fish/completions/taskify.fish
```
