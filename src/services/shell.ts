import { createDefaultShellService } from "./shell-service.js";

export function runShell(cmd: string): string {
  return createDefaultShellService().runSync(cmd);
}
