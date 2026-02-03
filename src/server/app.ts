import express from "express";
import cors from "cors";
import {
  AgentProcessRequest,
  AgentProcessResponse,
  AgentStreamChunk,
  JsonRpcError,
  JsonRpcRequest,
  JsonRpcSuccess,
  SessionMessage
} from "../types.js";
import { resolveModelConfig } from "../llm/config.js";
import { DefaultLLMClient } from "../llm/provider.js";
import { appendMessage, createSession, listSessions, loadSession } from "../session/store.js";
import {
  clearTerminalRequest,
  createTerminalRequest,
  executeTerminalCommand,
  getTerminalRequest
} from "./terminal.js";

const llm = new DefaultLLMClient();

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/agent/process", async (req, res) => {
    const payload = req.body as AgentProcessRequest;
    if (!payload?.prompt) {
      res.status(400).json({ error: "prompt가 필요합니다." });
      return;
    }

    const model = resolveModelConfig(payload.model);
    const session =
      (payload.sessionId && loadSession(payload.sessionId)) ?? createSession(model);

    const userMessage: SessionMessage = {
      role: "user",
      content: payload.prompt,
      createdAt: new Date().toISOString()
    };
    appendMessage(session, userMessage);

    const result = await llm.generate(payload, model);
    const assistantMessage: SessionMessage = {
      role: "assistant",
      content: result.type === "message" ? result.content : JSON.stringify(result),
      createdAt: new Date().toISOString()
    };
    appendMessage(session, assistantMessage);

    const response: AgentProcessResponse = {
      sessionId: session.id,
      result
    };

    res.json(response);
  });

  app.post("/rpc", async (req, res) => {
    const rpc = req.body as JsonRpcRequest<AgentProcessRequest>;
    if (!rpc || rpc.jsonrpc !== "2.0") {
      const error: JsonRpcError = {
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid Request" },
        id: null
      };
      res.status(400).json(error);
      return;
    }

    if (rpc.method !== "agent.process") {
      const error: JsonRpcError = {
        jsonrpc: "2.0",
        error: { code: -32601, message: "Method not found" },
        id: rpc.id ?? null
      };
      res.status(404).json(error);
      return;
    }

    const payload = rpc.params;
    if (!payload?.prompt) {
      const error: JsonRpcError = {
        jsonrpc: "2.0",
        error: { code: -32602, message: "prompt가 필요합니다." },
        id: rpc.id ?? null
      };
      res.status(400).json(error);
      return;
    }

    const model = resolveModelConfig(payload.model);
    const session =
      (payload.sessionId && loadSession(payload.sessionId)) ?? createSession(model);

    const userMessage: SessionMessage = {
      role: "user",
      content: payload.prompt,
      createdAt: new Date().toISOString()
    };
    appendMessage(session, userMessage);

    if (payload.stream) {
      res.status(200);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Transfer-Encoding", "chunked");

      const writeChunk = (chunk: AgentStreamChunk) => {
        const data: JsonRpcSuccess<AgentStreamChunk> = {
          jsonrpc: "2.0",
          result: chunk,
          id: rpc.id ?? null
        };
        res.write(`${JSON.stringify(data)}\n`);
      };

      writeChunk({ type: "start", sessionId: session.id });
      const result = await llm.generateStream(
        payload,
        model,
        (delta) => {
          writeChunk({ type: "delta", content: delta });
        },
        (name, args) => {
          writeChunk({ type: "tool", name, arguments: args });
        }
      );

      const assistantMessage: SessionMessage = {
        role: "assistant",
        content: result.type === "message" ? result.content : JSON.stringify(result),
        createdAt: new Date().toISOString()
      };
      appendMessage(session, assistantMessage);
      writeChunk({ type: "final", result });
      res.end();
      return;
    }

    const result = await llm.generate(payload, model);
    const assistantMessage: SessionMessage = {
      role: "assistant",
      content: result.type === "message" ? result.content : JSON.stringify(result),
      createdAt: new Date().toISOString()
    };
    appendMessage(session, assistantMessage);

    const response: JsonRpcSuccess<AgentProcessResponse> = {
      jsonrpc: "2.0",
      result: {
        sessionId: session.id,
        result
      },
      id: rpc.id ?? null
    };
    res.json(response);
  });

  app.get("/api/agent/sessions", (_req, res) => {
    res.json(listSessions());
  });

  app.get("/api/agent/sessions/:id", (req, res) => {
    const session = loadSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "세션을 찾을 수 없습니다." });
      return;
    }
    res.json(session);
  });

  app.post("/api/agent/terminal/request", (req, res) => {
    const { command } = req.body as { command?: string };
    if (!command) {
      res.status(400).json({ error: "command가 필요합니다." });
      return;
    }
    const request = createTerminalRequest(command);
    res.json(request);
  });

  app.post("/api/agent/terminal/execute", async (req, res) => {
    const { requestId, approve } = req.body as {
      requestId?: string;
      approve?: boolean;
    };
    if (!requestId) {
      res.status(400).json({ error: "requestId가 필요합니다." });
      return;
    }
    const request = getTerminalRequest(requestId);
    if (!request) {
      res.status(404).json({ error: "요청을 찾을 수 없습니다." });
      return;
    }
    if (!approve) {
      clearTerminalRequest(requestId);
      res.json({ ok: false, message: "사용자가 실행을 거부했습니다." });
      return;
    }
    const result = await executeTerminalCommand(request.command);
    clearTerminalRequest(requestId);
    res.json({ ok: true, result });
  });

  return app;
}
