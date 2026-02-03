import { exec } from "node:child_process";

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runBash(command: string, cwd = process.cwd()): Promise<BashResult> {
  return new Promise((resolve) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      const exitCode = error && typeof (error as any).code === "number"
        ? (error as any).code
        : 0;
      resolve({
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? (error?.message ?? ""),
        exitCode
      });
    });
  });
}
