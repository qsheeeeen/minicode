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
    if (arg === '--model') {
      modelOverride = args[++i];
    } else if (arg === '--session') {
      sessionName = args[++i];
    } else if (arg === '--resume') {
      resumeRecent = true;
    } else if (arg === '--headless') {
      headless = true;
    } else if (arg === '--permission' || arg === '--perm') {
      const mode = args[++i];
      if (mode === 'manual' || mode === 'yolo' || mode === 'auto') {
        permissionMode = mode;
      }
    } else if (!arg.startsWith('--')) {
      initialPrompt = arg;
    }
  }

  return { modelOverride, initialPrompt, sessionName, resumeRecent, headless, permissionMode };
}

export function printHelp(): void {
  console.log('Mini Code - A minimal coding agent with TUI\n');
  console.log('Usage: minicode [options] [prompt]\n');
  console.log('Options:');
  console.log('  --model <spec>       Model specification (e.g., glm-4.7@zhipu)');
  console.log('  --session <name>     Session name (creates new or resumes existing)');
  console.log('  --resume             Resume most recent session');
  console.log('  --version, -v        Show version');
  console.log('  --headless           Run without TUI, output to stdout (requires prompt)');
  console.log('  --permission <mode>  Permission mode: manual, yolo, auto (default: manual)');
  console.log('  --help, -h           Show this help');
  console.log('\nExamples:');
  console.log('  minicode                             # Start TUI');
  console.log('  minicode "list files"                # Start TUI and auto-run prompt');
  console.log('  minicode --session my-session        # Use specific session');
  console.log('  minicode --headless --perm yolo "ls" # Headless, no permission checks');
  console.log('\nIn TUI mode:');
  console.log('  /compress       # Compress conversation history');
  console.log('  /new <name>     # Create new session');
  console.log('  /resume         # List and resume sessions');
  console.log('  /rename <name>  # Rename current session');
  console.log('  /exit           # Quit (or Ctrl+C)');
  console.log('  Shift+Tab       # Cycle permission mode (manual/yolo/auto)');
}
