import type { AppRuntime } from "../runtime/types.js";

export interface Surface {
  run(runtime: AppRuntime): Promise<void>;
}
