---
name: taskify-cli
description: Use the Taskify CLI to manage tasks, boards, inbox triage, exports/imports, trust, and profiles over Nostr. Trigger when users ask to list/add/update/complete/delete/search tasks, manage board metadata, run inbox triage, or perform Taskify agent commands from terminal workflows (not browser UI automation).
---

# Taskify CLI

Use deterministic CLI-first workflows for Taskify.

## Command surface

Primary executable: `taskify`
Repo location: `/Users/openclaw/.openclaw/workspace/Taskify_Release/taskify-cli`

If `taskify` is missing globally, run via local package:
- `cd /Users/openclaw/.openclaw/workspace/Taskify_Release/taskify-cli`
- `npm run build` (if needed)
- `node dist/index.js <args>`

## Safety and reliability rules

1. Prefer read commands first (`list`, `show`, `search`, `boards`, `board columns`) before mutating state.
2. For destructive commands (`delete`, `board leave`, imports without `--dry-run`), confirm exact target identity first.
3. Use `--json` whenever machine-verifiable output is needed.
4. For ambiguous title matches, resolve exact task ID via `taskify search <query> --status any --json`.
5. Never claim success until exit code is 0 and output confirms expected mutation.

## Fast workflows

### List and filter
- Open tasks (table): `taskify list`
- Open tasks (JSON): `taskify list --json`
- Include done: `taskify list --status any --json`
- Filter by board/column: `taskify list --board "<board>" --column "<column>" --json`

### Create task
- Minimal: `taskify add "<title>"`
- Rich: `taskify add "<title>" --board "<board>" --due "YYYY-MM-DD" --priority 2 --note "..." --subtask "..." --column "..."`

### Update task
1. Resolve ID:
   - `taskify search "<query>" --status any --json`
2. Update fields:
   - `taskify update <taskId> --title "..." --due "YYYY-MM-DD" --priority 1 --note "..." --column "..."`

### Complete / reopen / delete
- Complete: `taskify done <taskId> --board "<board>"`
- Reopen: `taskify reopen <taskId> --board "<board>"`
- Delete: `taskify delete <taskId> --board "<board>" --force`

### Inbox triage
- List inbox: `taskify inbox list --board "<board>"`
- Quick add: `taskify inbox add "<title>" --board "<board>"`
- Triage: `taskify inbox triage <taskId> --board "<board>" --column "<column>" --priority 2 --due "YYYY-MM-DD" --yes`

### Boards and columns
- List boards: `taskify boards --json`
- Joined boards: `taskify board list`
- Board columns: `taskify board columns "<board>"`
- Sync board metadata: `taskify board sync`

### Export/import
- Export JSON: `taskify export --board "<board>" --format json --output /tmp/tasks.json`
- Export CSV/MD: `taskify export --board "<board>" --format csv --output /tmp/tasks.csv`
- Import dry run: `taskify import /tmp/tasks.json --board "<board>" --dry-run`
- Import apply: `taskify import /tmp/tasks.json --board "<board>" --yes`

### Profiles
- List: `taskify profile list`
- Use profile: `taskify profile use <name>`
- One-shot profile: `taskify list --profile <name> --json`

## Task ID resolution pattern (required for edits/deletes)

1. `taskify search "<title fragment>" --status any --json`
2. Prefer exact title match (and board match if provided).
3. If multiple matches remain, ask one clarification question.
4. Execute mutation with resolved `<taskId>`.
5. Re-read with `taskify show <taskId> --json` or `taskify list --status any --json` to verify.

## Output contract

For agent responses, return concise structure:
- `status`: `ok` | `failed`
- `action`: command intent
- `evidence`: command(s) + key output proof (ID/state)
- `error`: present only on failure

## References

- CLI commands and examples: `references/command-reference.md`
- Troubleshooting and fallback execution: `references/troubleshooting.md`
