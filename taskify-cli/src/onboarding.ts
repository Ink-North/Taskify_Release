#!/usr/bin/env node
import * as readline from "readline";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { loadConfig, saveConfig } from "./config.js";

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function runOnboarding(): Promise<void> {
  console.log();
  console.log("┌─────────────────────────────────────────┐");
  console.log("│  Welcome to taskify-nostr! 🦉           │");
  console.log("│  Nostr-powered task management CLI      │");
  console.log("└─────────────────────────────────────────┘");
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const cfg = await loadConfig();

  // Step 1 — Private key
  console.log("Step 1 — Private key");
  const hasKey = await ask(rl, "Do you have a Nostr private key (nsec)? [Y/n] ");

  if (hasKey.trim().toLowerCase() !== "n") {
    // User has a key
    let nsec = "";
    while (true) {
      nsec = (await ask(rl, "Paste your nsec: ")).trim();
      if (nsec.startsWith("nsec1")) {
        try {
          nip19.decode(nsec);
          break;
        } catch {
          // invalid
        }
      }
      console.log("Invalid nsec. Try again or press Ctrl+C to abort.");
    }
    cfg.nsec = nsec;
  } else {
    // Generate new keypair
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const nsec = nip19.nsecEncode(sk);
    const npub = nip19.npubEncode(pk);
    console.log();
    console.log("✓ Generated new Nostr identity");
    console.log(`  npub: ${npub}`);
    console.log(`  nsec: ${nsec}  ← KEEP THIS SECRET — it is your password`);
    console.log();
    console.log("Save this nsec somewhere safe. It cannot be recovered if lost.");
    const cont = await ask(rl, "Continue? [Y/n] ");
    if (cont.trim().toLowerCase() === "n") {
      rl.close();
      process.exit(0);
    }
    cfg.nsec = nsec;
  }

  // Step 2 — Default board
  console.log();
  console.log("Step 2 — Default board");
  const joinBoard = await ask(rl, "Do you want to join an existing board? [y/N] ");
  if (joinBoard.trim().toLowerCase() === "y") {
    const boardId = (await ask(rl, "Board ID (Nostr event id): ")).trim();
    if (boardId) {
      cfg.defaultBoard = boardId;
    }
  }

  // Step 3 — Relays
  console.log();
  console.log("Step 3 — Relays");
  const configRelays = await ask(rl, "Configure relays? Default relays will be used if skipped. [y/N] ");
  if (configRelays.trim().toLowerCase() === "y") {
    const relays: string[] = [];
    while (true) {
      const relay = (await ask(rl, "Add relay URL (blank to finish): ")).trim();
      if (!relay) break;
      relays.push(relay);
    }
    if (relays.length > 0) {
      cfg.relays = relays;
    }
  }

  rl.close();

  await saveConfig(cfg);

  // Step 4 — Done
  console.log();
  console.log("✓ Setup complete! Run `taskify boards` to see your boards.");
  console.log("  Run `taskify --help` to explore all commands.");
  console.log();
}
