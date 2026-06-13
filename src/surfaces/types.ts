import type { AppRuntime } from "../app/types.js";

export interface Surface {
  run(runtime: AppRuntime): Promise<void>;
}
