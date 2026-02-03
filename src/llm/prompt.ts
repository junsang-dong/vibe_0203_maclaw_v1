import { AgentRequestContext } from "../types.js";

export function buildPrompt(prompt: string, context?: AgentRequestContext): string {
  if (!context) return prompt;
  const parts: string[] = [];
  if (context.file) parts.push(`파일: ${context.file}`);
  if (context.range) parts.push(`범위: ${context.range[0]}-${context.range[1]}`);
  if (context.selection) {
    parts.push("선택 코드:\n" + context.selection);
  }
  if (parts.length === 0) return prompt;
  return `${parts.join("\n")}\n\n사용자 요청: ${prompt}`;
}
