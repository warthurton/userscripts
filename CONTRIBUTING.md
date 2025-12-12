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
  - Must increment `@version` whenever a script is updated (any change)
   - Must use `.user.js` extension
   - Must be well-commented
   - Should handle errors gracefully

3. **Metadata Requirements**
   ```javascript
   // ==UserScript==
   // @name         Descriptive Name
   // @namespace    http://tampermonkey.net/
   // @version      1.0
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
- If you place scripts under `scripts/...`, keep the full path in the URL, e.g. `scripts/chatgpt/auto-disable-connector.user.js`.
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

### Versioning

- Always bump the `@version` field in the userscript header when making changes (bug fixes, features, or metadata updates). This helps userscript managers detect updates reliably.
- Use semantic versioning where practical (`major.minor.patch`). Examples:
  - Metadata-only change: `1.0.1`
  - Small feature or improvement: `1.1.0`
  - Breaking changes: `2.0.0`
- After merging, consider tagging a GitHub release for visibility. 

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

## Example Script Structure

```javascript
// ==UserScript==
// @name         Example Script
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Does something useful
// @author       Your Name
// @match        https://example.com/*
// @icon         https://favicons-blue.vercel.app/?domain=example.com
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // Configuration
  const CONFIG = {
    enabled: true,
    color: "#ff0000",
  };

  // Main functionality
  function init() {
    // Your code here
  }

  // Wait for DOM to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
```

## Questions?

If you have questions about contributing, please open an issue for discussion.
