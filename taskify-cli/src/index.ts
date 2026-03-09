#!/usr/bin/env node --experimental-strip-types
import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveConfig } from "./config.ts";
import { createNostrRuntime, type NostrRuntime } from "./nostrRuntime.ts";
import { renderTable, renderTaskCard, renderJson } from "./render.ts";
import { zshCompletion, bashCompletion, fishCompletion } from "./completions.ts";
import { readCache, clearCache, CACHE_PATH, CACHE_TTL_MS } from "./taskCache.ts";

const program = new Command();

program
  .name("taskify")
  .version("0.1.0")
  .description("Taskify CLI — manage tasks over Nostr");

// ---- Validation helpers ----

function validateDue(due: string | undefined): void {
  if (!due) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    console.error(chalk.red(`Invalid --due format: "${due}". Expected YYYY-MM-DD.`));
    process.exit(1);
  }
}

function validatePriority(pri: string | undefined): void {
  if (!pri) return;
  if (!["1", "2", "3"].includes(pri)) {
    console.error(chalk.red(`Invalid --priority: "${pri}". Must be 1, 2, or 3.`));
    process.exit(1);
  }
}

function warnShortTaskId(taskId: string): void {
  if (taskId.length < 8) {
    console.warn(chalk.yellow(`Warning: taskId "${taskId}" is suspiciously short (< 8 chars). Attempting anyway.`));
  }
}

const VALID_REMINDER_PRESETS = new Set(["0h", "5m", "15m", "30m", "1h", "1d", "1w"]);

function initRuntime(config: Parameters<typeof createNostrRuntime>[0]): NostrRuntime {
  try {
    return createNostrRuntime(config);
  } catch (err) {
    console.error(chalk.red(String(err)));
    process.exit(1);
  }
}

/**
 * Resolve a boardId for commands that need it.
 * - If --board given: look it up in config.boards by UUID or name; error if not found.
 * - If no --board and exactly one board configured: use it automatically.
 * - If no --board and multiple boards: print list and error.
 */
async function resolveBoardId(
  boardOpt: string | undefined,
  config: Awaited<ReturnType<typeof loadConfig>>,
): Promise<string> {
  if (boardOpt) {
    const entry =
      config.boards.find((b) => b.id === boardOpt) ??
      config.boards.find((b) => b.name.toLowerCase() === boardOpt.toLowerCase());
    if (!entry) {
      console.error(chalk.red(`Board not found: "${boardOpt}". Known boards:`));
      for (const b of config.boards) {
        console.error(`  ${b.name} (${b.id})`);
      }
      process.exit(1);
    }
    return entry.id;
  }
  if (config.boards.length === 1) {
    return config.boards[0].id;
  }
  if (config.boards.length === 0) {
    console.error(chalk.red("No boards configured. Use: taskify board join <id> --name <name>"));
    process.exit(1);
  }
  console.error(chalk.red("Multiple boards configured. Specify one with --board <id|name>:"));
  for (const b of config.boards) {
    console.error(`  ${b.name} (${b.id})`);
  }
  process.exit(1);
}

// ---- board command group ----
const boardCmd = program
  .command("board")
  .description("Manage boards");

boardCmd
  .command("list")
  .description("List all configured boards")
  .action(async () => {
    const config = await loadConfig();
    if (config.boards.length === 0) {
      console.log(chalk.dim("No boards configured. Use: taskify board join <id> --name <name>"));
    } else {
      for (const b of config.boards) {
        const relays = b.relays?.length ? `  [${b.relays.join(", ")}]` : "";
        console.log(`  ${chalk.bold(b.name.padEnd(16))} ${chalk.dim(b.id)}${relays}`);
      }
    }
    process.exit(0);
  });

boardCmd
  .command("join <boardId>")
  .description("Join a board by its UUID")
  .option("--name <name>", "Human-readable name for this board")
  .option("--relay <url>", "Additional relay URL for this board")
  .action(async (boardId: string, opts) => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(boardId)) {
      console.warn(chalk.yellow(`Warning: "${boardId}" does not look like a UUID.`));
    }
    const config = await loadConfig();
    const existing = config.boards.find((b) => b.id === boardId);
    if (existing) {
      console.log(chalk.dim(`Already on board ${existing.name} (${boardId})`));
      process.exit(0);
    }
    const name = opts.name ?? boardId.slice(0, 8);
    const entry: { id: string; name: string; relays?: string[] } = { id: boardId, name };
    if (opts.relay) {
      entry.relays = [opts.relay];
    }
    config.boards.push(entry);
    await saveConfig(config);
    console.log(chalk.green(`✓ Joined board ${name} (${boardId})`));
    // Auto-sync board metadata immediately after joining
    try {
      const runtime = initRuntime(config);
      const meta = await runtime.syncBoard(boardId);
      if (meta.kind || (meta.columns && meta.columns.length > 0)) {
        const colCount = meta.columns?.length ?? 0;
        console.log(chalk.dim(`  Synced: kind=${meta.kind ?? "?"}, columns=${colCount}`));
      }
      await runtime.disconnect();
    } catch { /* non-fatal if sync fails on join */ }
    process.exit(0);
  });

boardCmd
  .command("sync [boardId]")
  .description("Sync board metadata (kind, columns) from Nostr")
  .action(async (boardId?: string) => {
    const config = await loadConfig();
    if (config.boards.length === 0) {
      console.error(chalk.red("No boards configured."));
      process.exit(1);
    }
    const toSync = boardId
      ? (() => {
          const entry =
            config.boards.find((b) => b.id === boardId) ??
            config.boards.find((b) => b.name.toLowerCase() === boardId.toLowerCase());
          if (!entry) {
            console.error(chalk.red(`Board not found: "${boardId}"`));
            process.exit(1);
          }
          return [entry];
        })()
      : config.boards;
    const runtime = initRuntime(config);
    let exitCode = 0;
    try {
      for (const entry of toSync) {
        try {
          const meta = await runtime.syncBoard(entry.id);
          const colCount = meta.columns?.length ?? 0;
          const kindStr = meta.kind ?? "unknown";
          const reloadedEntry = (await loadConfig()).boards.find((b) => b.id === entry.id);
          const childrenCount = reloadedEntry?.children?.length ?? 0;
          const childrenStr = kindStr === "compound" ? `, children: ${childrenCount}` : "";
          console.log(chalk.green(`✓ Synced: ${entry.name} (kind: ${kindStr}, columns: ${colCount}${childrenStr})`));
        } catch (err) {
          console.error(chalk.red(`  ✗ Failed to sync ${entry.name}: ${String(err)}`));
          exitCode = 1;
        }
      }
    } finally {
      await runtime.disconnect();
      process.exit(exitCode);
    }
  });

boardCmd
  .command("leave <boardId>")
  .description("Remove a board from config")
  .action(async (boardId: string) => {
    const config = await loadConfig();
    const before = config.boards.length;
    config.boards = config.boards.filter((b) => b.id !== boardId);
    if (config.boards.length === before) {
      console.error(chalk.red(`Board not found: ${boardId}`));
      process.exit(1);
    }
    await saveConfig(config);
    console.log(chalk.green(`✓ Left board ${boardId}`));
    process.exit(0);
  });

boardCmd
  .command("columns")
  .description("Show cached columns for all configured boards")
  .action(async () => {
    const config = await loadConfig();
    if (config.boards.length === 0) {
      console.log(chalk.dim("No boards configured. Use: taskify board join <id> --name <name>"));
      process.exit(0);
    }
    for (const b of config.boards) {
      const kindStr = b.kind ? ` (${b.kind})` : "";
      console.log(chalk.bold(`${b.name}${kindStr}:`));
      if (!b.columns || b.columns.length === 0) {
        console.log(chalk.dim(`  — no columns cached (run: taskify board sync)`));
      } else {
        for (const col of b.columns) {
          console.log(`  [${chalk.cyan(col.id)}] ${col.name}`);
        }
      }
    }
    process.exit(0);
  });

boardCmd
  .command("children <board>")
  .description("List children of a compound board")
  .action(async (boardArg: string) => {
    const config = await loadConfig();
    const entry =
      config.boards.find((b) => b.id === boardArg) ??
      config.boards.find((b) => b.name.toLowerCase() === boardArg.toLowerCase());
    if (!entry) {
      console.error(chalk.red(`Board not found: "${boardArg}"`));
      process.exit(1);
    }
    if (entry.kind !== "compound") {
      console.log(chalk.dim(`Board is not a compound board (kind: ${entry.kind ?? "unknown"})`));
      process.exit(0);
    }
    if (!entry.children || entry.children.length === 0) {
      console.log(chalk.dim("No children cached — run: taskify board sync"));
      process.exit(0);
    }
    console.log(chalk.bold(`Children of ${entry.name}:`));
    for (const childId of entry.children) {
      const childEntry = config.boards.find((b) => b.id === childId);
      if (childEntry) {
        console.log(`  ${chalk.cyan(childEntry.name.padEnd(16))} ${chalk.dim(childId)}`);
      } else {
        console.log(`  ${chalk.dim(childId)} ${chalk.yellow("(not in local config)")}`);
      }
    }
    process.exit(0);
  });

// ---- boards (alias for board list) ----
program
  .command("boards")
  .description("List configured boards (alias for: board list)")
  .action(async () => {
    const config = await loadConfig();
    if (config.boards.length === 0) {
      console.log(chalk.dim("No boards configured. Use: taskify board join <id> --name <name>"));
    } else {
      for (const b of config.boards) {
        console.log(`  ${chalk.bold(b.name.padEnd(16))} ${chalk.dim(b.id)}`);
      }
    }
    process.exit(0);
  });

const WEEK_DAY_MAP: Record<string, number> = {
  mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6,
};

/** Resolve a week-board day name to the ISO date for that day in the current week (Mon-based). */
function resolveWeekDayToISO(dayKey: string): string {
  const offset = WEEK_DAY_MAP[dayKey];
  if (offset === undefined) return dayKey;
  const today = new Date();
  // JavaScript: 0=Sun, 1=Mon … 6=Sat
  const jsDay = today.getDay();
  // Offset from Monday: Mon=0 … Sun=6
  const mondayShift = jsDay === 0 ? -6 : 1 - jsDay;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayShift);
  monday.setHours(0, 0, 0, 0);
  const target = new Date(monday);
  target.setDate(monday.getDate() + offset);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, "0");
  const d = String(target.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Resolve --column value to { id, name } given a board entry.
function resolveColumn(
  entry: Awaited<ReturnType<typeof loadConfig>>["boards"][number],
  columnArg: string,
): { id: string; name: string } | null {
  const dayKey = columnArg.toLowerCase();
  // Week board: day name → ISO date
  if (dayKey in WEEK_DAY_MAP && entry.kind === "week") {
    const isoDate = resolveWeekDayToISO(dayKey);
    return { id: isoDate, name: columnArg };
  }
  if (!entry.columns || entry.columns.length === 0) return null;
  // Exact id match
  const byId = entry.columns.find((c) => c.id === columnArg);
  if (byId) return byId;
  // Case-insensitive name substring
  const lower = columnArg.toLowerCase();
  const byName = entry.columns.find((c) => c.name.toLowerCase().includes(lower));
  return byName ?? null;
}

// ---- list ----
program
  .command("list")
  .description("List tasks")
  .option("--board <id|name>", "Filter by board (UUID or name)")
  .option("--status <status>", "Filter: open (default), done, or any", "open")
  .option("--column <id|name>", "Filter by column id or name (use day names for week boards)")
  .option("--refresh", "Bypass cache and fetch live from relay")
  .option("--no-cache", "Do not fall back to stale cache if relay returns empty")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const config = await loadConfig();
    const runtime = initRuntime(config);
    let exitCode = 0;
    try {
      let columnId: string | undefined;
      let columnName: string | undefined;

      if (opts.column) {
        // Column requires a single board to be resolvable
        const singleBoardId = opts.board
          ? await resolveBoardId(opts.board, config)
          : config.boards.length === 1
            ? config.boards[0].id
            : undefined;
        if (!singleBoardId) {
          console.error(chalk.red("--column requires --board when multiple boards are configured"));
          process.exit(1);
        }
        const boardEntry = config.boards.find((b) => b.id === singleBoardId)!;
        const resolved = resolveColumn(boardEntry, opts.column);
        if (!resolved) {
          console.error(chalk.red(`Unknown column: ${opts.column}. Run: taskify board sync`));
          process.exit(1);
        }
        columnId = resolved.id;
        columnName = resolved.name;
      }

      const tasks = await runtime.listTasks({
        boardId: opts.board,
        status: opts.status as "open" | "done" | "any",
        columnId,
        refresh: !!opts.refresh,
        noCache: !opts.cache,
      });
      if (opts.json) {
        renderJson(tasks);
      } else {
        if (tasks.length === 0) {
          console.log(chalk.dim("No tasks found."));
        } else {
          renderTable(tasks, config.trustedNpubs, columnName);
        }
      }
    } catch (err) {
      console.error(chalk.red(String(err)));
      exitCode = 1;
    } finally {
      await runtime.disconnect();
      process.exit(exitCode);
    }
  });

// ---- show ----
program
  .command("show <taskId>")
  .description("Show full task details (accepts 8-char prefix or full UUID)")
  .option("--board <id|name>", "Board to search in (optional; scans all if omitted)")
  .option("--json", "Output raw task fields as JSON")
  .action(async (taskId: string, opts) => {
    warnShortTaskId(taskId);
    const config = await loadConfig();
    const runtime = initRuntime(config);
    let exitCode = 0;
    try {
      const task = await runtime.getTask(taskId, opts.board);
      if (!task) {
        console.error(chalk.red(`Task not found: ${taskId}`));
        exitCode = 1;
      } else if (opts.json) {
        renderJson(task);
      } else {
        const localReminders = runtime.getLocalReminders(task.id);
        renderTaskCard(task, config.trustedNpubs, localReminders);
      }
    } catch (err) {
      console.error(chalk.red(String(err)));
      exitCode = 1;
    } finally {
      await runtime.disconnect();
      process.exit(exitCode);
    }
  });

// ---- search ----
program
  .command("search <query>")
  .description("Full-text search tasks by title or note across all configured boards")
  .option("--board <id|name>", "Limit to a specific board")
  .option("--json", "Output as JSON")
  .action(async (query: string, opts) => {
    const config = await loadConfig();
    const runtime = initRuntime(config);
    let exitCode = 0;
    try {
      const allTasks = await runtime.listTasks({
        boardId: opts.board,
        status: "any",
      });
      const q = query.toLowerCase();
      const matched = allTasks.filter((t) => {
        const inTitle = t.title.toLowerCase().includes(q);
        const inNote = t.note ? t.note.toLowerCase().includes(q) : false;
        return inTitle || inNote;
      });
      if (opts.json) {
        renderJson(matched);
      } else {
        if (matched.length === 0) {
          console.log(chalk.dim(`No tasks matching "${query}".`));
        } else {
          renderTable(matched, config.trustedNpubs);
        }
      }
    } catch (err) {
      console.error(chalk.red(String(err)));
      exitCode = 1;
    } finally {
      await runtime.disconnect();
      process.exit(exitCode);
    }
  });

// ---- remind ----
program
  .command("remind <taskId> <presets...>")
  .description("Set device-local reminders on a task. Presets: 0h, 5m, 15m, 30m, 1h, 1d, 1w")
  .option("--board <id|name>", "Board the task belongs to")
  .action(async (taskId: string, presets: string[], opts) => {
    warnShortTaskId(taskId);
    const invalid = presets.filter((p) => !VALID_REMINDER_PRESETS.has(p));
    if (invalid.length > 0) {
      console.error(
        chalk.red(
          `Invalid reminder preset(s): ${invalid.join(", ")}. Valid: ${[...VALID_REMINDER_PRESETS].join(", ")}`,
        ),
      );
      process.exit(1);
    }
    const config = await loadConfig();
    const runtime = initRuntime(config);
    let exitCode = 0;
    try {
      // Try to fetch task title for a nicer success message
      let title = taskId.slice(0, 8);
      try {
        const hasSingleOrSpecifiedBoard = opts.board || config.boards.length === 1;
        if (hasSingleOrSpecifiedBoard) {
          const boardId = await resolveBoardId(opts.board, config);
          const task = await runtime.getTask(taskId, boardId);
          if (task?.title) title = task.title;
        }
      } catch { /* title lookup is best-effort */ }
      await runtime.remindTask(taskId, presets as Parameters<typeof runtime.remindTask>[1]);
      console.log(
        chalk.green(`✓ Reminders set for ${title}: ${presets.join(", ")} (device-local only, will not sync)`),
      );
    } catch (err) {
      console.error(chalk.red(String(err)));
      exitCode = 1;
    } finally {
      await runtime.disconnect();
      process.exit(exitCode);
    }
  });

// ---- add ----
program
  .command("add <title>")
  .description("Create a new task")
  .option("--board <id|name>", "Board to add to (required if multiple boards configured)")
  .option("--due <YYYY-MM-DD>", "Due date")
  .option("--priority <1|2|3>", "Priority (1=low, 3=high)")
  .option("--note <text>", "Note")
  .option(
    "--subtask <text>",
    "Add a subtask (repeatable)",
    (val: string, arr: string[]) => [...arr, val],
    [] as string[],
  )
  .option("--column <id|name>", "Column to place task in")
  .option("--json", "Output created task as JSON")
  .action(async (title: string, opts) => {
    validateDue(opts.due);
    validatePriority(opts.priority);
    const config = await loadConfig();
    const boardId = await resolveBoardId(opts.board, config);
    const boardEntry = config.boards.find((b) => b.id === boardId)!;

    // Block add on compound boards
    if (boardEntry.kind === "compound") {
      const childNames = (boardEntry.children ?? []).map((cid) => {
        const ce = config.boards.find((b) => b.id === cid);
        return ce ? `  ${ce.name} (${cid})` : `  ${cid}`;
      }).join("\n");
      console.error(chalk.red("Cannot add tasks directly to a compound board. Use one of its child boards:"));
      if (childNames) console.error(childNames);
      process.exit(1);
    }

    // Resolve --column
    let resolvedColumnId: string | undefined;
    let resolvedColumnName: string | undefined;
    if (opts.column) {
      const col = resolveColumn(boardEntry, opts.column);
      if (!col) {
        process.stderr.write(`⚠ Column not found in board config — run: taskify board sync\n`);
      } else {
        resolvedColumnId = col.id;
        resolvedColumnName = col.name;
      }
    }

    const runtime = initRuntime(config);
    let exitCode = 0;
    try {
      const subtasks = (opts.subtask as string[]).map((text) => ({
        id: crypto.randomUUID(),
        title: text,
        completed: false,
      }));
      const task = await runtime.createTaskFull({
        title,
        note: opts.note ?? "",
        boardId,
        dueISO: opts.due,
        priority: opts.priority ? (parseInt(opts.priority, 10) as 1 | 2 | 3) : undefined,
        subtasks: subtasks.length > 0 ? subtasks : undefined,
        columnId: resolvedColumnId,
      });
      if (opts.json) {
        renderJson(task);
      } else {
        const colStr = task.column
          ? chalk.dim(`  [col: ${resolvedColumnName ?? task.column}]`)
          : "";
        console.log(
          chalk.green(`✓ Created: ${task.title}`) + colStr,
        );
        if (subtasks.length > 0) {
          console.log(chalk.dim(`  Subtasks: ${subtasks.map((s) => s.title).join(", ")}`));
        }
      }
    } catch (err) {
      console.error(chalk.red(String(err)));
      exitCode = 1;
    } finally {
      await runtime.disconnect();
      process.exit(exitCode);
    }
  });

// ---- done ----
program
  .command("done <taskId>")
  .description("Mark a task as done (accepts 8-char prefix or full UUID)")
  .option("--board <id|name>", "Board the task belongs to")
  .option("--json", "Output updated task as JSON")
  .action(async (taskId: string, opts) => {
    warnShortTaskId(taskId);
    const config = await loadConfig();
    const boardId = await resolveBoardId(opts.board, config);
    const runtime = initRuntime(config);
    let exitCode = 0;
    try {
      const task = await runtime.setTaskStatus(taskId, "done", boardId);
      if (!task) {
        console.error(chalk.red(`Task not found: ${taskId}`));
        exitCode = 1;
      } else if (opts.json) {
        renderJson(task);
      } else {
        console.log(chalk.green(`✓ Marked done: ${task.title}`));
      }
    } catch (err) {
      console.error(chalk.red(String(err)));
      exitCode = 1;
    } finally {
      await runtime.disconnect();
      process.exit(exitCode);
    }
  });

// ---- reopen ----
program
  .command("reopen <taskId>")
  .description("Reopen a completed task (accepts 8-char prefix or full UUID)")
  .option("--board <id|name>", "Board the task belongs to")
  .option("--json", "Output updated task as JSON")
  .action(async (taskId: string, opts) => {
    warnShortTaskId(taskId);
    const config = await loadConfig();
    const boardId = await resolveBoardId(opts.board, config);
    const runtime = initRuntime(config);
    let exitCode = 0;
    try {
      const task = await runtime.setTaskStatus(taskId, "open", boardId);
      if (!task) {
        console.error(chalk.red(`Task not found: ${taskId}`));
        exitCode = 1;
      } else if (opts.json) {
        renderJson(task);
      } else {
        console.log(chalk.green(`✓ Reopened: ${task.title}`));
      }
    } catch (err) {
      console.error(chalk.red(String(err)));
      exitCode = 1;
    } finally {
      await runtime.disconnect();
      process.exit(exitCode);
    }
  });

// ---- delete ----
program
  .command("delete <taskId>")
  .description("Delete a task (publishes status=deleted to Nostr; accepts 8-char prefix or full UUID)")
  .option("--board <id|name>", "Board the task belongs to")
  .option("--force", "Skip confirmation prompt")
  .option("--json", "Output deleted task as JSON")
  .action(async (taskId: string, opts) => {
    warnShortTaskId(taskId);
    const config = await loadConfig();
    const boardId = await resolveBoardId(opts.board, config);
    const runtime = initRuntime(config);
    let exitCode = 0;
    try {
      // Fetch task first so we can show the title in the prompt
      const task = await runtime.getTask(taskId, boardId);
      if (!task) {
        console.error(chalk.red(`Task not found: ${taskId}`));
        exitCode = 1;
      } else {
        if (!opts.force) {
          const { createInterface } = await import("readline");
          const confirmed = await new Promise<boolean>((resolve) => {
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            rl.question(
              `Delete task: ${task.title} (${task.id.slice(0, 8)})? [y/N] `,
              (ans: string) => {
                rl.close();
                resolve(ans === "y" || ans === "Y");
              },
            );
          });
          if (!confirmed) {
            console.log("Aborted.");
            await runtime.disconnect();
            process.exit(0);
          }
        }
        const deleted = await runtime.deleteTask(taskId, boardId);
        if (!deleted) {
          console.error(chalk.red(`Task not found: ${taskId}`));
          exitCode = 1;
        } else if (opts.json) {
          renderJson(deleted);
        } else {
          console.log(chalk.green(`✓ Deleted: ${deleted.title}`));
        }
      }
    } catch (err) {
      console.error(chalk.red(String(err)));
      exitCode = 1;
    } finally {
      await runtime.disconnect();
      process.exit(exitCode);
    }
  });

// ---- subtask ----
program
  .command("subtask <taskId> <subtaskRef>")
  .description(
    "Toggle a subtask done/incomplete. subtaskRef can be a 1-based index or partial title match.",
  )
  .option("--board <id|name>", "Board the task belongs to")
  .option("--done", "Mark subtask completed")
  .option("--reopen", "Mark subtask incomplete")
  .option("--json", "Output updated full task as JSON")
  .action(async (taskId: string, subtaskRef: string, opts) => {
    if (!opts.done && !opts.reopen) {
      console.error(chalk.red("Specify --done or --reopen."));
      process.exit(1);
    }
    if (opts.done && opts.reopen) {
      console.error(chalk.red("Specify only one of --done or --reopen."));
      process.exit(1);
    }
    warnShortTaskId(taskId);
    const config = await loadConfig();
    const boardId = await resolveBoardId(opts.board, config);
    const runtime = initRuntime(config);
    let exitCode = 0;
    try {
      const completed = !!opts.done;
      const task = await runtime.toggleSubtask(taskId, boardId, subtaskRef, completed);
      if (!task) {
        console.error(chalk.red(`Task not found: ${taskId}`));
        exitCode = 1;
      } else if (opts.json) {
        renderJson(task);
      } else {
        // Find the subtask that was toggled (by ref) to display its title
        const subtasks = task.subtasks ?? [];
        const indexNum = parseInt(subtaskRef, 10);
        let found: { title: string; completed?: boolean } | undefined;
        if (!isNaN(indexNum) && indexNum >= 1 && indexNum <= subtasks.length) {
          found = subtasks[indexNum - 1];
        } else {
          const lower = subtaskRef.toLowerCase();
          found = subtasks.find((s) => s.title.toLowerCase().includes(lower));
        }
        const check = completed ? "x" : " ";
        const stitle = found?.title ?? subtaskRef;
        console.log(chalk.green(`✓ Subtask [${check}] ${stitle}  (task: ${task.title})`));
      }
    } catch (err) {
      console.error(chalk.red(String(err)));
      exitCode = 1;
    } finally {
      await runtime.disconnect();
      process.exit(exitCode);
    }
  });

// ---- update ----
program
  .command("update <taskId>")
  .description("Update task fields (accepts 8-char prefix or full UUID)")
  .option("--board <id|name>", "Board the task belongs to")
  .option("--title <t>", "New title")
  .option("--due <d>", "New due date")
  .option("--priority <p>", "New priority")
  .option("--note <n>", "New note")
  .option("--column <id|name>", "Move task to a different column")
  .option("--json", "Output updated task as JSON")
  .action(async (taskId: string, opts) => {
    warnShortTaskId(taskId);
    validateDue(opts.due);
    validatePriority(opts.priority);
    const config = await loadConfig();
    const boardId = await resolveBoardId(opts.board, config);
    const runtime = initRuntime(config);
    let exitCode = 0;
    try {
      const patch: Record<string, unknown> = {};
      if (opts.title !== undefined) patch.title = opts.title;
      if (opts.due !== undefined) patch.dueISO = opts.due;
      if (opts.priority !== undefined) patch.priority = parseInt(opts.priority, 10);
      if (opts.note !== undefined) patch.note = opts.note;
      if (opts.column !== undefined) {
        const bEntry = config.boards.find((b) => b.id === boardId);
        if (bEntry) {
          const col = resolveColumn(bEntry, opts.column);
          if (col) {
            patch.columnId = col.id;
          } else {
            process.stderr.write(`⚠ Column not found in board config — run: taskify board sync\n`);
          }
        }
      }
      const task = await runtime.updateTask(taskId, boardId, patch);
      if (!task) {
        console.error(chalk.red(`Task not found: ${taskId}`));
        exitCode = 1;
      } else if (opts.json) {
        renderJson(task);
      } else {
        console.log(chalk.green(`✓ Updated: ${task.id.slice(0, 8)}  ${task.title}  ${task.boardId}`));
      }
    } catch (err) {
      console.error(chalk.red(String(err)));
      exitCode = 1;
    } finally {
      await runtime.disconnect();
      process.exit(exitCode);
    }
  });

// ---- trust ----
const trust = program.command("trust").description("Manage trusted npubs");

trust
  .command("add <npub>")
  .description("Add a trusted npub")
  .action(async (npub: string) => {
    const config = await loadConfig();
    if (!config.trustedNpubs.includes(npub)) {
      config.trustedNpubs.push(npub);
    }
    await saveConfig(config);
    console.log(chalk.green("✓ Added"));
    process.exit(0);
  });

trust
  .command("remove <npub>")
  .description("Remove a trusted npub")
  .action(async (npub: string) => {
    const config = await loadConfig();
    config.trustedNpubs = config.trustedNpubs.filter((n) => n !== npub);
    await saveConfig(config);
    console.log(chalk.green("✓ Removed"));
    process.exit(0);
  });

trust
  .command("list")
  .description("List trusted npubs")
  .action(async () => {
    const config = await loadConfig();
    if (config.trustedNpubs.length === 0) {
      console.log(chalk.dim("No trusted npubs."));
    } else {
      for (const npub of config.trustedNpubs) {
        console.log(npub);
      }
    }
    process.exit(0);
  });

// ---- relay command group ----
const relayCmd = program.command("relay").description("Manage relay connections");

relayCmd
  .command("status")
  .description("Show connection status of relays in the NDK pool")
  .action(async () => {
    const config = await loadConfig();
    const runtime = initRuntime(config);
    let exitCode = 0;
    try {
      const statuses = await runtime.getRelayStatus();
      if (statuses.length === 0) {
        console.log(chalk.dim("No relays configured."));
      } else {
        for (const { url, connected } of statuses) {
          if (connected) {
            console.log(chalk.green(`✓ ${url}`) + chalk.dim("  connected"));
          } else {
            console.log(chalk.red(`✗ ${url}`) + chalk.dim("  disconnected"));
          }
        }
      }
    } catch (err) {
      console.error(chalk.red(String(err)));
      exitCode = 1;
    } finally {
      await runtime.disconnect();
      process.exit(exitCode);
    }
  });

relayCmd
  .command("list")
  .description("Show configured relays with live connection check")
  .action(async () => {
    const config = await loadConfig();
    if (config.relays.length === 0) {
      console.log(chalk.dim("No relays configured."));
      process.exit(0);
    }
    console.log(chalk.dim(`Checking ${config.relays.length} relay(s)...`));
    for (const relay of config.relays) {
      const ok = await checkRelay(relay);
      if (ok) {
        console.log(chalk.green(`✓ ${relay}`) + chalk.dim("  connected"));
      } else {
        console.log(chalk.red(`✗ ${relay}`) + chalk.dim("  disconnected"));
      }
    }
    process.exit(0);
  });

relayCmd
  .command("add <url>")
  .description("Add a relay URL to config")
  .action(async (url: string) => {
    const config = await loadConfig();
    if (!config.relays.includes(url)) {
      config.relays.push(url);
      await saveConfig(config);
      console.log(chalk.green(`✓ Relay added: ${url}`));
    } else {
      console.log(chalk.dim(`Relay already configured: ${url}`));
    }
    process.exit(0);
  });

relayCmd
  .command("remove <url>")
  .description("Remove a relay URL from config")
  .action(async (url: string) => {
    const config = await loadConfig();
    const before = config.relays.length;
    config.relays = config.relays.filter((r) => r !== url);
    if (config.relays.length === before) {
      console.error(chalk.red(`Relay not found in config: ${url}`));
      process.exit(1);
    }
    await saveConfig(config);
    console.log(chalk.green(`✓ Relay removed: ${url}`));
    process.exit(0);
  });

// ---- cache command group ----
const cacheCmd = program.command("cache").description("Manage task cache");

cacheCmd
  .command("clear")
  .description("Delete the task cache file")
  .action(() => {
    clearCache();
    console.log(chalk.green("✓ Cache cleared"));
    process.exit(0);
  });

cacheCmd
  .command("status")
  .description("Show per-board cache age and task count")
  .action(async () => {
    const config = await loadConfig();
    const cache = readCache();
    const now = Date.now();
    if (Object.keys(cache.boards).length === 0) {
      console.log(chalk.dim("No cache."));
      process.exit(0);
    }
    for (const board of config.boards) {
      const bc = cache.boards[board.id];
      if (!bc) {
        console.log(`${board.name}: ${chalk.dim("No cache")}`);
        continue;
      }
      const ageMs = now - bc.fetchedAt;
      const ageSec = Math.floor(ageMs / 1000);
      let ageStr: string;
      if (ageSec < 60) {
        ageStr = `${ageSec}s ago`;
      } else if (ageSec < 3600) {
        ageStr = `${Math.floor(ageSec / 60)}m ago`;
      } else {
        ageStr = `${Math.floor(ageSec / 3600)}h ago`;
      }
      const stale = ageMs > CACHE_TTL_MS ? chalk.yellow(" (stale)") : "";
      const openCount = bc.tasks.filter((t) => t.status === "open").length;
      console.log(`${chalk.bold(board.name)}: ${bc.tasks.length} tasks (${openCount} open), cached ${ageStr}${stale}`);
    }
    // Show boards in cache that aren't in config
    for (const [boardId, bc] of Object.entries(cache.boards)) {
      if (!config.boards.find((b) => b.id === boardId)) {
        console.log(chalk.dim(`  [orphan ${boardId.slice(0, 8)}]: ${bc.tasks.length} tasks`));
      }
    }
    process.exit(0);
  });

// ---- config ----
const configCmd = program.command("config").description("Manage CLI config");

const configSet = configCmd.command("set").description("Set config values");

configSet
  .command("nsec <nsec>")
  .description("Set your nsec private key")
  .action(async (nsec: string) => {
    if (!nsec.startsWith("nsec1")) {
      console.error(chalk.red(`Invalid nsec: must start with "nsec1".`));
      process.exit(1);
    }
    const config = await loadConfig();
    config.nsec = nsec;
    await saveConfig(config);
    console.log(chalk.green("✓ nsec saved"));
    process.exit(0);
  });

configSet
  .command("relay <url>")
  .description("Add a relay URL")
  .action(async (url: string) => {
    const config = await loadConfig();
    if (!config.relays.includes(url)) {
      config.relays.push(url);
    }
    await saveConfig(config);
    console.log(chalk.green("✓ Relay added"));
    process.exit(0);
  });

async function checkRelay(url: string, timeoutMs: number = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    const timer = setTimeout(() => {
      ws.close();
      done(false);
    }, timeoutMs);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
      ws.onopen = () => {
        clearTimeout(timer);
        ws.close();
        done(true);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        done(false);
      };
    } catch {
      clearTimeout(timer);
      done(false);
    }
  });
}

configCmd
  .command("show")
  .description("Show current config")
  .action(async () => {
    const config = await loadConfig();
    const display = {
      ...config,
      nsec: config.nsec ? "nsec1****" : undefined,
    };
    console.log(JSON.stringify(display, null, 2));

    console.log("\nChecking relays...");
    for (const relay of config.relays) {
      const ok = await checkRelay(relay);
      if (ok) {
        console.log(chalk.green(`✓ ${relay}`) + chalk.dim("  (connected)"));
      } else {
        console.log(chalk.red(`✗ ${relay}`) + chalk.dim("  (timeout)"));
      }
    }
    process.exit(0);
  });

// ---- completions ----
program
  .command("completions")
  .description("Generate shell completion scripts")
  .option("--shell <zsh|bash|fish>", "Shell type (defaults to current shell)")
  .action((opts) => {
    let shell = opts.shell as string | undefined;
    if (!shell) {
      const envShell = process.env.SHELL ?? "";
      if (envShell.includes("zsh")) shell = "zsh";
      else if (envShell.includes("bash")) shell = "bash";
      else {
        // Print all three if shell cannot be determined
        process.stdout.write(zshCompletion());
        process.stdout.write("\n");
        process.stdout.write(bashCompletion());
        process.stdout.write("\n");
        process.stdout.write(fishCompletion());
        process.exit(0);
      }
    }
    switch (shell) {
      case "zsh":
        process.stdout.write(zshCompletion());
        break;
      case "bash":
        process.stdout.write(bashCompletion());
        break;
      case "fish":
        process.stdout.write(fishCompletion());
        break;
      default:
        console.error(chalk.red(`Unknown shell: "${shell}". Use: zsh, bash, or fish`));
        process.exit(1);
    }
    process.exit(0);
  });

// ---- agent command group ----
const agentCmd = program
  .command("agent")
  .description("AI-powered task commands");

const agentConfigCmd = agentCmd
  .command("config")
  .description("Manage agent AI configuration");

agentConfigCmd
  .command("set-key <key>")
  .description("Set the AI API key")
  .action(async (key: string) => {
    const config = await loadConfig();
    if (!config.agent) config.agent = {};
    config.agent.apiKey = key;
    await saveConfig(config);
    console.log(chalk.green("✓ Agent API key saved"));
    process.exit(0);
  });

agentConfigCmd
  .command("set-model <model>")
  .description("Set the AI model")
  .action(async (model: string) => {
    const config = await loadConfig();
    if (!config.agent) config.agent = {};
    config.agent.model = model;
    await saveConfig(config);
    console.log(chalk.green(`✓ Agent model set to: ${model}`));
    process.exit(0);
  });

agentConfigCmd
  .command("set-url <url>")
  .description("Set the AI base URL (OpenAI-compatible)")
  .action(async (url: string) => {
    const config = await loadConfig();
    if (!config.agent) config.agent = {};
    config.agent.baseUrl = url;
    await saveConfig(config);
    console.log(chalk.green(`✓ Agent base URL set to: ${url}`));
    process.exit(0);
  });

agentConfigCmd
  .command("show")
  .description("Show current agent config (masks API key)")
  .action(async () => {
    const config = await loadConfig();
    const ag = config.agent ?? {};
    const rawKey = ag.apiKey ?? process.env.TASKIFY_AGENT_API_KEY ?? "";
    let maskedKey = "(not set)";
    if (rawKey.length > 7) {
      maskedKey = rawKey.slice(0, 3) + "..." + rawKey.slice(-3);
    } else if (rawKey.length > 0) {
      maskedKey = "***";
    }
    console.log(`  apiKey:         ${maskedKey}`);
    console.log(`  baseUrl:        ${ag.baseUrl ?? "https://api.openai.com/v1"}`);
    console.log(`  model:          ${ag.model ?? "gpt-4o-mini"}`);
    console.log(`  defaultBoardId: ${ag.defaultBoardId ?? "(not set)"}`);
    process.exit(0);
  });

agentCmd
  .command("add <description>")
  .description("AI-powered task creation from natural language")
  .option("--board <id|name>", "Target board")
  .option("--yes", "Skip confirmation prompt")
  .option("--dry-run", "Show extracted fields without creating")
  .option("--json", "Output created task as JSON")
  .action(async (description: string, opts) => {
    const config = await loadConfig();
    const apiKey = config.agent?.apiKey ?? process.env.TASKIFY_AGENT_API_KEY ?? "";
    if (!apiKey) {
      console.error(chalk.red("No AI API key configured. Run: taskify agent config set-key <key>"));
      console.error(chalk.dim("  or set TASKIFY_AGENT_API_KEY environment variable"));
      process.exit(1);
    }
    const baseUrl = config.agent?.baseUrl ?? "https://api.openai.com/v1";
    const model = config.agent?.model ?? "gpt-4o-mini";
    const boardId = await resolveBoardId(opts.board ?? config.agent?.defaultBoardId, config);
    const boardEntry = config.boards.find((b) => b.id === boardId)!;

    if (boardEntry.kind === "compound") {
      const childNames = (boardEntry.children ?? []).map((cid) => {
        const ce = config.boards.find((b) => b.id === cid);
        return ce ? `  ${ce.name} (${cid})` : `  ${cid}`;
      }).join("\n");
      console.error(chalk.red("Cannot add tasks directly to a compound board. Use one of its child boards:"));
      if (childNames) console.error(childNames);
      process.exit(1);
    }

    const today = new Date().toISOString().slice(0, 10);
    const { callAI } = await import("./aiClient.ts");

    const SYSTEM_PROMPT = `You are a task extraction assistant. Extract fields from the description.
Return ONLY valid JSON (no markdown, no explanation):
{
  "title": "concise task title (max 80 chars)",
  "note": "additional detail or empty string",
  "priority": 1|2|3|null,
  "dueISO": "YYYY-MM-DD"|null,
  "column": "column name/id hint or null",
  "subtasks": ["subtask 1", "subtask 2"] or []
}
Today is ${today}.`;

    let extracted: {
      title: string;
      note: string;
      priority: 1 | 2 | 3 | null;
      dueISO: string | null;
      column: string | null;
      subtasks: string[];
    };

    console.log(chalk.dim("Calling AI..."));
    try {
      const raw = await callAI({ apiKey, baseUrl, model, systemPrompt: SYSTEM_PROMPT, userMessage: description });
      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      extracted = JSON.parse(cleaned);
    } catch (err) {
      console.error(chalk.red(`AI extraction failed: ${String(err)}`));
      process.exit(1);
    }

    // Resolve column hint
    let resolvedColumnId: string | undefined;
    let resolvedColumnName: string | undefined;
    if (extracted.column) {
      const col = resolveColumn(boardEntry, extracted.column);
      if (col) {
        resolvedColumnId = col.id;
        resolvedColumnName = col.name;
      }
    }

    // Print extracted fields
    console.log(chalk.bold("\nExtracted task:"));
    console.log(`  title:    ${extracted.title}`);
    if (extracted.note) console.log(`  note:     ${extracted.note}`);
    if (extracted.priority) console.log(`  priority: ${extracted.priority}`);
    if (extracted.dueISO) console.log(`  due:      ${extracted.dueISO}`);
    if (resolvedColumnName) console.log(`  column:   ${resolvedColumnName}`);
    if (extracted.subtasks?.length > 0) {
      console.log(`  subtasks: ${extracted.subtasks.join(", ")}`);
    }

    if (opts.dryRun) {
      console.log(chalk.dim("\n[dry-run] No task created."));
      process.exit(0);
    }

    if (!opts.yes) {
      const { createInterface } = await import("readline");
      const confirmed = await new Promise<boolean>((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question("\nCreate this task? [Y/n] ", (ans: string) => {
          rl.close();
          resolve(ans === "" || ans.toLowerCase() === "y");
        });
      });
      if (!confirmed) {
        console.log("Aborted.");
        process.exit(0);
      }
    }

    const runtime = initRuntime(config);
    try {
      const subtasks = (extracted.subtasks ?? []).map((text) => ({
        id: crypto.randomUUID(),
        title: text,
        completed: false,
      }));
      const task = await runtime.createTaskFull({
        title: extracted.title,
        note: extracted.note ?? "",
        boardId,
        dueISO: extracted.dueISO ?? undefined,
        priority: extracted.priority ?? undefined,
        columnId: resolvedColumnId,
        subtasks: subtasks.length > 0 ? subtasks : undefined,
      });
      if (opts.json) {
        renderJson(task);
      } else {
        const colStr = task.column ? chalk.dim(`  [col: ${resolvedColumnName ?? task.column}]`) : "";
        console.log(chalk.green(`✓ Created: ${task.title}`) + colStr);
      }
    } catch (err) {
      console.error(chalk.red(String(err)));
      process.exit(1);
    } finally {
      await runtime.disconnect();
    }
    process.exit(0);
  });

agentCmd
  .command("triage")
  .description("AI-powered task prioritization suggestions")
  .option("--board <id|name>", "Target board")
  .option("--yes", "Apply changes without confirmation")
  .option("--dry-run", "Show suggestions without applying")
  .option("--json", "Output suggestions as JSON")
  .action(async (opts) => {
    const config = await loadConfig();
    const apiKey = config.agent?.apiKey ?? process.env.TASKIFY_AGENT_API_KEY ?? "";
    if (!apiKey) {
      console.error(chalk.red("No AI API key configured. Run: taskify agent config set-key <key>"));
      process.exit(1);
    }
    const baseUrl = config.agent?.baseUrl ?? "https://api.openai.com/v1";
    const model = config.agent?.model ?? "gpt-4o-mini";
    const boardId = await resolveBoardId(opts.board ?? config.agent?.defaultBoardId, config);
    const runtime = initRuntime(config);
    let exitCode = 0;
    try {
      const tasks = await runtime.listTasks({ boardId, status: "open" });
      if (tasks.length === 0) {
        console.log(chalk.dim("No open tasks to triage."));
        process.exit(0);
      }

      const { callAI } = await import("./aiClient.ts");

      const SYSTEM_PROMPT = `You are a task prioritization assistant. Given open tasks, suggest priority (1=low, 2=medium, 3=high) for each.
Return ONLY a valid JSON array (no markdown):
[{"id":"<taskId>","priority":1|2|3,"reason":"one sentence"}]`;

      const taskList = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        note: t.note || undefined,
        dueISO: t.dueISO || undefined,
        currentPriority: t.priority,
      }));

      console.log(chalk.dim(`Analyzing ${tasks.length} tasks...`));
      let suggestions: Array<{ id: string; priority: 1 | 2 | 3; reason: string }>;
      try {
        const raw = await callAI({
          apiKey, baseUrl, model,
          systemPrompt: SYSTEM_PROMPT,
          userMessage: `Tasks: ${JSON.stringify(taskList)}`,
        });
        const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        suggestions = JSON.parse(cleaned);
      } catch (err) {
        console.error(chalk.red(`AI triage failed: ${String(err)}`));
        process.exit(1);
      }

      // Filter to only changes
      const changes = suggestions.filter((s) => {
        const task = tasks.find((t) => t.id === s.id);
        return task && task.priority !== s.priority;
      });

      if (opts.json) {
        renderJson(suggestions);
        process.exit(0);
      }

      if (changes.length === 0) {
        console.log(chalk.dim("No priority changes suggested."));
        process.exit(0);
      }

      console.log(chalk.bold("\nSuggested priority changes:"));
      const PRIO_LABELS: Record<number, string> = { 1: "low", 2: "medium", 3: "high" };
      for (const s of changes) {
        const task = tasks.find((t) => t.id === s.id);
        const oldPrio = task?.priority ? PRIO_LABELS[task.priority] : "none";
        const newPrio = PRIO_LABELS[s.priority] ?? String(s.priority);
        console.log(`  ${s.id.slice(0, 8)}  ${(task?.title ?? "").slice(0, 40).padEnd(40)}  ${oldPrio} → ${newPrio}`);
        console.log(chalk.dim(`           ${s.reason}`));
      }

      if (opts.dryRun) {
        console.log(chalk.dim("\n[dry-run] No changes applied."));
        process.exit(0);
      }

      if (!opts.yes) {
        const { createInterface } = await import("readline");
        const confirmed = await new Promise<boolean>((resolve) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          rl.question("\nApply these priority changes? [Y/n] ", (ans: string) => {
            rl.close();
            resolve(ans === "" || ans.toLowerCase() === "y");
          });
        });
        if (!confirmed) {
          console.log("Aborted.");
          process.exit(0);
        }
      }

      for (const s of changes) {
        await runtime.updateTask(s.id, boardId, { priority: s.priority });
      }
      console.log(chalk.green(`✓ Applied ${changes.length} priority update(s)`));
    } catch (err) {
      console.error(chalk.red(String(err)));
      exitCode = 1;
    } finally {
      await runtime.disconnect();
      process.exit(exitCode);
    }
  });

program.parse(process.argv);
