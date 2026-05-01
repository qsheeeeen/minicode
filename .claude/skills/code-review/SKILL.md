---
name: code-review
description: Code review for TypeScript/React projects with testing focus
---

# Code Review Skill

Performs thorough code reviews for this TypeScript project with Ink/React TUI components.

## Review Focus Areas

### 1. TypeScript & Type Safety
- Check for proper type annotations (avoid `any`, prefer explicit types)
- Verify generic constraints are correct
- Ensure null/undefined handling is explicit
- Look for type widening issues

### 2. React/Ink Patterns
- Components use `React.FC` or explicit prop types
- No missing/extra React dependencies in hooks
- Effect cleanup functions present when needed
- TUI components properly handle focus and input

### 3. Error Handling
- Async operations have try/catch or proper error boundaries
- Tool failures handled gracefully (use `Promise.allSettled` when parallelizing)
- User-facing errors provide actionable messages

### 4. Testing Quality
- Critical paths have test coverage
- Unit tests are isolated (no external dependencies)
- Edge cases covered (empty inputs, errors, boundaries)
- Test descriptions are descriptive

### 5. Code Organization
- Single responsibility (files < 200 lines ideally)
- Named exports preferred over default exports
- Consistent naming conventions
- No dead code or unused imports

## Review Output Format

```
## [File Path]

### Issues
- **[severity]** Description of issue with specific line/context
  - Suggestion: How to fix

### Suggestions
- Optional improvements that aren't bugs

### Praise
- What's done well
```

## Severity Levels
- **Critical**: Bugs, security issues, breaking changes
- **Major**: Logic errors, missing error handling
- **Minor**: Style, minor improvements
- **Suggestion**: Optional enhancements

## Usage

When user asks to review code or run `code-review` command:
1. Identify the scope (specific files, recent changes, full codebase)
2. Read and analyze each file
3. Check for common issues in the focus areas above
4. Provide structured feedback with specific line references
5. Offer concrete fix suggestions when possible
