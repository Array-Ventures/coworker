# Contributing to Coworker

Thank you for your interest in contributing to Coworker!

## Prerequisites

- [Bun](https://bun.sh) (latest)
- Node.js 22+

## Setup

```bash
# Install dependencies and start the server
bun install
bun run dev
```

For the desktop app:

```bash
cd app
bun install
bun run dev
```

## Project Structure

See [README.md](./README.md) for a full overview of the project structure and architecture.

## Submitting a Pull Request

1. Fork the repository
2. Create a branch: `git checkout -b my-feature`
3. Make your changes
4. Push to your fork and open a PR against `master`

## Code Style

- TypeScript throughout
- Match existing patterns in the codebase — don't introduce new abstractions for one-off changes
- No extra comments, docstrings, or type annotations on code you didn't change
- Keep it simple: minimum complexity for the task at hand

## Reporting Bugs

Use the issue templates provided in this repository. Include reproduction steps, environment details, and expected vs. actual behavior.
