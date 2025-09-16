# Contributing to zodvex

First off, thank you for considering contributing to zodvex! It's people like you that make zodvex such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples to demonstrate the steps**
- **Describe the behavior you observed and expected**
- **Include code samples and error messages**
- **Note your Node.js, Zod, and Convex versions**

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

- **Use a clear and descriptive title**
- **Provide a detailed description of the suggested enhancement**
- **Provide specific examples to demonstrate the feature**
- **Describe the current behavior and expected behavior**
- **Explain why this enhancement would be useful**

### Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes (`pnpm test`)
5. Make sure your code follows the existing style (`pnpm lint`)
6. Issue that pull request!

## Development Setup

1. Fork and clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Run tests:
   ```bash
   pnpm test
   ```
4. Build the package:
   ```bash
   pnpm build
   ```

## Project Structure

```
zodvex/
├── src/          # Source code
│   ├── mapping.ts    # Core Zod to Convex mapping logic
│   ├── codec.ts      # Encoding/decoding functionality
│   ├── wrappers.ts   # Function wrapper implementations
│   ├── tables.ts     # Table and CRUD helpers
│   ├── types.ts      # TypeScript type definitions
│   └── utils.ts      # Utility functions
├── __tests__/    # Test files
├── dist/         # Built output (generated)
└── docs/         # Documentation
```

## Testing

We use Vitest for testing. Tests should:

- Cover both happy paths and edge cases
- Be isolated and not depend on external services
- Follow the existing test patterns
- Include type-level tests where applicable

Run tests with:
```bash
pnpm test           # Run tests
pnpm test:coverage  # Run with coverage
```

## Coding Style

- Use TypeScript for all code
- Follow existing patterns in the codebase
- Keep functions small and focused
- Document complex logic with comments
- Export types alongside implementations
- Prefer explicit over implicit

## Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests liberally after the first line

Examples:
- `fix: handle nullable fields in nested objects`
- `feat: add support for Zod transforms`
- `docs: update README with new examples`
- `test: add coverage for edge cases`

## Release Process

Releases are automated via GitHub Actions when a new tag is pushed:

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Commit changes: `git commit -am "chore: release v0.x.x"`
4. Tag the release: `git tag v0.x.x`
5. Push: `git push && git push --tags`

## Questions?

Feel free to open an issue with your question or reach out to the maintainers.

Thank you for contributing!