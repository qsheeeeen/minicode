# minicode

A minimal coding agent powered by Claude. Simple, opinionated, hackable.

## Features

- REPL-style CLI interface
- Tool use (read, write, edit, bash)
- In-memory conversation history
- Customizable via config.json

## Setup

1. Copy `config.example.json` to `config.json`:
   ```bash
   cp config.example.json config.json
   ```

2. Edit `config.json` and add your Anthropic API key:
   ```json
   {
     "anthropicApiKey": "sk-ant-...",
     "baseURL": "https://api.anthropic.com",
     "model": "claude-sonnet-4-5"
   }
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

## Usage

```bash
# Development mode
npm run dev

# Build
npm run build

# Run built version
npm run start
```

Type your request at the `>` prompt. Type `exit` to quit.

## Architecture

```
src/
├── cli/index.ts      # REPL entry point
├── agent/loop.ts     # Main agent loop with tool orchestration
├── llm/anthropic.ts  # Anthropic API wrapper
├── config.ts         # Config loader
└── tools/            # Tool implementations
    ├── read.ts
    ├── write.ts
    ├── edit.ts
    └── bash.ts
```

See [TODO.md](TODO.md) for planned features.
