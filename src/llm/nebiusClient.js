const DEFAULT_NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1";

export async function callNebius({
  apiKey,
  baseUrl = DEFAULT_NEBIUS_BASE_URL,
  model = "nvidia/nemotron-3-super-120b-a12b",
  systemInstruction,
  prompt,
  temperature = 0.35,
  maxTokens,
  reasoningEffort,
  timeoutMs,
  signal,
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    throw new Error("Missing NEBIUS_API_KEY. Add it to the local .env file.");
  }

  const messages = [
    ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
    { role: "user", content: prompt },
  ];
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(new Error(`Nebius request timed out after ${timeoutMs}ms.`)), timeoutMs)
    : null;
  const requestSignal = controller && signal
    ? AbortSignal.any([controller.signal, signal])
    : controller?.signal || signal;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      }),
      signal: requestSignal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || "Unknown Token Factory error";
    throw new Error(`Nebius Token Factory request failed with ${response.status}: ${detail}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((part) => part?.text || "").join("").trim()
    : String(content || "").trim();
  if (!text) {
    throw new Error("Nebius Token Factory returned an empty response.");
  }

  return {
    text,
    raw: data,
    completion: {
      finishReason: data?.choices?.[0]?.finish_reason || null,
      safetyRatings: [],
      usageMetadata: data?.usage || null,
    },
  };
}
