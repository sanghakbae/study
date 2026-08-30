import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function getVersion() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return String(Date.now());
  }
}

const version = getVersion();
const outputDir = resolve(process.cwd(), "dist");
mkdirSync(outputDir, { recursive: true });
writeFileSync(
  resolve(outputDir, "deploy-version.json"),
  JSON.stringify(
    {
      version,
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

// 서비스워커에 배포 버전을 새겨, 배포마다 sw.js 바이트가 바뀌고 브라우저가 새 버전을 감지하게 한다.
const swPath = resolve(outputDir, "sw.js");
if (existsSync(swPath)) {
  const sw = readFileSync(swPath, "utf8").replace(/__BUILD_VERSION__/g, version);
  writeFileSync(swPath, sw);
}
