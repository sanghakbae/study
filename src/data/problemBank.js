import { curriculumNodes } from "./curriculum.js";

export const generatedProblems = curriculumNodes.flatMap((skill) => generateProblemsForSkill(skill));

export function getProblemsForSkill(skill) {
  if (!skill) return [];
  return generateProblemsForSkill(skill);
}

export function generateProblemsForSkill(skill) {
  return Array.from({ length: 50 }, (_, index) => buildProblem(skill, index + 1));
}

function buildProblem(skill, number) {
  const builder = getBuilder(skill);
  const built = builder(skill, number);
  return {
    id: `p-${skill.id}-${String(number).padStart(2, "0")}`,
    nodeId: skill.id,
    gradeBand: skill.stage.startsWith("중") ? "middle" : "high",
    source: "built-in",
    sourceName: "내장 단원 문제은행",
    difficulty: Math.min(5, 1 + Math.floor((number - 1) / 12)),
    title: `${skill.title} ${number}`,
    hint: buildHint(skill, built),
    nextStep: buildNextStep(skill, built),
    conceptGuide: buildConceptGuide(skill, built),
    ...built,
  };
}

function getBuilder(skill) {
  if (skill.unit === "수와 연산") return buildNumberProblem;
  if (skill.unit === "문자와 식") return buildExpressionProblem;
  if (skill.unit === "함수") return buildFunctionProblem;
  if (skill.unit === "기하") return buildGeometryProblem;
  if (skill.unit === "확률과 통계") return buildProbabilityProblem;
  if (skill.unit === "공통수학") return buildCommonMathProblem;
  if (skill.unit === "수학 I") return buildMathOneProblem;
  if (skill.unit === "수학 II") return buildMathTwoProblem;
  if (skill.unit === "미적분") return buildCalculusProblem;
  return buildExpressionProblem;
}

function buildNumberProblem(skill, n) {
  const a = n + 2;
  const b = (n % 9) + 3;
  const c = (n % 5) + 1;
  return {
    prompt: `다음 값을 계산하시오. (-${a}) + ${b} - (-${c})`,
    answer: String(-a + b + c),
    concept: `${skill.title}에서는 부호를 먼저 정리한 뒤 같은 종류의 수끼리 계산한다.`,
  };
}

function buildExpressionProblem(skill, n) {
  const a = (n % 5) + 2;
  const b = (n % 7) + 1;
  const c = (n % 4) + 1;
  const xCoef = a - c;
  const constant = a * b;
  return {
    prompt: `${a}(x + ${b}) - ${c}x를 간단히 하시오.`,
    answer: `${xCoef}x + ${constant}`,
    concept: `${skill.title}에서는 분배법칙을 적용한 뒤 동류항끼리 모은다.`,
  };
}

function buildFunctionProblem(skill, n) {
  const a = (n % 5) + 1;
  const b = (n % 7) - 3;
  const x1 = (n % 4) + 1;
  const x2 = x1 + (n % 5) + 2;
  return {
    prompt: `함수 y = ${a}x ${formatSigned(b)}에서 x가 ${x1}에서 ${x2}까지 증가할 때 y의 증가량을 구하시오.`,
    answer: String(a * (x2 - x1)),
    concept: `${skill.title}에서는 x의 변화량과 기울기의 관계를 확인한다.`,
  };
}

function buildGeometryProblem(skill, n) {
  const triples = [
    [3, 4, 5],
    [5, 12, 13],
    [8, 15, 17],
    [7, 24, 25],
    [9, 12, 15],
  ];
  const [a, b, c] = triples[n % triples.length];
  const scale = (n % 3) + 1;
  return {
    prompt: `직각삼각형의 두 직각변의 길이가 ${a * scale}, ${b * scale}일 때 빗변의 길이를 구하시오.`,
    answer: String(c * scale),
    concept: `${skill.title}에서는 도형의 조건을 식으로 바꾸고 길이 관계를 계산한다.`,
  };
}

function buildProbabilityProblem(skill, n) {
  const total = 12 + (n % 9);
  const divisor = (n % 4) + 2;
  const count = Math.floor(total / divisor);
  return {
    prompt: `1부터 ${total}까지 적힌 카드 중 한 장을 뽑을 때 ${divisor}의 배수가 나올 확률을 구하시오.`,
    answer: reduceFraction(count, total),
    concept: `${skill.title}에서는 전체 경우의 수와 조건을 만족하는 경우의 수를 구한다.`,
  };
}

function buildCommonMathProblem(skill, n) {
  const r1 = (n % 5) + 1;
  const r2 = r1 + (n % 4) + 1;
  return {
    prompt: `이차방정식 x² - ${r1 + r2}x + ${r1 * r2} = 0의 두 근을 구하시오.`,
    answer: `${r1}, ${r2}`,
    concept: `${skill.title}에서는 식의 구조를 보고 인수분해 또는 근의 관계를 활용한다.`,
  };
}

function buildMathOneProblem(skill, n) {
  const first = (n % 6) + 1;
  const diff = (n % 5) + 2;
  const order = (n % 8) + 5;
  return {
    prompt: `첫째항이 ${first}, 공차가 ${diff}인 등차수열의 제${order}항을 구하시오.`,
    answer: String(first + (order - 1) * diff),
    concept: `${skill.title}에서는 일반항을 세운 뒤 필요한 값을 대입한다.`,
  };
}

function buildMathTwoProblem(skill, n) {
  const a = (n % 4) + 1;
  const b = (n % 7) - 3;
  const x = (n % 5) + 1;
  return {
    prompt: `f(x) = ${a}x² ${formatSigned(b)}x일 때 f'(${x})의 값을 구하시오.`,
    answer: String(2 * a * x + b),
    concept: `${skill.title}에서는 도함수를 먼저 구한 뒤 주어진 x값을 대입한다.`,
  };
}

function buildCalculusProblem(skill, n) {
  const a = (n % 4) + 1;
  const b = (n % 5) + 1;
  const x = (n % 4) + 1;
  return {
    prompt: `f(x) = ${a}x³ - ${b}x²일 때 f'(${x})의 값을 구하시오.`,
    answer: String(3 * a * x * x - 2 * b * x),
    concept: `${skill.title}에서는 거듭제곱의 미분법을 적용하고 계산 실수를 줄인다.`,
  };
}

function formatSigned(value) {
  if (value === 0) return "";
  return value > 0 ? `+ ${value}` : `- ${Math.abs(value)}`;
}

function reduceFraction(numerator, denominator) {
  const divisor = gcd(numerator, denominator);
  const top = numerator / divisor;
  const bottom = denominator / divisor;
  return bottom === 1 ? String(top) : `${top}/${bottom}`;
}

function gcd(a, b) {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

function buildHint(skill, problem) {
  return [
    "## 힌트",
    "### 1. 먼저 볼 것",
    `- 단원: **${skill.stage} ${skill.title}**`,
    "- 문제에서 **주어진 값**과 **구해야 하는 값**을 나눠 표시해.",
    "",
    "### 2. 적용할 생각",
    `- ${problem.concept}`,
    "- 계산을 시작하기 전에 괄호, 부호, 조건을 먼저 정리해.",
    "",
    "### 3. 직접 해볼 한 줄",
    `- 원래 식/조건을 유지한 채, 바뀌는 부분만 한 번 고쳐 써 봐.`,
    "- 아직 답까지 가지 말고 중간식까지만 만들어.",
    "",
    "### 자주 하는 실수",
    "- 머릿속으로 한 번에 계산해서 중간 부호를 빠뜨리는 것.",
    "- 괄호 안 부호와 괄호 밖 연산을 따로 보지 않는 것.",
  ].join("\n");
}

function buildNextStep(skill, problem) {
  return [
    "## 다음 한 단계",
    `- 지금 풀고 있는 단원은 **${skill.title}**이야.`,
    `- 사용할 개념: ${problem.concept}`,
    "",
    "### 해야 할 일",
    "- 식이나 조건을 그대로 다시 쓴다.",
    "- 바뀌어야 하는 부호/항/공식 부분에 표시한다.",
    "- 그 부분만 고쳐서 다음 줄에 중간식을 쓴다.",
    "",
    "### 멈출 지점",
    "- 답을 바로 쓰지 말고, 중간식이 맞는지 먼저 확인해.",
  ].join("\n");
}

function buildConceptGuide(skill, problem) {
  return [
    "## 개념 다시보기",
    `### ${skill.stage} · ${skill.title}`,
    `- 영역: **${skill.unit}**`,
    `- 핵심 개념: ${problem.concept}`,
    "",
    "### 풀이 흐름",
    "1. 문제의 조건을 수식이나 그림 정보로 옮긴다.",
    "2. 이 단원에서 쓰는 규칙/공식을 한 줄로 적는다.",
    "3. 값을 대입하고 한 단계씩 계산한다.",
    "4. 마지막에 답이 문제에서 묻는 형태인지 확인한다.",
    "",
    "### 체크리스트",
    "- 부호를 바꿔야 하는 곳이 있는가?",
    "- 괄호를 풀 때 모든 항에 적용했는가?",
    "- 분수/제곱/근호/확률의 조건을 빠뜨리지 않았는가?",
    "- 중간식 없이 답만 쓰지 않았는가?",
    "",
    "### 공부 팁",
    "- 같은 유형 3문제를 연속으로 풀어 규칙을 손에 익혀라.",
    "- 틀린 문제는 계산 실수인지 개념 실수인지 분리해서 표시해라.",
  ].join("\n");
}
