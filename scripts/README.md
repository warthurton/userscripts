# Scripts Directory

This directory contains active userscripts ready for installation.

## Installation

To install any script from this directory:

1. Click on the `.user.js` file you want to install
2. Click the "Raw" button on GitHub
3. Your userscript manager will prompt you to install
4. Click "Install" or "Confirm"

## Organization

You can organize scripts into subdirectories by category:

## Organization

You can organize scripts into subdirectories by category:

- `general/` - Scripts that apply to multiple sites
- `productivity/` - Scripts that enhance productivity
- `social/` - Scripts for social media sites
- `utilities/` - General utility scripts
- `fixes/` - Scripts that fix website issues

## Adding New Scripts

When adding a new script:

1. Use a descriptive filename (e.g., `github-enhanced-notifications.user.js`)
2. Include complete metadata in the header
3. Add a brief comment at the top describing what the script does
4. Test the script before committing

## General Scripts

- Auto Close Page (Countdown)
	- Automatically closes pages after a configurable countdown.
	- Settings:
		- CloseAfter30Seconds: domains closed after 30s
		- CloseAfter120Seconds: domains closed after 120s
		- Others close after 5s
	- How to configure:
		- Open the userscript menu and choose "Auto Close: Settings".
		- Enter domains one per line or comma-separated. Matching is by hostname equality or subdomain suffix.
	- Behavior:
		- Runs after the page loads and delays ~1s to allow external URL handlers to complete.
		- Shows a banner with the countdown and Cancel/Settings buttons.
		- Press Escape or click Cancel to abort closing.

## Naming Convention

Use lowercase with hyphens for filenames:
- ✅ `youtube-ad-blocker.user.js`
- ✅ `reddit-dark-mode.user.js`
- ❌ `YouTubeAdBlocker.user.js`
- ❌ `reddit_dark_mode.user.js`
