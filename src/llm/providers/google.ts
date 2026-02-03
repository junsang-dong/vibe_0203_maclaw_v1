import { LLMConfig } from "../../types.js";
import { extractSseData, readSseLines } from "../sse.js";
import { classifyApiError, readErrorBody } from "../errors.js";

export async function callGoogle(prompt: string, model: LLMConfig): Promise<string> {
  if (!model.apiKey) {
    return "Google API 키가 필요합니다.";
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.model}:generateContent?key=${model.apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: model.maxTokens ?? 512,
        temperature: 0.2
      }
    })
  });

  if (!response.ok) {
    const text = await readErrorBody(response);
    return `Google 호출 실패: ${classifyApiError(response.status, text)}`;
  }

  const data = (await response.json()) as any;
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

export async function callGoogleStream(
  prompt: string,
  model: LLMConfig,
  onDelta: (chunk: string) => void,
  onTool: (name: string, args: string) => void
): Promise<string> {
  if (!model.apiKey) {
    return "Google API 키가 필요합니다.";
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.model}:streamGenerateContent?key=${model.apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: model.maxTokens ?? 512,
        temperature: 0.2
      }
    })
  });

  if (!response.ok) {
    const text = await readErrorBody(response);
    return `Google 호출 실패: ${classifyApiError(response.status, text)}`;
  }

  let fullText = "";
  await readSseLines(response, (line) => {
    const data = extractSseData(line) ?? line;
    if (!data || data === "[DONE]") return;
    try {
      const json = JSON.parse(data);
      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part?.text) {
          fullText += part.text;
          onDelta(part.text);
        }
        if (part?.functionCall) {
          const name = part.functionCall.name ?? "tool";
          const args = part.functionCall.args
            ? JSON.stringify(part.functionCall.args)
            : "";
          onTool(name, args);
        }
      }
    } catch {
      // ignore parse errors
    }
  });

  return fullText;
}
