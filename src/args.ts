import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

export type PermissionMode = 'manual' | 'yolo' | 'auto';

export interface CliArgs {
  modelOverride?: string;
  initialPrompt?: string;
  sessionName?: string;
  resumeRecent: boolean;
  headless?: boolean;
  permissionMode?: PermissionMode;
}

export function parseArgs(argv: string[]): CliArgs {
  const parsed = yargs(hideBin(argv))
    .usage('Mini Code - A minimal coding agent with TUI\n\nUsage: minicode [options] [prompt]')
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
    })
    .option('permission', {
      alias: 'perm',
      choices: ['manual', 'yolo', 'auto'] as const,
      description: 'Permission mode: manual, yolo, auto',
    })
    .help('h')
    .alias('h', 'help')
    .version(false) // Handle version manually in cli.tsx for fast exit
    .example('minicode', 'Start TUI')
    .example('minicode "list files"', 'Start TUI and auto-run prompt')
    .example('minicode -s my-session', 'Use specific session')
    .example('minicode -H --perm yolo "ls"', 'Headless, no permission checks')
    .epilog('In TUI mode:\n  /compress       # Compress conversation history\n  /new <name>     # Create new session\n  /resume         # List and resume sessions\n  /rename <name>  # Rename current session\n  /exit           # Quit (or Ctrl+C)\n  Shift+Tab       # Cycle permission mode (manual/yolo/auto)\n  Ctrl+O          # Switch active agent')
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
