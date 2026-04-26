import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

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
  const parsed = yargs(hideBin(argv))
    .option('model', {
      alias: 'm',
      type: 'string',
      description: 'Model specification (e.g., glm-4.7@zhipu)',
    })
    .option('session', {
      alias: 's',
      type: 'string',
      description: 'Session name (creates new or resumes existing)',
    })
    .option('resume', {
      alias: 'r',
      type: 'boolean',
      description: 'Resume most recent session',
      default: false,
    })
    .option('headless', {
      alias: 'H',
      type: 'boolean',
      description: 'Run without TUI, output to stdout (requires prompt)',
      default: false,
    })
    .option('permission', {
      alias: 'perm',
      choices: ['manual', 'yolo', 'auto'] as const,
      description: 'Permission mode: manual, yolo, auto',
    })
    .help('h')
    .alias('h', 'help')
    .version(false) // Handle version manually in cli.tsx for fast exit
    .parseSync();

  const initialPrompt = parsed._.length > 0 ? parsed._.join(' ') : undefined;

  return {
    modelOverride: parsed.model,
    initialPrompt,
    sessionName: parsed.session,
    resumeRecent: parsed.resume,
    headless: parsed.headless,
    permissionMode: parsed.permission as PermissionMode | undefined,
  };
}

export function printHelp(): void {
  // yargs can handle help, but if we need the exact previous output format, we keep this,
  // or we can let yargs generate it. For backward compatibility with cli.tsx's `printHelp()`,
  // we'll keep the exact output.
  console.log('Mini Code - A minimal coding agent with TUI\n');
  console.log('Usage: minicode [options] [prompt]\n');
  console.log('Options:');
  console.log('  --model, -m <spec>    Model specification (e.g., glm-4.7@zhipu)');
  console.log('  --session, -s <name>  Session name (creates new or resumes existing)');
  console.log('  --resume, -r          Resume most recent session');
  console.log('  --headless, -H        Run without TUI, output to stdout (requires prompt)');
  console.log('  --permission <mode>   Permission mode: manual, yolo, auto (default: manual)');
  console.log('  --version, -v         Show version');
  console.log('  --help, -h            Show this help');
  console.log('\nExamples:');
  console.log('  minicode                             # Start TUI');
  console.log('  minicode "list files"                # Start TUI and auto-run prompt');
  console.log('  minicode -s my-session               # Use specific session');
  console.log('  minicode -H --perm yolo "ls"         # Headless, no permission checks');
  console.log('\nIn TUI mode:');
  console.log('  /compress       # Compress conversation history');
  console.log('  /new <name>     # Create new session');
  console.log('  /resume         # List and resume sessions');
  console.log('  /rename <name>  # Rename current session');
  console.log('  /exit           # Quit (or Ctrl+C)');
  console.log('  Shift+Tab       # Cycle permission mode (manual/yolo/auto)');
  console.log('  Ctrl+O          # Switch active agent');
}
