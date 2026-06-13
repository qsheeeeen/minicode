#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";
import { AppConfig } from "./config.js";
import { Args } from "./args.js";
import { createRuntime } from "./runtime/create-runtime.js";
import { HeadlessSurface } from "./surfaces/headless-surface.js";
import { TuiSurface } from "./surfaces/tui-surface.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const programStartTime = Date.now();

const packagePath = path.join(__dirname, "../package.json");
const packageJson = JSON.parse(
  await import("fs/promises").then((fs) => fs.readFile(packagePath, "utf-8")),
);
const VERSION = packageJson.version;

const config = await AppConfig.load();
const args = new Args(process.argv, config, VERSION);

let runtime;
try {
  runtime = await createRuntime({
    args,
    config,
    version: VERSION,
    cwd: process.cwd(),
    programStartTime,
    stdinIsTTY: process.stdin.isTTY,
  });
} catch (error) {
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

if (runtime.headless) {
  await new HeadlessSurface().run(runtime);
  process.exit(0);
}

await new TuiSurface().run(runtime);
