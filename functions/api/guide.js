export async function onRequestPost(context) {
  try {
    const apiKey = cleanEnv(context.env.OPENAI_API_KEY);
    if (!apiKey) {
      return json({ error: "OPENAI_API_KEY is not configured." }, 500);
    }

    const { problem, action, noteSummary } = await context.request.json();
    const prompt = [
      "너는 한국 중학교/고등학교 수학 튜터다.",
      "정답을 바로 공개하기보다 학생이 다음 한 단계를 찾도록 유도해라.",
      "교과 개념, 풀이 방향, 흔한 실수를 짧게 한국어로 설명해라.",
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
