# User Scripts

A collection of browser userscripts for enhancing web browsing experience. This repository allows easy reuse of userscripts across multiple browser instances and devices.

## What are Userscripts?

Userscripts are small JavaScript programs that modify web pages to add features, fix issues, or customize behavior. They run in your browser using a userscript manager extension.

## Installation

### Step 1: Install a Userscript Manager

Choose one of the following userscript managers for your browser:

- **Tampermonkey** - [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojnmkdajkgjejbfnm) | [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/) | [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd) | [Safari](https://apps.apple.com/us/app/tampermonkey/id1482490089)
- **Violentmonkey** - [Chrome](https://chrome.google.com/webstore/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag) | [Firefox](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/) | [Edge](https://microsoftedge.microsoft.com/addons/detail/violentmonkey/eeagobfjdenkkddmbclomhiblgggliao)
- **Greasemonkey** - [Firefox](https://addons.mozilla.org/en-US/firefox/addon/greasemonkey/)

### Step 2: Install Userscripts

1. Browse the `scripts/` directory
2. Click on a `.user.js` file
3. Click the "Raw" button on GitHub
4. Your userscript manager should prompt you to install it
5. Confirm the installation

Alternatively, you can copy the script content and create a new script in your userscript manager.

## Repository Structure

```
user-scripts/
├── scripts/          # Active userscripts
│   └── hooks/        # Git hooks for automation
├── templates/        # Templates for creating new userscripts
└── README.md         # This file
```

## Git Hooks & Automation

This repository includes git hooks for automatic versioning and backup of userscripts.

### Setup

Run the setup script from the repository root:

**Linux/Mac:**

```bash
bash scripts/hooks/setup.sh
```

**Windows:**

```cmd
scripts\hooks\setup.bat
```

The setup will:

1. Install pre-commit and post-commit hooks
2. Ask if you want automatic backups after commits
3. Prompt for a backup location (if enabled)

### Features

**Pre-commit Hook:**

- Automatically increments the PATCH version (e.g., 1.0.0 → 1.0.1) in all modified `.user.js` files

**Post-commit Hook:**

- Backs up all modified `.user.js` files to your configured location

### Manual Backup

You can manually backup all scripts anytime:

**Linux/Mac:**

```bash
bash scripts/hooks/manual-backup.sh
```

**Windows:**

```cmd
scripts\hooks\manual-backup.bat
```

### Updating Hooks

When hooks are updated in the repository, run:

**Linux/Mac:**

```bash
bash scripts/hooks/setup.sh -u
```

**Windows:**

```cmd
scripts\hooks\setup.bat /u
```

This updates the hooks without changing your backup configuration.

## Creating Your Own Userscript

1. Use the template in `templates/userscript-template.user.js`
2. Modify the metadata block with your script details:
   - `@name` - The name of your script
   - `@description` - What your script does
   - `@match` - URLs where the script should run
   - `@version` - Version number
3. Write your JavaScript code
4. Save with `.user.js` extension
5. Install in your userscript manager for testing

## Adding Scripts to This Repository

1. Place your userscript in the `scripts/` directory
2. Ensure the filename ends with `.user.js`
3. Include proper metadata in the script header
4. Commit and push your changes

## Usage Tips

- Keep scripts updated by pulling the latest changes from this repository
- Test scripts in a safe environment before deploying
- Back up your scripts by committing them to this repository
- Use meaningful names for your scripts

## Syncing Across Browsers

To use these scripts across multiple browser instances:

1. Clone this repository on each machine
2. Install the userscript manager on each browser
3. Install the scripts from your local repository copy
4. Pull updates regularly to get the latest versions

## Resources

- [Greasy Fork](https://greasyfork.org/) - Userscript repository
- [OpenUserJS](https://openuserjs.org/) - Another userscript repository
- [Tampermonkey Documentation](https://www.tampermonkey.net/documentation.php)
- [Greasemonkey Manual](https://wiki.greasespot.net/Greasemonkey_Manual)

## License

Scripts in this repository are for personal use. Check individual script headers for specific license information.
