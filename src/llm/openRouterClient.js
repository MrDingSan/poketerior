const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";

export async function callOpenRouter({
  apiKey,
  model = "openrouter/free",
  systemInstruction,
  prompt,
  imageBase64,
  mimeType = "image/png",
  temperature = 0.35,
  maxTokens,
  timeoutMs,
  signal,
  reasoning,
}) {
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY. Add it to your local .env file.");
  }

  const userContent = imageBase64
    ? [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${imageBase64}`,
          },
        },
      ]
    : prompt;

  const messages = [
    ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
    { role: "user", content: userContent },
  ];

  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(new Error(`OpenRouter request timed out after ${timeoutMs}ms.`)), timeoutMs)
    : null;
  const requestSignal = controller && signal
    ? AbortSignal.any([controller.signal, signal])
    : controller?.signal || signal;
  let response;
  let data;
  try {
    response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:4176",
        "X-Title": "Poker Coach",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(reasoning ? { reasoning } : {}),
      }),
      signal: requestSignal,
    });
    // Read the body before clearing the timer: a provider can send headers promptly and then stall on
    // the body, and a timeout that only covered the headers would leave the request hanging forever.
    data = await response.json().catch((error) => {
      if (requestSignal?.aborted) throw requestSignal.reason || error;
      return {};
    });
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.message || `OpenRouter request failed with ${response.status}`;
    throw new Error(message);
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenRouter returned an empty response.");
  }

  return {
    text: Array.isArray(text)
      ? text.map((part) => part.text || "").join("").trim()
      : String(text).trim(),
    raw: data,
    completion: {
      finishReason: data?.choices?.[0]?.finish_reason || null,
      safetyRatings: [],
      usageMetadata: data?.usage || null,
    },
  };
}
