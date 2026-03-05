# Taskify Agent CLI (MVP)

A terminal CLI that talks to Taskify's **existing Agent Mode contract** (`window.taskifyAgent.exec`) so commands stay cross-compatible with the app.

## Why this works
- Uses the same command envelope (`v`, `id`, `op`, `params`) as Agent Mode
- Executes through the real app runtime, so behavior stays aligned
- Keeps login/session in a persistent Chromium profile

## Install

```bash
cd taskify-cli
npm install
npm link
```

Then run:

```bash
taskify-agent help
```

## Plaintext commands (easy mode)

```bash
taskify-agent "list"
taskify-agent "list open 20"
taskify-agent "list any query Nathan"
taskify-agent "list open board board-abc"
taskify-agent "done task-123"
taskify-agent "get task-123"
taskify-agent "create Buy groceries"
```

Plaintext `list` keywords (positional, order-insensitive):
- `open` / `done` / `any` — filter by status (default: `open`)
- `<number>` — result limit (default: 25)
- `query <text>` — free-text search (rest of string)
- `board <boardId>` — filter to a specific board

## Structured commands (advanced)

```bash
# list open tasks
taskify-agent list --status open --limit 25

# list with text search
taskify-agent list --status any --query "Nathan" --limit 10

# list filtered to a board
taskify-agent list --status open --board board-abc

# mark done
taskify-agent done task-123

# get one task
taskify-agent get task-123

# create (minimal)
taskify-agent create "Buy groceries"

# create (all flags)
taskify-agent create "Review PR" --note "Check tests" --priority 2 --due 2026-03-10T09:00:00Z --board board-abc

# raw op
taskify-agent raw task.list --params '{"status":"any","query":"Nathan"}'

# full envelope passthrough
taskify-agent exec '{"v":1,"id":"help-1","op":"meta.help","params":{}}'
```

### Command flag reference

**`list`**

| Flag | Default | Notes |
|---|---|---|
| `--status` | `open` | `open`, `done`, or `any` |
| `--limit` | `25` | Max results |
| `--query` | — | Free-text search |
| `--board` | — | Filter by board ID |

**`create`**

| Flag | Default | Notes |
|---|---|---|
| `--note` | — | Task note/description |
| `--priority` | — | `1` (low), `2` (medium), `3` (high) |
| `--due` | — | ISO 8601 due date (e.g. `2026-03-10T09:00:00Z`) |
| `--board` | — | Board ID to assign task to |

**`raw`**

| Arg | Notes |
|---|---|
| `<op>` | Any agent op string (e.g. `task.list`) |
| `--params` | JSON params object (default: `{}`) |

## Options

| Flag | Default | Notes |
|---|---|---|
| `--url <url>` | `https://taskify-v2.solife.me/?agent=1` | Taskify app URL |
| `--profile <path>` | `~/.taskify-agent-cli/profile` | Chromium persistent profile directory |
| `--headed` | off | Run with visible browser window |
| `--timeout <ms>` | `30000` | Max wait time for agent bridge availability |
| `--json` | off | Print compact single-line JSON |

## Notes
- First run may require login if your profile is empty.
- This is an MVP scaffold designed for compatibility-first behavior.
- Exit code `0` = `ok: true`, `1` = `ok: false`, `2` = CLI/parse error.
