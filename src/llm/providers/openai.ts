import { LLMConfig } from "../../types.js";
import { extractSseData, readSseLines } from "../sse.js";
import { classifyApiError, readErrorBody } from "../errors.js";

export async function callOpenAI(prompt: string, model: LLMConfig): Promise<string> {
  if (!model.apiKey) {
    return "OpenAI API 키가 필요합니다.";
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${model.apiKey}`
    },
    body: JSON.stringify({
      model: model.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: model.maxTokens ?? 512,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const text = await readErrorBody(response);
    return `OpenAI 호출 실패: ${classifyApiError(response.status, text)}`;
  }

  const data = (await response.json()) as any;
  return data?.choices?.[0]?.message?.content ?? "";
}

export async function callOpenAIStream(
  prompt: string,
  model: LLMConfig,
  onDelta: (chunk: string) => void,
  onTool: (name: string, args: string) => void
): Promise<string> {
  if (!model.apiKey) {
    return "OpenAI API 키가 필요합니다.";
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${model.apiKey}`
    },
    body: JSON.stringify({
      model: model.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: model.maxTokens ?? 512,
      temperature: 0.2,
      stream: true
    })
  });

  if (!response.ok) {
    const text = await readErrorBody(response);
    return `OpenAI 호출 실패: ${classifyApiError(response.status, text)}`;
  }

  let fullText = "";
  const toolBuffers: Record<string, { name: string; args: string }> = {};
  await readSseLines(response, (line) => {
    const data = extractSseData(line) ?? line;
    if (data === "[DONE]") return;
    try {
      const json = JSON.parse(data);
      const delta = json?.choices?.[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        onDelta(delta);
      }
      const toolCalls = json?.choices?.[0]?.delta?.tool_calls;
      if (Array.isArray(toolCalls)) {
        for (const toolCall of toolCalls) {
          const index = String(toolCall.index ?? 0);
          const name = toolCall?.function?.name;
          const argsPart = toolCall?.function?.arguments ?? "";
          const existing = toolBuffers[index] ?? { name: name ?? "tool", args: "" };
          if (name) existing.name = name;
          existing.args += argsPart;
          toolBuffers[index] = existing;
          onTool(existing.name, existing.args);
        }
      }
    } catch {
      // ignore parse errors for non-data lines
    }
  });

  return fullText;
}
