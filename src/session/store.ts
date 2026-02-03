import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { LLMConfig, SessionMessage, SessionRecord } from "../types.js";

const SESSIONS_DIR = path.join(process.cwd(), ".ai-agent", "sessions");

function ensureDir() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function sessionPath(id: string): string {
  return path.join(SESSIONS_DIR, `${id}.json`);
}

export function createSession(model: LLMConfig): SessionRecord {
  ensureDir();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const record: SessionRecord = {
    id,
    createdAt: now,
    updatedAt: now,
    messages: [],
    model
  };
  saveSession(record);
  return record;
}

export function loadSession(id: string): SessionRecord | null {
  try {
    const raw = fs.readFileSync(sessionPath(id), "utf-8");
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}

export function saveSession(record: SessionRecord): void {
  ensureDir();
  record.updatedAt = new Date().toISOString();
  fs.writeFileSync(sessionPath(record.id), JSON.stringify(record, null, 2), "utf-8");
}

export function appendMessage(
  record: SessionRecord,
  message: SessionMessage
): SessionRecord {
  record.messages.push(message);
  saveSession(record);
  return record;
}

export function listSessions(): SessionRecord[] {
  ensureDir();
  const files = fs.readdirSync(SESSIONS_DIR);
  return files
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(SESSIONS_DIR, file), "utf-8");
      return JSON.parse(raw) as SessionRecord;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
