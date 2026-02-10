---
name: format-fix
description: Automatically fix formatting and linting issues with Biome. Use when asked to format code, fix linting errors, or organize imports.
---

# Format and Fix Code

Automatically fix formatting and linting issues using Biome.

## Fix Safe Issues

```bash
pnpm run format
```

This fixes:
- Formatting (indentation, spacing, quotes)
- Import organization (sorts and removes unused)
- Safe linting issues (obvious fixes)
- Runs on all files tracked by Git

## Fix Unsafe Issues (Use with Caution)

```bash
pnpm run format:unsafe
```

This applies potentially unsafe transformations:
- Code simplifications
- Refactorings that might change behavior
- More aggressive fixes

**Warning**: Review changes carefully after unsafe fixes.

## Check Without Fixing

```bash
# Check for issues (CI mode)
pnpm run format-and-lint

# Same as above (alias)
pnpm run ci:check:lint
```

## What Gets Fixed

**Formatting**:
- Indentation (2 spaces)
- Quote style (double quotes)
- Semicolons, commas, brackets
- Line endings

**Linting**:
- Unused variables
- Missing return types
- Incorrect imports
- Code complexity issues
- Potential bugs

**Import Organization**:
- Sorts imports (external, then internal)
- Removes unused imports
- Groups related imports

## Biome Configuration

Project uses `biome.json`:
- Recommended lint rules enabled
- VCS integration (respects .gitignore)
- Formatter: 2-space indent, double quotes
- Assist: organize imports on save

## Common Workflow

1. Make code changes
2. Run `pnpm run format` to auto-fix
3. Review changes with `git diff`
4. Commit if satisfied

## VS Code Integration

Add to `.vscode/settings.json` for format-on-save:

```json
{
  "[typescript]": {
    "editor.defaultFormatter": "biomejs.biome",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.organizeImports": "explicit"
    }
  }
}
```

## CI Requirements

CI runs:
```bash
pnpm run format-and-lint
```

This checks formatting/linting without fixing. Use `--error-on-warnings` to match CI strictness.

## Tips

- Run `format` before committing
- Use unsafe fixes only when you understand the changes
- Biome is much faster than ESLint + Prettier
- Respects Git ignore patterns
- Format-on-save in IDE is recommended for best experience
