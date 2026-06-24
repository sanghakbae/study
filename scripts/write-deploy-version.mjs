import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function getVersion() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return String(Date.now());
  }
}

const outputDir = resolve(process.cwd(), "dist");
mkdirSync(outputDir, { recursive: true });
writeFileSync(
  resolve(outputDir, "deploy-version.json"),
  JSON.stringify(
    {
      version: getVersion(),
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
