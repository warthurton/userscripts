# Contributing to User Scripts

Thank you for your interest in contributing! This guide will help you add new userscripts to this repository.

## Adding a New Userscript

1. **Create Your Script**

   - Start with the template in `templates/userscript-template.user.js`
   - Write your script following JavaScript best practices
   - Test thoroughly on target websites

2. **Script Requirements**

   - Must include complete metadata header
   - Must include autoupdate URLs (`@updateURL` and `@downloadURL`)
   - Must use semantic versioning (see below)
   - Must use `.user.js` extension
   - Must be well-commented
   - Should handle errors gracefully

3. **Semantic Versioning**

   All scripts must follow [semantic versioning](https://semver.org/) (MAJOR.MINOR.PATCH):

   - **MAJOR** (first number): Breaking changes or major rewrites
   - **MINOR** (second number): New features added (backward compatible)
   - **PATCH** (third number): Bug fixes and minor improvements

   **When updating scripts:**

   - The PATCH version is automatically incremented by a pre-commit hook
   - Increment MINOR version manually (e.g., 1.0.1 → 1.1.0) when adding new features
   - Increment MAJOR version manually (e.g., 1.1.0 → 2.0.0) for breaking changes
   - Reset lower numbers to zero when incrementing higher ones (e.g., 1.2.3 → 2.0.0)

4. **Metadata Requirements**
   ```javascript
   // ==UserScript==
   // @name         Descriptive Name
   // @namespace    http://tampermonkey.net/
   // @version      1.0.0
   // @description  Clear description of what the script does
   // @author       Your Name
   // @match        https://example.com/*
   // @icon         https://favicons-blue.vercel.app/?domain=example.com
   // @updateURL    https://raw.githubusercontent.com/<github-username>/userscripts/main/<path-to-script>.user.js
   // @downloadURL  https://raw.githubusercontent.com/<github-username>/userscripts/main/<path-to-script>.user.js
   // @grant        none
   // ==/UserScript==
   ```

### Autoupdate URLs

- Purpose: Ensure users’ script managers (Tampermonkey/Greasemonkey/Violentmonkey) can automatically detect and install updates.
- Required fields: `@updateURL` and `@downloadURL` must always be present in every new script.
- URL format:
  - Base: `https://raw.githubusercontent.com/warthurton/userscripts/main/`
  - Path: match the script’s location in this repo.
  - Example for a script stored at `chatgpt/auto-disable-connector.user.js`:
    - `@updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/chatgpt/auto-disable-connector.user.js`
    - `@downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/chatgpt/auto-disable-connector.user.js`
- Scripts are organized in category directories (autotask/, chatgpt/, general/) at the repository root.
- Keep the full path in the URL, e.g. `chatgpt/auto-disable-connector.user.js`.
- Do not omit or comment out these lines; they must be included upon script creation.

### Favicons / Icons

- Purpose: Display an icon for the userscript in the script manager, making it easier to identify scripts at a glance.
- **Recommended service**: Use `https://favicons-blue.vercel.app/?domain=<domain>` to get favicons.
- Format: `@icon https://favicons-blue.vercel.app/?domain=example.com`
- Examples:
  - For GitHub scripts: `@icon https://favicons-blue.vercel.app/?domain=github.com`
  - For ChatGPT scripts: `@icon https://favicons-blue.vercel.app/?domain=chatgpt.com`
  - For YouTube scripts: `@icon https://favicons-blue.vercel.app/?domain=youtube.com`
- Extract the domain from the `@match` URL pattern to determine the appropriate domain for the favicon.
- The `@icon` field should always be included in new userscripts.

### Version Automation with Git Hooks

This repository includes git hooks that automatically manage versioning and build output:

- **Pre-commit hook** (`.github/scripts/hooks/pre-commit`): Automatically increments the PATCH version in all modified `.user.js` files
- **Post-commit hook** (`.github/scripts/hooks/post-commit`): Copies all modified `.user.js` files to `build/` directory

**Setup:** Run the setup script from the repository root:

```bash
bash .github/scripts/hooks/setup.sh
```

On Windows:

```cmd
.github\scripts\hooks\setup.bat
```

After setup, hooks will run automatically before and after each commit.

4. **File Naming**

   - Use lowercase with hyphens
   - Be descriptive but concise
   - Example: `github-notification-enhancer.user.js`

5. **Documentation**
   - Add a comment block at the top explaining the script's purpose
   - Document any configuration options
   - Note any known limitations or issues

## Script Guidelines

### Code Style

- Use strict mode: `'use strict';`
- Use meaningful variable names
- Add comments for complex logic
- Keep functions small and focused

### Best Practices

- Wrap code in IIFE to avoid global namespace pollution
- Check for element existence before manipulating DOM
- Use event delegation when possible
- Minimize @grant permissions (use `none` if possible)

### Testing

- Test on multiple pages that match your @match pattern
- Verify script doesn't interfere with site functionality
- Check browser console for errors
- Test in different browsers if possible

## Script Template

Use the template in [templates/userscript-template.user.js](templates/userscript-template.user.js) as a starting point for new scripts. It includes:

- Proper metadata header with all required fields
- IIFE wrapper to avoid global namespace pollution
- Example structure with configuration and initialization
- Placeholder comments for updateURL and downloadURL

## Questions?

If you have questions about contributing, please open an issue for discussion.
