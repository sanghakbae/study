export async function onRequestPost(context) {
  try {
    const apiKey = cleanEnv(context.env.OPENAI_API_KEY);
    if (!apiKey) {
      return json({ error: "OPENAI_API_KEY is not configured." }, 500);
    }

    const { problem, action, noteSummary, canvasImage } = await context.request.json();
    const hasHandwriting = isValidImageDataUrl(canvasImage);
    const input = buildTutorInput({ action, problem, noteSummary, hasHandwriting, canvasImage });

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cleanEnv(context.env.OPENAI_MODEL) || "gpt-5.4-mini",
        input,
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
      usage: normalizeUsage(data.usage),
      model: data.model || cleanEnv(context.env.OPENAI_MODEL) || "gpt-5.4-mini",
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}

function normalizeUsage(usage = {}) {
  const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
  const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
  const totalTokens = usage.total_tokens || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

function cleanEnv(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function isValidImageDataUrl(value) {
  return typeof value === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(value);
}

// OpenAI Responses API 멀티모달 입력(텍스트 + 필기 이미지)을 구성한다.
function buildTutorInput({ action, problem, noteSummary, hasHandwriting, canvasImage }) {
  const prompt = buildTutorPrompt({ action, problem, noteSummary, hasHandwriting });

  const content = [{ type: "input_text", text: prompt }];
  if (hasHandwriting) {
    // 학생이 펜으로 작성한 풀이 이미지를 비전 입력으로 함께 전달한다.
    content.push({ type: "input_image", image_url: canvasImage });
  }

  return [{ role: "user", content }];
}

function buildTutorPrompt({ action, problem, noteSummary, hasHandwriting }) {
  const base = [
    "너는 한국 중학교/고등학교 수학 튜터다.",
    "마크다운으로만 답하고 LaTeX 블록 수식 \\[ \\] 또는 \\( \\)는 쓰지 마라.",
    "줄간격이 커지지 않도록 짧은 문단과 bullet만 사용해라.",
    `버튼: ${action}`,
    `문제: ${problem?.prompt || ""}`,
    `정답: ${problem?.answer || ""}`,
    `단원: ${problem?.title || ""}`,
  ];

  if (hasHandwriting) {
    base.push(
      "학생이 펜으로 작성한 풀이 이미지가 함께 첨부되어 있다. 이미지를 읽어 학생 풀이를 파악해라.",
      "이미지에서 식을 정확히 읽기 어려우면 '필기에서 일부 식을 정확히 읽기 어렵다'고 밝힌 뒤 진행해라.",
    );
  } else {
    base.push(`필기 요약: ${noteSummary || "학생이 아직 펜으로 작성한 풀이가 없다."}`);
  }

  // 모든 안내는 위에 주어진 '문제'와 '정답'을 반드시 기준으로 삼아 그 문제에 한정해 작성한다.
  base.push("주의: 일반론이 아니라 위에 주어진 실제 문제의 숫자·식·조건을 직접 인용해서 답해라. 문제와 무관한 일반 설명은 금지.");

  // 풀이 방향: 정답은 숨기고, 이 문제를 푸는 접근 전략(큰 그림)을 제시한다.
  if (action === "풀이 방향") {
    return [
      ...base,
      "역할: 이 문제를 어떤 순서로 접근할지 풀이 '전략'을 알려주는 코치.",
      "반드시 아래 형식으로 답해라.",
      "## 풀이 방향",
      "- 무엇을 구하는 문제인지, 어떤 개념·공식을 쓰는지 이 문제 기준으로 한 줄로 정리해라.",
      "## 단계별 접근",
      "- 이 문제의 실제 값으로 세울 첫 식(또는 첫 변형)을 보여줘라.",
      "- 그 다음 밟을 단계를 2~4개로 순서대로 안내해라. (각 단계는 한 줄)",
      "절대 최종 정답(숫자/결과)은 공개하지 마라. 마지막 계산은 학생이 직접 하도록 남겨둬라.",
    ].join("\n");
  }

  // 힌트 받기: 정답 숫자는 말하지 않되, 한 단계만 더 하면 답이 나오는 결정적 힌트.
  if (action === "힌트 받기") {
    return [
      ...base,
      "역할: 학생이 막혔을 때 정답을 스스로 떠올리도록 결정적 힌트를 주는 도우미.",
      "반드시 아래 형식으로 답해라.",
      "## 힌트",
      "- 이 문제의 핵심이 되는 결정적 한 수를 실제 값으로 보여줘라. (예: 부호 정리, 대입, 이항, 약분 중 이 문제에 필요한 단계를 직접 적용한 중간식)",
      "- 그 다음 무엇을 하면 답이 나오는지 한 줄로 알려줘라.",
      "최종 정답 숫자 자체는 적지 마라. 단, 한 단계만 더 하면 답이 나올 만큼 구체적으로 줘라.",
      "'풀이 방향'보다 더 구체적이고 정답에 가까운 힌트여야 한다.",
    ].join("\n");
  }

  // AI 가이드(내 풀이 점검 포함): 펜 필기 여부와 무관하게 항상 상세한 해답을 제공한다.
  return [
    ...base,
    "반드시 아래 형식으로, 펜 필기 여부와 관계없이 문제의 상세한 해답을 끝까지 안내해라.",
    "## 정답",
    "- 최종 정답을 먼저 한 줄로 제시해라.",
    "## 상세 풀이",
    "- 문제를 푸는 모든 단계를 순서대로, 각 단계의 근거(개념·공식)와 계산을 빠짐없이 보여줘라.",
    "- 중간 계산도 생략하지 말고 학생이 따라올 수 있게 단계별로 적어라.",
    hasHandwriting
      ? "## 내 풀이 점검\n- 첨부된 필기 이미지의 풀이에서 맞은 부분과 틀린/빠진 부분을 짚어주고, 정답 풀이와 비교해 무엇을 고치면 되는지 알려줘라."
      : "## 흔한 실수\n- 이 문제에서 학생들이 자주 틀리는 부분을 1~2개 짚어줘라.",
    "## 핵심 개념",
    "- 이 문제를 푸는 데 필요한 핵심 개념을 1~2줄로 정리해라.",
  ].join("\n");
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
