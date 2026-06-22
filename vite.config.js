import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

export default defineConfig({
  plugins: [react(), localGuideApi()],
});

function localGuideApi() {
  return {
    name: "local-guide-api",
    configureServer(server) {
      server.middlewares.use("/api/guide", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        try {
          const env = readDevVars();
          const apiKey = cleanEnv(env.OPENAI_API_KEY);
          const model = cleanEnv(env.OPENAI_MODEL) || "gpt-5.5";
          if (!apiKey || apiKey.includes("여기에_")) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: ".dev.vars에 OPENAI_API_KEY를 넣어야 합니다." }));
            return;
          }

          const body = await readJson(req);
          const guide = await requestGuide({ apiKey, model, ...body });
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ guide }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    },
  };
}

function readDevVars() {
  const filePath = path.resolve(process.cwd(), ".dev.vars");
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), cleanEnv(line.slice(index + 1))];
      }),
  );
}

function cleanEnv(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function requestGuide({ apiKey, model, problem, action, noteSummary }) {
  const prompt = [
    "너는 한국 중학교/고등학교 수학 튜터다.",
    "정답을 바로 공개하기보다 학생이 다음 한 단계를 찾도록 유도해라.",
    "교과 개념, 풀이 방향, 흔한 실수를 짧게 한국어로 설명해라.",
    "마크다운으로만 답하고 LaTeX 블록 수식 \\[ \\] 또는 \\( \\)는 쓰지 마라.",
    "줄간격이 커지지 않도록 짧은 문단과 bullet만 사용해라.",
    `버튼: ${action}`,
    `문제: ${problem?.prompt || ""}`,
    `단원: ${problem?.title || ""}`,
    `필기 요약: ${noteSummary || "사용자 필기 이미지/획 데이터가 저장됨"}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
    }),
  });

  const data = await response.json().catch(async () => ({ error: { message: await response.text() } }));
  if (!response.ok) {
    throw new Error(data.error?.message || JSON.stringify(data));
  }

  return (
    data.output_text ||
    data.output?.flatMap((item) => item.content || []).map((item) => item.text).filter(Boolean).join("\n") ||
    "풀이 방향을 만들지 못했습니다."
  );
}
