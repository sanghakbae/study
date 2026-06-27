// 워크플로가 작성한 검증본 JSON(scratchpad/gen/skills/*.json, exams/*.json)을
// 앱이 쓰는 정적 데이터 파일(src/data/curatedProblems.js, src/data/examData.js)로 조립한다.
//
// 사용법: node scripts/assemble-problems.mjs <genDir>
//   genDir 기본값은 인자로 받는다.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const GEN = process.argv[2] || join(ROOT, "scratchpad", "gen");

const SKILL_IDS = [
  "m1-numbers","m1-expressions","m1-equations","m1-coordinates","m1-geometry-basic","m1-plane-solid","m1-statistics",
  "m2-rational","m2-polynomial","m2-linear-system","m2-inequality","m2-functions","m2-geometry","m2-similarity","m2-probability",
  "m3-real-roots","m3-polynomial","m3-quadratic","m3-quadratic-function","m3-pythagorean","m3-circle","m3-statistics",
  "h-common-polynomial","h-common-equations","h-common-functions","h-common-geometry","h-common-combinatorics",
  "h-math1-exponential-log","h-math1-trigonometry","h-math1-sequence","h-math2-limits","h-math2-differential","h-math2-integral",
  "h-calculus-sequence-limit","h-calculus-differential","h-calculus-integral","h-geometry-conic","h-geometry-vector","h-geometry-space",
  "h-probability-counting","h-probability","h-statistics",
];

const EXAM_TITLES = {
  "중1-mid": "중1 중간고사", "중1-final": "중1 기말고사",
  "중2-mid": "중2 중간고사", "중2-final": "중2 기말고사",
  "중3-mid": "중3 중간고사", "중3-final": "중3 기말고사",
  "고1-mid": "고1 중간고사", "고1-final": "고1 기말고사",
  "고2-mid": "고2 중간고사", "고2-final": "고2 기말고사",
  "고3-mid": "고3 중간고사", "고3-final": "고3 기말고사",
};

const norm = (v) => String(v ?? "").replace(/\s+/g, "").replace(/[()]/g, "").replace(/−/g, "-").toLowerCase();

const issues = [];

function sanitizeProblem(raw, ctx, i) {
  if (!raw || typeof raw !== "object") { issues.push(`${ctx}[${i}] 객체 아님`); return null; }
  const prompt = String(raw.prompt || "").trim();
  const answer = String(raw.answer ?? "").trim();
  if (!prompt) { issues.push(`${ctx}[${i}] prompt 비어있음`); return null; }
  if (!answer) { issues.push(`${ctx}[${i}] answer 비어있음`); return null; }
  let difficulty = Math.round(Number(raw.difficulty));
  if (!Number.isFinite(difficulty)) difficulty = 1;
  difficulty = Math.min(5, Math.max(1, difficulty));
  const out = {
    title: String(raw.title || "").trim() || prompt.slice(0, 18),
    prompt,
    answer,
    difficulty,
    concept: String(raw.concept || "").trim(),
    hint: String(raw.hint || "").trim(),
  };
  if (Array.isArray(raw.choices) && raw.choices.length >= 2) {
    out.choices = raw.choices.map((c) => String(c));
    if (!out.choices.some((c) => norm(c) === norm(answer))) {
      issues.push(`${ctx}[${i}] 객관식 정답이 보기에 없음 (answer="${answer}")`);
    }
  }
  return out;
}

function loadFinals(dir) {
  if (!existsSync(dir)) return {};
  const out = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f.endsWith(".draft.json")) continue;
    const key = basename(f, ".json");
    try {
      const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const problems = (data.problems || []).map((p, i) => sanitizeProblem(p, key, i)).filter(Boolean);
      out[key] = problems;
    } catch (e) {
      issues.push(`${f} 파싱 실패: ${e.message}`);
    }
  }
  return out;
}

const skillData = loadFinals(join(GEN, "skills"));
const examData = loadFinals(join(GEN, "exams"));

// ── 스킬 데이터 점검 ──
const problemsBySkill = {};
for (const id of SKILL_IDS) {
  const list = skillData[id];
  if (!list || !list.length) { issues.push(`스킬 누락: ${id}`); continue; }
  if (list.length < 28) issues.push(`스킬 ${id} 문제 수 부족: ${list.length}`);
  problemsBySkill[id] = list;
}

// ── 시험 데이터 점검 ──
const examPapersRaw = {};
for (const key of Object.keys(EXAM_TITLES)) {
  const list = examData[key];
  if (!list || !list.length) { issues.push(`시험 누락: ${key}`); continue; }
  if (list.length < 18) issues.push(`시험 ${key} 문제 수 부족: ${list.length}`);
  examPapersRaw[key] = { title: EXAM_TITLES[key], problems: list };
}

// ── 파일 출력 ──
const skillHeader = `// 자동 생성 파일 — 직접 편집하지 마세요. (scripts/assemble-problems.mjs)\n// 형식: { "<skillId>": [ { title, prompt, answer, choices?, difficulty, concept, hint }, ... ] }\n`;
writeFileSync(
  join(ROOT, "src", "data", "curatedProblems.js"),
  `${skillHeader}export const problemsBySkill = ${JSON.stringify(problemsBySkill, null, 2)};\n`,
);

const examHeader = `// 자동 생성 파일 — 직접 편집하지 마세요. (scripts/assemble-problems.mjs)\n// 형식: { "<grade>-<mid|final>": { title, problems: [...] } }\n`;
writeFileSync(
  join(ROOT, "src", "data", "examData.js"),
  `${examHeader}export const examPapersRaw = ${JSON.stringify(examPapersRaw, null, 2)};\n`,
);

// ── 리포트 ──
const skillCount = Object.keys(problemsBySkill).length;
const skillTotal = Object.values(problemsBySkill).reduce((a, b) => a + b.length, 0);
const examCount = Object.keys(examPapersRaw).length;
const examTotal = Object.values(examPapersRaw).reduce((a, b) => a + b.problems.length, 0);
console.log(`스킬: ${skillCount}/42 (${skillTotal}문제), 시험: ${examCount}/12 (${examTotal}문제)`);
if (issues.length) {
  console.log(`\n⚠️  점검 항목 ${issues.length}건:`);
  for (const m of issues) console.log("  - " + m);
  process.exitCode = 1;
} else {
  console.log("✅ 점검 통과: 누락/형식 문제 없음");
}
