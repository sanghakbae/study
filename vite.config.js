import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

export default defineConfig({
  plugins: [react(), localGuideApi()],
  build: {
    sourcemap: true,
  },
  server: {
    port: parseInt(process.env.PORT) || 5173,
    host: "0.0.0.0",
  },
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

async function requestGuide({ apiKey, model, problem, action, noteSummary, canvasImage }) {
  const isCheck = action === "내 풀이 점검";
  const textPrompt = buildTutorPrompt({ action, problem, noteSummary, hasImage: isCheck && !!canvasImage });

  // For 내 풀이 점검 with a canvas image, send vision input
  const input = isCheck && canvasImage
    ? [
        {
          role: "user",
          content: [
            { type: "input_text", text: textPrompt },
            {
              type: "input_image",
              image_url: canvasImage,
            },
          ],
        },
      ]
    : textPrompt;

  // Vision requires a model that supports it (gpt-4o family)
  const visionModel = isCheck && canvasImage ? "gpt-4o" : model;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: visionModel,
      input,
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

function buildTutorPrompt({ action, problem, noteSummary, hasImage }) {
  const base = [
    "너는 한국 중학교/고등학교 수학 튜터다.",
    "마크다운으로만 답하고 LaTeX 블록 수식 \\[ \\] 또는 \\( \\)는 쓰지 마라.",
    "줄간격이 커지지 않도록 짧은 문단과 bullet만 사용해라.",
    `문제: ${problem?.prompt || ""}`,
    `정답: ${problem?.answer || ""}`,
    `단원: ${problem?.title || ""} (${problem?.concept || ""})`,
  ];

  if (action === "내 풀이 점검") {
    return [
      ...base,
      hasImage
        ? "첨부된 이미지는 학생이 직접 필기한 풀이다. 이미지를 꼼꼼히 읽고 아래 형식으로 답해라."
        : `필기 요약: ${noteSummary || "필기 없음"}`,
      "역할: 학생 풀이를 채점/진단하는 선생님.",
      "반드시 아래 세 섹션으로만 답해라.",
      "## 풀이 분석",
      "- 학생이 쓴 식/과정을 그대로 인용하며 어디서 틀렸는지 구체적으로 짚어라.",
      "- 맞게 쓴 부분도 한 줄로 언급해라.",
      "- 필기를 읽을 수 없는 부분이 있으면 '이 부분은 읽기 어렵다'고 명시해라.",
      "## 올바른 풀이",
      "- 정답에 이르는 핵심 단계를 3줄 이내로 보여라.",
      "## 다음 행동",
      "- 학생이 지금 바로 고칠 한 가지만 짧게 지시해라.",
    ].join("\n");
  }

  return [
    ...base,
    `필기 요약: ${noteSummary || "없음"}`,
    "정답을 바로 공개하기보다 학생이 다음 한 단계를 찾도록 유도해라.",
    "교과 개념, 풀이 방향, 흔한 실수를 짧게 한국어로 설명해라.",
  ].join("\n");
}
