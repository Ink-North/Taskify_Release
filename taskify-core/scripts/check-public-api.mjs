import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const indexPath = resolve(root, "src/index.ts");
const manifestPath = resolve(root, "docs/public-api-exports.txt");

function normalizeLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const indexLines = normalizeLines(readFileSync(indexPath, "utf8"));
const manifestLines = normalizeLines(readFileSync(manifestPath, "utf8"));

const mismatch =
  indexLines.length !== manifestLines.length ||
  indexLines.some((line, i) => line !== manifestLines[i]);

if (mismatch) {
  console.error("❌ Public API export surface drift detected.");
  console.error(`- index:    ${indexPath}`);
  console.error(`- manifest: ${manifestPath}`);
  console.error("\nUpdate docs/public-api-exports.txt if this change is intentional.");
  process.exit(1);
}

console.log("✅ Public API export surface matches manifest.");
