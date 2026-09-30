const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export async function callGemini({
  apiKey,
  model = "gemini-2.5-flash",
  systemInstruction,
  prompt,
  parts,
  temperature = 0.35,
  maxTokens,
  timeoutMs,
  signal,
}) {
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY. Add it to a local .env file at the project root.");
  }

  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(new Error(`Gemini request timed out after ${timeoutMs}ms.`)), timeoutMs)
    : null;
  const requestSignal = controller && signal
    ? AbortSignal.any([controller.signal, signal])
    : controller?.signal || signal;
  let response;
  let data;
  try {
    response = await fetch(`${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: systemInstruction
          ? { parts: [{ text: systemInstruction }] }
          : undefined,
        contents: [{ role: "user", parts: parts || [{ text: prompt }] }],
        generationConfig: {
          temperature,
          topP: 0.9,
          maxOutputTokens: maxTokens,
        },
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
    const message = data?.error?.message || `Gemini request failed with ${response.status}`;
    throw new Error(message);
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  return {
    text,
    raw: data,
    completion: {
      finishReason: data?.candidates?.[0]?.finishReason || null,
      safetyRatings: data?.candidates?.[0]?.safetyRatings || [],
      usageMetadata: data?.usageMetadata || null,
    },
  };
}
