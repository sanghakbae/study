export async function onRequestPost(context) {
  try {
    const webhookUrl = cleanEnv(context.env.GOOGLE_CHAT_WEBHOOK_URL);
    if (!webhookUrl) {
      return json({ error: "GOOGLE_CHAT_WEBHOOK_URL is not configured." }, 500);
    }

    const { text } = await context.request.json();
    if (!text) {
      return json({ error: "text is required." }, 400);
    }

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    return json({ ok: true });
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
    headers: { "Content-Type": "application/json" },
  });
}
