import { curriculumNodes } from "./curriculum.js";
import { examPapersRaw } from "./examData.js";
import { generatedProblems } from "./problemBank.js";

// 학년 순서 (시험 센터 표시 순서)
export const GRADES = ["중1", "중2", "중3", "고1", "고2", "고3"];

export const EXAM_PASS_RATIO = 0.6; // 60점 이상 합격
export const EXAM_PASS_BONUS = { mid: 300, final: 500 }; // 합격 보너스 XP

// 한 학년의 스킬을 커리큘럼 순서대로 가져온다.
export function skillsForGrade(grade) {
  return curriculumNodes.filter((node) => node.stage === grade);
}

// 학년 스킬을 앞 절반(중간)/뒤 절반(기말) 범위로 나눈다.
export function examSkillSplit(grade) {
  const skills = skillsForGrade(grade);
  const midCount = Math.ceil(skills.length / 2);
  return { all: skills, mid: skills.slice(0, midCount), final: skills.slice(midCount) };
}

export function getExamPaper(grade, type) {
  return examPapersRaw[`${grade}-${type}`] || buildFallbackExamPaper(grade, type);
}

export function examTitle(grade, type) {
  const paper = getExamPaper(grade, type);
  return paper?.title || `${grade} ${type === "mid" ? "중간고사" : "기말고사"}`;
}

// 시험 한 건의 상태를 계산한다.
// status: "locked" | "available" | "passed"
function examState({ grade, type, unlocked, paper, result }) {
  if (result?.passed) {
    return { grade, type, key: `${grade}-${type}`, title: examTitle(grade, type), status: "passed", score: result.score ?? null, hasPaper: !!paper };
  }
  if (unlocked && paper) {
    return { grade, type, key: `${grade}-${type}`, title: examTitle(grade, type), status: "available", score: result?.score ?? null, hasPaper: true };
  }
  return { grade, type, key: `${grade}-${type}`, title: examTitle(grade, type), status: "locked", score: result?.score ?? null, hasPaper: !!paper };
}

// 한 학년의 중간/기말 시험 상태.
// completedSkillIds: 완료한 스킬 id 배열, examResults: { "<grade>-<type>": { passed, score } }
export function examStatusesForGrade(grade, completedSkillIds = [], examResults = {}) {
  const done = new Set(completedSkillIds);
  const { mid, all } = examSkillSplit(grade);
  const midUnlocked = mid.length > 0 && mid.every((s) => done.has(s.id)); // 절반 획득 → 중간
  const finalUnlocked = all.length > 0 && all.every((s) => done.has(s.id)); // 전부 획득 → 기말
  return {
    mid: examState({ grade, type: "mid", unlocked: midUnlocked, paper: getExamPaper(grade, "mid"), result: examResults[`${grade}-mid`] }),
    final: examState({ grade, type: "final", unlocked: finalUnlocked, paper: getExamPaper(grade, "final"), result: examResults[`${grade}-final`] }),
  };
}

// 전체 학년의 시험 상태 목록(시험 센터용).
export function allExamStatuses(completedSkillIds = [], examResults = {}) {
  return GRADES.map((grade) => ({
    grade,
    ...examStatusesForGrade(grade, completedSkillIds, examResults),
  }));
}

// 응시 가능(available) 상태인데 아직 합격하지 않은 시험 목록.
export function availableExams(completedSkillIds = [], examResults = {}) {
  const out = [];
  for (const row of allExamStatuses(completedSkillIds, examResults)) {
    if (row.mid.status === "available") out.push(row.mid);
    if (row.final.status === "available") out.push(row.final);
  }
  return out;
}

function buildFallbackExamPaper(grade, type) {
  const split = examSkillSplit(grade);
  const targetSkills = type === "mid" ? split.mid : split.final;
  if (!targetSkills.length) return null;

  const skillIds = new Set(targetSkills.map((skill) => skill.id));
  const pool = generatedProblems
    .filter((problem) => skillIds.has(problem.nodeId))
    .sort((a, b) => {
      const skillDiff = targetSkills.findIndex((skill) => skill.id === a.nodeId) - targetSkills.findIndex((skill) => skill.id === b.nodeId);
      if (skillDiff) return skillDiff;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });

  if (!pool.length) return null;

  const perSkill = targetSkills.flatMap((skill) =>
    pool
      .filter((problem) => problem.nodeId === skill.id)
      .slice(0, 4),
  );
  const problems = perSkill.length >= 18 ? perSkill.slice(0, 20) : pool.slice(0, 20);

  return {
    title: `${grade} ${type === "mid" ? "중간고사" : "기말고사"}`,
    problems: problems.map((problem, index) => ({
      title: problem.title || `${grade} 시험 ${index + 1}`,
      prompt: problem.prompt,
      answer: problem.answer,
      choices: problem.choices,
      difficulty: problem.difficulty || 1,
      concept: problem.concept || "",
      hint: problem.hint || "",
    })),
  };
}
