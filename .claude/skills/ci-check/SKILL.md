---
name: ci-check
description: Run all CI quality checks (TypeScript types, Biome linting, Knip). Use when asked to check code quality, run quality checks, verify types, or ensure CI will pass.
---

# CI Quality Checks

Run all quality checks that run in CI: TypeScript type checking, Biome formatting/linting, and Knip dead code detection.

## Running All Checks

```bash
pnpm run ci:check
```

This runs all three checks in parallel:
- `check-types`: TypeScript type checking
- `format-and-lint`: Biome formatting and linting
- `knip`: Dead code and unused dependency detection

## Running Individual Checks

```bash
# Just TypeScript types
pnpm run check-types

# Just Biome formatting/linting
pnpm run format-and-lint

# Just Knip dead code detection
pnpm run knip
```

## Common Issues

### Biome Errors

Fix automatically with:
```bash
pnpm run format
```

For unsafe fixes (be careful):
```bash
pnpm run format:unsafe
```

### Knip Errors

Knip reports unused exports, dependencies, or files. Review output and:
1. Remove truly unused code
2. Add legitimate exceptions to `knip.json`
3. Check for false positives (dynamic imports, etc.)

### TypeScript Errors

Fix type errors in the code. No auto-fix available.

## Notes

- All three checks must pass for CI to succeed
- Run this before committing or creating a PR
- Uses `--parallel` for faster execution
- `format-and-lint` uses `--error-on-warnings` to match CI strictness
