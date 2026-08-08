#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";
import { AppConfig } from "./config.js";
import { Args } from "./args.js";
import { createApp } from "./app/create-app.js";
import { runHeadlessApp } from "./app/run-headless.js";
import { runTuiApp } from "./app/run-tui.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const programStartTime = Date.now();

const packagePath = path.join(__dirname, "../package.json");
let VERSION = "0.0.0";
try {
  const packageJson = JSON.parse(
    await import("fs/promises").then((fs) => fs.readFile(packagePath, "utf-8")),
  );
  VERSION = packageJson.version;
} catch {
  // Standalone builds (e.g. bun build --compile) don't carry package.json;
  // fall back so the binary still runs.
}

const config = await AppConfig.load();
const args = new Args(process.argv, config, VERSION);

let runtime;
try {
  runtime = await createApp({
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
  await runHeadlessApp(runtime);
  process.exit(0);
}

await runTuiApp(runtime);
