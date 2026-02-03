export type LLMProvider = "openai" | "anthropic" | "google" | "mock";

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  maxTokens?: number;
}

export interface AgentRequestContext {
  file?: string;
  selection?: string;
  range?: [number, number];
}

export interface AgentProcessRequest {
  prompt: string;
  context?: AgentRequestContext;
  sessionId?: string;
  model?: LLMConfig;
  stream?: boolean;
}

export interface AgentProcessResponse {
  sessionId: string;
  result: AgentResult;
}

export type AgentResult =
  | {
      type: "message";
      content: string;
    }
  | {
      type: "edit";
      file: string;
      changes: Array<{ range: [number, number]; newText: string }>;
    };

export type AgentStreamChunk =
  | { type: "start"; sessionId: string }
  | { type: "delta"; content: string }
  | { type: "tool"; name: string; arguments: string }
  | { type: "final"; result: AgentResult };

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: TParams;
  id: number | string | null;
}

export interface JsonRpcSuccess<T = unknown> {
  jsonrpc: "2.0";
  result: T;
  id: number | string | null;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  error: { code: number; message: string; data?: unknown };
  id: number | string | null;
}

export interface SessionMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
  model: LLMConfig;
}
