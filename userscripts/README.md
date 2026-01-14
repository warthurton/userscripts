# Userscripts Directory

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
	- Default: 120s if the domain has no explicit setting.
	- Settings sources:
		- In-banner selector: choose 5/30/120 and click Save to assign the current domain (stored via script storage if supported).
		- Settings modal: manage domain lists for 5s, 30s, and 120s.
			- CloseAfter5Seconds
			- CloseAfter30Seconds
			- CloseAfter120Seconds
	- Matching: by hostname equality or subdomain suffix.
	- Behavior:
		- Runs after the page loads and delays ~1s to allow external URL handlers to complete.
		- Shows a banner with a clickable time (cancels), duration selector, Save, and Settings buttons.
		- Press Escape or click the time button to cancel closing.

## Naming Convention

Use lowercase with hyphens for filenames:
- ✅ `youtube-ad-blocker.user.js`
- ✅ `reddit-dark-mode.user.js`
- ❌ `YouTubeAdBlocker.user.js`
- ❌ `reddit_dark_mode.user.js`
