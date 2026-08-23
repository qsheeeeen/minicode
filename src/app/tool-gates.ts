// Gates wired into the ToolExecutor's hook pipeline. This is composition-root
// glue: it needs both services (permission) and tools (hook types), so it can
// only live where both are importable — the app layer.

import type { BeforeToolCallHook } from "../tools/executor.js";
import type { PermissionService } from "../services/permission.js";
import { callContent } from "../utils/tool-format.js";

/**
 * Permission as a beforeToolCall gate. Read-only / permission-free tools pass
 * through without a check; everything else asks the permission service. A
 * denial blocks only this call — the batch continues (pi semantics).
 */
export function createPermissionGate(
  permissionService: PermissionService,
): BeforeToolCallHook {
  return async (call, ctx) => {
    if (call.tool.readOnly ?? !call.tool.requiresPermission) return undefined;
    const { allowed, reason } = await permissionService.check(
      call.tool.name,
      call.args,
      callContent(call.tool.name, call.args),
      ctx.prompter,
    );
    if (allowed) return undefined;
    if (permissionService.getMode() === "auto") {
      return {
        block: true,
        reason: `Tool execution denied by auto-gate: ${reason || "unknown reason"}`,
      };
    }
    return { block: true, reason: reason || "User rejected" };
  };
}
