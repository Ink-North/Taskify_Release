/**
 * Minimal fetch-based OpenAI-compatible AI client.
 * No npm packages — uses Node 18+ built-in fetch.
 */

export async function callAI(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  timeoutMs?: number;
}): Promise<string> {
  const timeout = opts.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.userMessage },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`AI API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI API returned no content in choices[0].message.content");
  }
  return content;
}
