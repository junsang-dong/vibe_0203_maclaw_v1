import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { LLMConfig, LLMProvider } from "../types.js";

export interface AgentConfigFile {
  defaultModel?: LLMConfig;
  providers?: Record<LLMProvider, { apiKey?: string }>;
}

const CONFIG_DIR = path.join(os.homedir(), ".ai-agent");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export function loadAgentConfig(): AgentConfigFile {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as AgentConfigFile;
  } catch {
    return {};
  }
}

export function resolveModelConfig(
  override?: LLMConfig
): LLMConfig {
  const config = loadAgentConfig();
  const fallback: LLMConfig = {
    provider: "mock",
    model: "mock-1"
  };
  const base = config.defaultModel ?? fallback;
  const resolved = override ?? base;
  const providerKey = config.providers?.[resolved.provider]?.apiKey;
  return {
    ...resolved,
    apiKey: resolved.apiKey ?? providerKey
  };
}
