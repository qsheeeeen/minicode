# Plan: Add Command Line Arguments

## Context
User wants to add CLI argument support to Mini Code for:
1. **Model config override**: Allow specifying model/provider via command line instead of just `MODEL` env var
2. **Info commands**: Add `--version` and `--help` flags

## Current State
- Entry point: `src/cli/index.ts` - currently reads config from `config.json` and `MODEL` env var
- No argument parsing library in dependencies
- Version is hardcoded as "v1.0.0" in banner

## Implementation Plan

### 1. Add CLI Argument Parsing
**File**: `src/cli/index.ts`

Parse `process.argv` for flags:
- `--model <spec>` - Override model in format `model@provider` (e.g., `glm-4.7@zhipu`)
- `--version` / `-v` - Show version and exit
- `--help` / `-h` - Show usage and exit

Priority: CLI args > MODEL env var > config.json

### 2. Dynamic Version from package.json
**File**: `src/cli/index.ts`

Read version from `package.json` instead of hardcoding:
```typescript
const packageJson = JSON.parse(await fs.readFile('package.json', 'utf-8'));
const VERSION = packageJson.version;
```

### 3. Help Output
Display usage information:
```
Mini Code - A minimal coding agent

Usage:
  minicode [options]

Options:
  --model <spec>   Model specification (e.g., glm-4.7@zhipu)
  --version, -v    Show version
  --help, -h       Show this help
```

## Critical Files
- `src/cli/index.ts` - Add argument parsing logic
- `package.json` - Read version dynamically

## Verification
```bash
# Test version
npm run start -- --version

# Test help
npm run start -- --help

# Test model override
npm run start -- --model glm-4.7@zhipu

# Normal run should still work
npm run start
```
