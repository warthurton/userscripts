# Contributing to User Scripts

Thank you for your interest in contributing! This guide will help you add new userscripts to this repository.

## Adding a New Userscript

1. **Create Your Script**
   - Start with the template in `templates/userscript-template.user.js`
   - Write your script following JavaScript best practices
   - Test thoroughly on target websites

2. **Script Requirements**
   - Must include complete metadata header
   - Must include autoupdate URLs (`@updateURL` and `@downloadURL`) pointing to `_dist/`
   - Must use `.user.js` extension
   - Must be well-commented
   - Should handle errors gracefully

3. **Versioning**

   Versions are managed **automatically** by [semantic-release](https://github.com/semantic-release/semantic-release).
   - **Do not** manually change `@version` in source scripts for release purposes
   - Version is determined from git tags (the last published release), not file contents
   - All scripts share a single repo-level version
   - Use [Conventional Commits](https://www.conventionalcommits.org/) to drive version bumps:
     - `fix:` → patch bump (e.g. 3.0.0 → 3.0.1)
     - `feat:` → minor bump (e.g. 3.0.1 → 3.1.0)
     - `feat!:` or `BREAKING CHANGE:` → major bump
     - `chore:`, `docs:`, `refactor:`, `style:`, `test:`, `ci:` → no release

4. **Metadata Requirements**
   ```javascript
   // ==UserScript==
   // @name         Descriptive Name
   // @namespace    https://github.com/warthurton/userscripts
   // @version      1.0
   // @description  Clear description of what the script does
   // @author       warthurton
   // @match        https://example.com/*
   // @icon         https://favicons-blue.vercel.app/?domain=example.com
   // @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/<name>.meta.js
   // @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/<name>.user.js
   // @grant        none
   // ==/UserScript==
   ```

### Autoupdate URLs

- Purpose: Ensure script managers (Violentmonkey/FireMonkey/Tampermonkey) can automatically detect and install updates.
- Required fields: `@updateURL` and `@downloadURL` must always be present.
- URL format:
  - `@updateURL` → `https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/<name>.meta.js`
  - `@downloadURL` → `https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/<name>.user.js`
  - `<name>` is the script filename without `.user.js` (e.g. `auto-close` for `auto-close.user.js`)
- The build script rewrites these URLs in `_dist/`, so they just need to be present in source files.
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
