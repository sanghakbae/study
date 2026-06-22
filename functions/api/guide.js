export async function onRequestPost(context) {
  try {
    const apiKey = cleanEnv(context.env.OPENAI_API_KEY);
    if (!apiKey) {
      return json({ error: "OPENAI_API_KEY is not configured." }, 500);
    }

    const { problem, action, noteSummary } = await context.request.json();
    const prompt = buildTutorPrompt({ action, problem, noteSummary });

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cleanEnv(context.env.OPENAI_MODEL) || "gpt-5.5",
        input: prompt,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return json({ error: text }, response.status);
    }

    const data = await response.json();
    return json({
      guide:
        data.output_text ||
        data.output?.flatMap((item) => item.content || []).map((item) => item.text).filter(Boolean).join("\n") ||
        "풀이 방향을 만들지 못했습니다.",
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}

function cleanEnv(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function buildTutorPrompt({ action, problem, noteSummary }) {
  const base = [
    "너는 한국 중학교/고등학교 수학 튜터다.",
    "마크다운으로만 답하고 LaTeX 블록 수식 \\[ \\] 또는 \\( \\)는 쓰지 마라.",
    "줄간격이 커지지 않도록 짧은 문단과 bullet만 사용해라.",
    `버튼: ${action}`,
    `문제: ${problem?.prompt || ""}`,
    `정답: ${problem?.answer || ""}`,
    `단원: ${problem?.title || ""}`,
    `필기 요약: ${noteSummary || "사용자 필기 이미지/획 데이터가 저장됨"}`,
  ];

  if (action === "내 풀이 점검") {
    return [
      ...base,
      "역할: 학생 풀이를 채점/진단하는 선생님.",
      "반드시 아래 형식으로 답해라.",
      "## 평가",
      "- 맞은 점: 학생 풀이에서 타당한 부분을 짚어라.",
      "- 고칠 점: 오류나 빠진 단계가 있으면 짚어라. 필기 내용을 확신할 수 없으면 '필기에서 식을 정확히 읽기 어렵다'고 말해라.",
      "## 더 좋은 풀이",
      "- 같은 문제를 더 깔끔하게 푸는 방법을 2~4줄로 제안해라.",
      "## 다음 행동",
      "- 학생이 지금 바로 고칠 한 가지 행동을 제시해라.",
      "정답만 말하지 말고 풀이 품질을 평가해라.",
    ].join("\n");
  }

  return [
    ...base,
    "정답을 바로 공개하기보다 학생이 다음 한 단계를 찾도록 유도해라.",
    "교과 개념, 풀이 방향, 흔한 실수를 짧게 한국어로 설명해라.",
  ].join("\n");
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
