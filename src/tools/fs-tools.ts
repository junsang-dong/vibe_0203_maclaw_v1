import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function resolveWithinRoot(targetPath: string): string {
  const absolute = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(ROOT, targetPath);
  if (!absolute.startsWith(ROOT)) {
    throw new Error("허용되지 않은 경로입니다.");
  }
  return absolute;
}

export function readFileRange(filePath: string, range?: [number, number]): string {
  const fullPath = resolveWithinRoot(filePath);
  const content = fs.readFileSync(fullPath, "utf-8");
  if (!range) return content;
  const [start, end] = range;
  return content.slice(start, end);
}

export function writeFile(filePath: string, content: string): void {
  const fullPath = resolveWithinRoot(filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

export function editFile(filePath: string, oldStr: string, newStr: string): void {
  const fullPath = resolveWithinRoot(filePath);
  const content = fs.readFileSync(fullPath, "utf-8");
  const next = content.replace(oldStr, newStr);
  if (next === content) {
    throw new Error("치환할 문자열을 찾지 못했습니다.");
  }
  fs.writeFileSync(fullPath, next, "utf-8");
}
