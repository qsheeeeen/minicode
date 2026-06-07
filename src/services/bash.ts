import { execSync } from "child_process";

export function runBash(cmd: string): string {
  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 30000,
      cwd: process.cwd(),
    });
    return output.trim() || "(no output)";
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}
