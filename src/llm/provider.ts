import { AgentProcessRequest, AgentResult, LLMConfig } from "../types.js";
import { buildPrompt } from "./prompt.js";
import { callOpenAI, callOpenAIStream } from "./providers/openai.js";
import { callAnthropic, callAnthropicStream } from "./providers/anthropic.js";
import { callGoogle, callGoogleStream } from "./providers/google.js";
import { streamText } from "./stream.js";

export interface LLMClient {
  generate(request: AgentProcessRequest, model: LLMConfig): Promise<AgentResult>;
  generateStream(
    request: AgentProcessRequest,
    model: LLMConfig,
    onDelta: (chunk: string) => void,
    onTool: (name: string, args: string) => void
  ): Promise<AgentResult>;
}

export class DefaultLLMClient implements LLMClient {
  async generate(request: AgentProcessRequest, model: LLMConfig): Promise<AgentResult> {
    if (model.provider === "mock") {
      const summary = [
        "요청을 수신했어요.",
        `모델: ${model.provider}/${model.model}`,
        request.context?.file ? `파일: ${request.context.file}` : "파일: 없음"
      ].join(" ");
      return {
        type: "message",
        content: `${summary}\n\n프롬프트: ${request.prompt}`
      };
    }

    const prompt = buildPrompt(request.prompt, request.context);
    let text = "";
    if (model.provider === "openai") {
      text = await callOpenAI(prompt, model);
    } else if (model.provider === "anthropic") {
      text = await callAnthropic(prompt, model);
    } else if (model.provider === "google") {
      text = await callGoogle(prompt, model);
    } else {
      text = "지원되지 않는 모델입니다.";
    }

    return { type: "message", content: text };
  }

  async generateStream(
    request: AgentProcessRequest,
    model: LLMConfig,
    onDelta: (chunk: string) => void,
    onTool: (name: string, args: string) => void
  ): Promise<AgentResult> {
    if (model.provider === "mock") {
      const result = await this.generate(request, model);
      if (result.type === "message") {
        streamText(result.content, onDelta);
      }
      return result;
    }

    const prompt = buildPrompt(request.prompt, request.context);
    let text = "";
    if (model.provider === "openai") {
      text = await callOpenAIStream(prompt, model, onDelta, onTool);
    } else if (model.provider === "anthropic") {
      text = await callAnthropicStream(prompt, model, onDelta, onTool);
    } else if (model.provider === "google") {
      text = await callGoogleStream(prompt, model, onDelta, onTool);
    } else {
      text = "지원되지 않는 모델입니다.";
    }

    return { type: "message", content: text };
  }
}
