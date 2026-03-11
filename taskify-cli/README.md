# taskify-cli

A command-line client for managing tasks over the Nostr protocol.

## Install

```bash
cd taskify-cli
npm install
npm link        # installs `taskify` globally
taskify --help
```

**Requirements:** Node.js 22+ (for `--experimental-strip-types`)

If `npm link` fails due to permissions:

```bash
npm link --prefix ~/.local
# then add ~/.local/bin to your PATH
```

---

## Setup

### Private key

```bash
taskify config set nsec nsec1...
# or via environment variable (takes precedence):
export TASKIFY_NSEC=nsec1...
```

### Relays (optional — defaults provided)

```bash
taskify config set relay wss://relay.damus.io
taskify relay list
taskify relay status
```

### Show config

```bash
taskify config show
```

---

## Command Reference

### Task commands

| Command | Options | Description |
|---|---|---|
| `list` | `--board` `--status open\|done\|any` `--column` `--json` | List tasks |
| `add <title>` | `--board` `--due` `--priority 1\|2\|3` `--note` `--subtask` `--column` | Create a task |
| `show <taskId>` | `--board` `--json` | Show full task details |
| `update <taskId>` | `--title` `--due` `--priority` `--note` `--column` | Update task fields |
| `done <taskId>` | `--board` | Mark a task done |
| `reopen <taskId>` | `--board` | Reopen a completed task |
| `delete <taskId>` | `--board` `--force` | Delete a task |
| `search <query>` | `--board` `--status` `--json` | Full-text search across tasks |
| `subtask <taskId> <ref>` | `--board` `--done` `--reopen` | Toggle a subtask (ref = index or title substring) |
| `remind <taskId> <presets...>` | `--board` | Set reminder presets (e.g. `1d 1h`) |
| `assign <taskId> <npub\|hex>` | `--board` | Assign a user to a task |
| `unassign <taskId> <npub\|hex>` | `--board` | Unassign a user from a task |

### Inbox

| Command | Options | Description |
|---|---|---|
| `inbox list` | `--board` | List inbox items (tasks flagged for triage) |
| `inbox add <title>` | `--board` | Quick-capture a task to inbox |
| `inbox triage <taskId>` | `--board` `--column` `--priority` `--due` `--yes` | Interactively triage an inbox item |

### Export / Import

| Command | Options | Description |
|---|---|---|
| `export` | `--board` `--format json\|csv\|md` `--status` `--output <file>` | Export tasks |
| `import <file>` | `--board` `--dry-run` `--yes` | Import tasks from JSON or CSV |

Export formats:
- `json` — JSON array (default)
- `csv` — RFC 4180 with headers: `id,title,status,priority,dueISO,column,boardName,note,subtasks,createdAt`
- `md` — Markdown checklist grouped by column

Import accepts `.json` (array of `{title, note?, priority?, dueISO?, column?, subtasks?}`) or `.csv` (same schema as export). Duplicate titles on the same board are skipped.

### Board management

| Command | Options | Description |
|---|---|---|
| `boards` | `--json` | List all boards with task counts |
| `board list` | | List joined boards |
| `board join <boardId>` | `--name` `--relay` | Join a board by Nostr event id |
| `board leave <boardId>` | | Leave a board |
| `board create <name>` | `--kind lists\|week` `--relay` | Create and publish a new board |
| `board sync [boardId]` | | Sync board metadata and columns from relay |
| `board columns [board]` | | List columns for a board |
| `board children <board>` | | List child boards (compound boards only) |

### Relay management

| Command | Description |
|---|---|
| `relay status` | Show relay connection status |
| `relay list` | List configured relays |
| `relay add <url>` | Add a relay |
| `relay remove <url>` | Remove a relay |

### Trust

| Command | Description |
|---|---|
| `trust add <npub>` | Mark an npub as trusted |
| `trust remove <npub>` | Remove a trusted npub |
| `trust list` | List all trusted npubs |

### AI agent (`taskify agent`)

| Command | Options | Description |
|---|---|---|
| `agent config show` | | Show AI agent config (key masked) |
| `agent config set-key <key>` | | Set OpenAI API key |
| `agent config set-model <model>` | | Set model (default: `gpt-4o-mini`) |
| `agent config set-url <url>` | | Set base URL (default: OpenAI) |
| `agent add <description>` | `--board` `--yes` `--dry-run` `--json` | NL → task via AI extraction |
| `agent triage` | `--board` `--yes` `--dry-run` `--json` | AI priority suggestions across open tasks |

`agent add` extracts title, note, priority, due date, column, and subtasks from a natural language description. Reviews extracted fields before creating (skippable with `--yes`).

`agent triage` sends all open tasks to the AI for priority scoring, prints a suggestion table, then applies changes on confirmation.

API key can also be set via `TASKIFY_AGENT_API_KEY` environment variable.

### Cache

| Command | Description |
|---|---|
| `cache status` | Show cache age and task counts |
| `cache clear` | Clear the local task cache |

### Shell completions

```bash
# zsh
taskify completions --shell zsh > ~/.zsh/completions/_taskify
echo 'fpath=(~/.zsh/completions $fpath)' >> ~/.zshrc
echo 'autoload -U compinit && compinit' >> ~/.zshrc
source ~/.zshrc

# bash
taskify completions --shell bash > ~/.bash_completion.d/taskify
source ~/.bash_completion.d/taskify

# fish
taskify completions --shell fish > ~/.config/fish/completions/taskify.fish
```

---

## Column support

Boards with columns (`kind: lists` or `kind: week`) support column-aware operations:

```bash
# Add a task to a specific column
taskify add "Fix auth bug" --board "Dev" --column "Bugs"

# Filter list by column
taskify list --board "Dev" --column "In Progress"

# Move a task to a different column
taskify update <taskId> --column "Done"
```

Week boards auto-assign tasks to today's column (YYYY-MM-DD) when no `--column` is specified.

Use `taskify board sync` to pull the latest column definitions from the relay, then `taskify board columns` to list them.

---

## Compound boards

Compound boards aggregate multiple child boards. `taskify list` on a compound board fetches and merges tasks from all children automatically.

```bash
taskify board sync
taskify board children "My Compound Board"
taskify list --board "My Compound Board"   # merges all children
```

Adding tasks to a compound board directly is not allowed — use a child board instead.

---

## Multiple profiles

Each agent or user can have their own named Nostr identity:

```bash
# List profiles
taskify profile list

# Add a new identity
taskify profile add ink

# Switch active profile
taskify profile use ink

# Use a profile for one command without switching
taskify list --profile cody --board "Dev"

# Show profile details
taskify profile show

# Rename a profile
taskify profile rename ink writer

# Remove a profile (cannot remove the active one)
taskify profile remove old-profile --force
```

Profiles store separate nsec, relays, boards, and trusted npubs.
The active profile is used by default for all commands.
Use `--profile <name>` (`-P <name>`) on any command to use a different profile without switching.

### Profile commands

| Command | Options | Description |
|---|---|---|
| `profile list` | | List all profiles (► marks active) |
| `profile add <name>` | | Add a new profile (mini onboarding) |
| `profile use <name>` | | Switch active profile |
| `profile show [name]` | | Show profile details (defaults to active) |
| `profile remove <name>` | `--force` | Remove a profile |
| `profile rename <old> <new>` | | Rename a profile |

---

## Example output

### `taskify list`

```
Board: Dev
ID        TITLE                                     DUE           PRI   COL        TRUST
e5100d28  Ship v2 release (2/4)                     2026-03-15    2     Backlog    ✓
a8c2f4b0  Fix login bug                             2026-03-10    3     Bugs       ✓
```

- **ID** — 8-char prefix (accepted by all commands)
- **TITLE** — truncated at 40 chars; `(N/M)` = completed/total subtasks
- **COL** — column name if on a lists/compound board
- **TRUST** — `✓` if `lastEditedBy` is a trusted npub

### `taskify list --json`

```json
[
  {
    "id": "a8c2f4b0...",
    "boardId": "...",
    "boardName": "Dev",
    "title": "Fix login bug",
    "note": "",
    "dueISO": "2026-03-10",
    "priority": 3,
    "column": "bugs-col-id",
    "completed": false,
    "subtasks": [],
    "assignees": [],
    "inboxItem": false,
    "createdAt": 1773019736
  }
]
```

---

## Agent usage

Taskify is built for AI agent workflows. All commands support `--json` output and exit `0` on success / `1` on error. A 10-second relay timeout is enforced; connections are torn down on exit.

```bash
# List open tasks as JSON
taskify list --status any --json

# Create a task with AI assistance
taskify agent add "urgent: fix the login crash by tomorrow" --board Dev --yes

# Triage priorities across the board
taskify agent triage --board Dev --yes

# Bulk import from JSON
taskify import tasks.json --board Dev --yes
```

### Trust model

- **`✓ trusted`** — `lastEditedBy` pubkey is in your trusted list
- **`✗ untrusted`** — editor unknown or not in list
- **`? unknown`** — no editor information

---

## Environment variables

| Variable | Description |
|---|---|
| `TASKIFY_NSEC` | Override saved private key |
| `TASKIFY_AGENT_API_KEY` | OpenAI API key for `taskify agent` |
