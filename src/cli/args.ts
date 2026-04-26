export type PermissionMode = 'manual' | 'yolo' | 'auto';

export interface CliArgs {
  modelOverride?: string;
  initialPrompt?: string;
  sessionName?: string;
  resumeRecent: boolean;
  headless: boolean;
  permissionMode?: PermissionMode;
}

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let modelOverride: string | undefined;
  let initialPrompt: string | undefined;
  let sessionName: string | undefined;
  let resumeRecent = false;
  let headless = false;
  let permissionMode: PermissionMode | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--model' || arg === '-m') {
      modelOverride = args[++i];
    } else if (arg === '--session' || arg === '-s') {
      sessionName = args[++i];
    } else if (arg === '--resume' || arg === '-r') {
      resumeRecent = true;
    } else if (arg === '--headless' || arg === '-H') {
      headless = true;
    } else if (arg === '--permission' || arg === '--perm') {
      const mode = args[++i];
      if (mode === 'manual' || mode === 'yolo' || mode === 'auto') {
        permissionMode = mode;
      }
    } else if (arg === '--help' || arg === '-h' || arg === '-?') {
      printHelp();
      process.exit(0);
    } else if (arg === '--version' || arg === '-v') {
      // version is handled in cli.tsx before parseArgs is called
    } else if (!arg.startsWith('--')) {
      initialPrompt = arg;
    } else if (arg.startsWith('--')) {
      console.warn(`Unknown option: ${arg}`);
      // Skip the next argument if it doesn't start with -- (it's the flag's value)
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        i++;
      }
    }
  }

  return { modelOverride, initialPrompt, sessionName, resumeRecent, headless, permissionMode };
}

export function printHelp(): void {
  console.log('Mini Code - A minimal coding agent with TUI\n');
  console.log('Usage: minicode [options] [prompt]\n');
  console.log('Options:');
  console.log('  --model, -m <spec>   Model specification (e.g., glm-4.7@zhipu)');
  console.log('  --session, -s <name>  Session name (creates new or resumes existing)');
  console.log('  --resume, -r          Resume most recent session');
  console.log('  --headless, -H        Run without TUI, output to stdout (requires prompt)');
  console.log('  --permission <mode>  Permission mode: manual, yolo, auto (default: manual)');
  console.log('  --version, -v         Show version');
  console.log('  --help, -h            Show this help');
  console.log('\nExamples:');
  console.log('  minicode                             # Start TUI');
  console.log('  minicode "list files"                # Start TUI and auto-run prompt');
  console.log('  minicode -s my-session              # Use specific session');
  console.log('  minicode -H --perm yolo "ls"        # Headless, no permission checks');
  console.log('\nIn TUI mode:');
  console.log('  /compress       # Compress conversation history');
  console.log('  /new <name>     # Create new session');
  console.log('  /resume         # List and resume sessions');
  console.log('  /rename <name>  # Rename current session');
  console.log('  /exit           # Quit (or Ctrl+C)');
  console.log('  Shift+Tab       # Cycle permission mode (manual/yolo/auto)');
  console.log('  Ctrl+O          # Switch active agent');
}
