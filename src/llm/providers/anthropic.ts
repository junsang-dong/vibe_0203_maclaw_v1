import { LLMConfig } from "../../types.js";
import { extractSseData, readSseLines } from "../sse.js";
import { classifyApiError, readErrorBody } from "../errors.js";

export async function callAnthropic(prompt: string, model: LLMConfig): Promise<string> {
  if (!model.apiKey) {
    return "Anthropic API 키가 필요합니다.";
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": model.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: model.model,
      max_tokens: model.maxTokens ?? 512,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) {
    const text = await readErrorBody(response);
    return `Anthropic 호출 실패: ${classifyApiError(response.status, text)}`;
  }

  const data = (await response.json()) as any;
  return data?.content?.[0]?.text ?? "";
}

export async function callAnthropicStream(
  prompt: string,
  model: LLMConfig,
  onDelta: (chunk: string) => void,
  onTool: (name: string, args: string) => void
): Promise<string> {
  if (!model.apiKey) {
    return "Anthropic API 키가 필요합니다.";
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": model.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: model.model,
      max_tokens: model.maxTokens ?? 512,
      messages: [{ role: "user", content: prompt }],
      stream: true
    })
  });

  if (!response.ok) {
    const text = await readErrorBody(response);
    return `Anthropic 호출 실패: ${classifyApiError(response.status, text)}`;
  }

  let fullText = "";
  const toolNames: Record<number, string> = {};
  const toolArgs: Record<number, string> = {};
  await readSseLines(response, (line) => {
    const data = extractSseData(line) ?? line;
    if (!data || data === "[DONE]") return;
    try {
      const json = JSON.parse(data);
      if (json?.type === "content_block_delta") {
        const deltaText = json?.delta?.text;
        if (deltaText) {
          fullText += deltaText;
          onDelta(deltaText);
        }
        const deltaJson = json?.delta?.partial_json;
        if (typeof deltaJson === "string") {
          const index = Number(json?.index ?? 0);
          toolArgs[index] = (toolArgs[index] ?? "") + deltaJson;
          const name = toolNames[index] ?? "tool";
          onTool(name, toolArgs[index]);
        }
      } else if (json?.type === "content_block_start") {
        const block = json?.content_block;
        if (block?.type === "tool_use") {
          const index = Number(json?.index ?? 0);
          const name = block?.name ?? "tool";
          toolNames[index] = name;
          const input = block?.input ? JSON.stringify(block.input) : "";
          toolArgs[index] = input;
          onTool(name, input);
        }
      }
    } catch {
      // ignore parse errors
    }
  });

  return fullText;
}
