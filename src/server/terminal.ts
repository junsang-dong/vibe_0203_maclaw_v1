import crypto from "node:crypto";
import { runBash } from "../tools/bash-tool.js";

export interface TerminalRequest {
  id: string;
  command: string;
  createdAt: string;
}

const pendingRequests = new Map<string, TerminalRequest>();

export function createTerminalRequest(command: string): TerminalRequest {
  const request: TerminalRequest = {
    id: crypto.randomUUID(),
    command,
    createdAt: new Date().toISOString()
  };
  pendingRequests.set(request.id, request);
  return request;
}

export function getTerminalRequest(id: string): TerminalRequest | null {
  return pendingRequests.get(id) ?? null;
}

export function clearTerminalRequest(id: string): void {
  pendingRequests.delete(id);
}

export async function executeTerminalCommand(command: string) {
  return runBash(command, process.cwd());
}
