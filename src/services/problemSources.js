export const externalProblemSources = [
  {
    id: "manual-textbook",
    name: "교과서/문제집 라이선스 수동 업로드",
    status: "recommended",
    type: "admin-import",
    note: "교과서 문항은 저작권이 있어 출판사 또는 저작권자 계약 후 CSV/JSON으로 업로드하는 방식이 가장 안전합니다.",
  },
  {
    id: "data-go-kr",
    name: "공공데이터포털(data.go.kr)",
    status: "watch",
    type: "open-api",
    note: "검색 가능한 공개 API가 있으면 어댑터로 연결합니다. 현재 앱은 Firestore 표준 스키마로 흡수할 수 있게 구성했습니다.",
  },
  {
    id: "ai-hub",
    name: "AI Hub 교육/수학 데이터셋",
    status: "watch",
    type: "dataset",
    note: "API라기보다 다운로드형 데이터셋이 많습니다. 약관 확인 후 변환 스크립트로 Firestore에 적재하는 경로가 적합합니다.",
  },
  {
    id: "open-benchmarks",
    name: "GSM8K, MATH, MathQA 등 공개 벤치마크",
    status: "supplement",
    type: "dataset",
    note: "한국 교과서 단원과 직접 일치하지 않아 보충/챌린지 문제로만 쓰는 편이 맞습니다.",
  },
];

export function normalizeProblem(raw, sourceId) {
  return {
    id: raw.id || `${sourceId}-${crypto.randomUUID()}`,
    source: sourceId,
    sourceName: raw.sourceName || sourceId,
    nodeId: raw.nodeId || "unmapped",
    gradeBand: raw.gradeBand || "middle",
    difficulty: Number(raw.difficulty || 1),
    title: raw.title || "수학 문제",
    prompt: raw.prompt || raw.question || "",
    answer: raw.answer || "",
    concept: raw.concept || "",
    createdAt: new Date().toISOString(),
  };
}
