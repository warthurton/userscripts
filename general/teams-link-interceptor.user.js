// ==UserScript==
// @name         Teams Link Interceptor
// @namespace    https://github.com/warthurton/userscripts
// @version      1.1
// @description  Intercepts link clicks in Microsoft Teams to log URLs before they open in Edge sidebar
// @match        https://teams.microsoft.com/*
// @match        https://*.teams.microsoft.com/*
// @icon         https://favicons-blue.vercel.app/?domain=teams.microsoft.com
// @run-at       document-start
//
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/general/teams-link-interceptor.user.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/general/teams-link-interceptor.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
//
// @grant        none
// @author       kept-treat-flirt@duck.com
// ==/UserScript==

(function () {
    'use strict';

    console.log('Teams Link Interceptor loaded');

    // Function to log and optionally modify link behavior
    function interceptLink(event) {
        const target = event.target.closest('a');
        if (!target) return;

        const url = target.href;

        // Check if this is a static.teams.cdn.office.net link
        let isStaticTeamsCdn = false;
        if (url) {
            try {
                const parsed = new URL(url, window.location.href);
                const host = parsed.hostname;
                const allowedHosts = ['static.teams.cdn.office.net'];
                if (allowedHosts.includes(host)) {
                    isStaticTeamsCdn = true;
                }
            } catch (e) {
                // If the URL cannot be parsed, do not treat it as a static Teams CDN link
            }
        }

        if (isStaticTeamsCdn) {
            // STOP EVERYTHING IMMEDIATELY
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            const targetAttr = target.getAttribute('target');

            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('🔗 Teams Link INTERCEPTED (static.teams.cdn.office.net):');
            console.log('URL:', url);
            console.log('Target:', targetAttr || 'none');
            console.log('Text:', target.textContent.trim());
            console.log('Classes:', target.className);

            // Log any data attributes that might be relevant
            const dataAttrs = Array.from(target.attributes)
                .filter(attr => attr.name.startsWith('data-'))
                .reduce((acc, attr) => {
                    acc[attr.name] = attr.value;
                    return acc;
                }, {});

            if (Object.keys(dataAttrs).length > 0) {
                console.log('Data attributes:', dataAttrs);
            }

            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

            // Don't navigate - keep the log visible
            alert('Link intercepted! Check console for URL details.\n\nURL: ' + url);
            return false;
        }

        const targetAttr = target.getAttribute('target');

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔗 Teams Link Clicked:');
        console.log('URL:', url);
        console.log('Target:', targetAttr || 'none');
        console.log('Text:', target.textContent.trim());
        console.log('Classes:', target.className);

        // Log any data attributes that might be relevant
        const dataAttrs = Array.from(target.attributes)
            .filter(attr => attr.name.startsWith('data-'))
            .reduce((acc, attr) => {
                acc[attr.name] = attr.value;
                return acc;
            }, {});

        if (Object.keys(dataAttrs).length > 0) {
            console.log('Data attributes:', dataAttrs);
        }

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    // Add click listener to document with capture phase to catch early
    document.addEventListener('click', interceptLink, true);

    // Also intercept any dynamic content added later
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && node.tagName === 'A') {
                    // New link added directly
                    console.log('New link detected:', node.href);
                } else if (node.nodeType === 1 && node.querySelectorAll) {
                    // Check for links within added content
                    const links = node.querySelectorAll('a');
                    if (links.length > 0) {
                        console.log(`${links.length} new link(s) detected in added content`);
                    }
                }
            });
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    console.log('Teams Link Interceptor active - all link clicks will be logged to console');
})();
