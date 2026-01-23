# Development Guide

This guide covers the development workflow, git hooks, and automation for contributing to this repository.

## Git Hooks & Automation

This repository includes git hooks for automatic versioning and copying userscripts to build/.

### Setup

Run the setup script from the repository root:

```bash
bash .github/scripts/hooks/setup.sh
```

The setup will:

1. Install pre-commit and post-commit hooks
2. Ask if you want automatic copy to build/ after commits

### Features

**Pre-commit Hook:**

- Automatically increments the PATCH version (e.g., 1.0.0 → 1.0.1) in all modified `.user.js` files

**Post-commit Hook:**

- Copies all modified `.user.js` files to your configured build/ directory (enabled by default)

### Manual Copy to Build

You can manually copy all scripts to build/ anytime:

```bash
bash .github/scripts/hooks/copy-to-dist.sh
```

### Updating Hooks

When hooks are updated in the repository, run:

```bash
bash .github/scripts/hooks/setup.sh -r
```

This updates the hooks without changing your copy to build/ configuration.

## Workflow

### Adding or Modifying Scripts

1. Make your changes to userscripts in the appropriate category directory
2. Commit your changes - the pre-commit hook will automatically bump PATCH versions
3. The post-commit hook will copy scripts to build/ (if enabled)
4. Push your changes to create a pull request

### Version Management

- **PATCH versions** are automatically incremented by the pre-commit hook
- **MINOR versions** should be manually updated when adding new features
- **MAJOR versions** should be manually updated for breaking changes

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed versioning guidelines.

## Testing

Before committing:

1. Test your userscript in your browser with a userscript manager installed
2. Verify it works on the target websites specified in `@match`
3. Check the browser console for any errors
4. Ensure metadata is complete and accurate

## Repository Structure

```
userscripts/
├── autotask/         # Autotask-related userscripts
├── chatgpt/          # ChatGPT-related userscripts
├── general/          # General-purpose userscripts
├── .github/
│   ├── scripts/
│   │   ├── hooks/    # Git hooks for automation
│   │   └── bump-versions.js  # Version bump script for CI
│   └── workflows/    # GitHub Actions workflows
├── templates/        # Templates for creating new userscripts
├── build/            # Build output (gitignored)
├── CONTRIBUTING.md   # Contribution guidelines
├── DEVELOPMENT.md    # This file
└── README.md         # User-facing documentation
```

## GitHub Actions

The repository includes GitHub Actions workflows:

- **version-bump.yml**: Automatically bumps versions in pull requests when scripts are modified

These run automatically and don't require manual intervention.

## Questions?

For contribution guidelines and detailed requirements, see [CONTRIBUTING.md](CONTRIBUTING.md).
