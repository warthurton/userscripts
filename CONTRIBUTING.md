# Contributing to User Scripts

Thank you for your interest in contributing! This guide will help you add new userscripts to this repository.

## Adding a New Userscript

1. **Create Your Script**
   - Start with the template in `templates/userscript-template.user.js`
   - Write your script following JavaScript best practices
   - Test thoroughly on target websites

2. **Script Requirements**
   - Must include complete metadata header
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
   // @grant        none
   // ==/UserScript==
   ```

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
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    // Configuration
    const CONFIG = {
        enabled: true,
        color: '#ff0000'
    };
    
    // Main functionality
    function init() {
        // Your code here
    }
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
```

## Questions?

If you have questions about contributing, please open an issue for discussion.
