import { readFile, writeFile } from "fs/promises";
import { mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ReminderPreset } from "./shared/taskTypes.js";

export const CONFIG_DIR = join(homedir(), ".taskify-cli");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export type BoardEntry = {
  id: string;
  name: string;
  relays?: string[];
  kind?: "week" | "lists" | "compound" | "bible";
  columns?: { id: string; name: string }[];
  children?: string[];
};

export type TaskifyConfig = {
  nsec?: string;
  relays: string[];
  defaultBoard: string;
  trustedNpubs: string[];
  securityMode: "moderate" | "strict" | "off";
  securityEnabled: boolean;
  boards: BoardEntry[];
  taskReminders: Record<string, ReminderPreset[]>;
  agent?: {
    apiKey?: string;
    baseUrl?: string;   // default: https://api.openai.com/v1
    model?: string;     // default: gpt-4o-mini
    defaultBoardId?: string;
  };
};

const DEFAULT_CONFIG: TaskifyConfig = {
  relays: [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.snort.social",
    "wss://relay.primal.net",
  ],
  defaultBoard: "Personal",
  trustedNpubs: [],
  securityMode: "moderate",
  securityEnabled: true,
  boards: [],
  taskReminders: {},
};

export async function loadConfig(): Promise<TaskifyConfig> {
  let cfg: TaskifyConfig;
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    cfg = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    cfg = { ...DEFAULT_CONFIG };
  }
  if (process.env.TASKIFY_NSEC) {
    cfg.nsec = process.env.TASKIFY_NSEC;
    process.stderr.write("\x1b[2m(using TASKIFY_NSEC from env)\x1b[0m\n");
  }
  return cfg;
}

export async function saveConfig(cfg: TaskifyConfig): Promise<void> {
  mkdirSync(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}
