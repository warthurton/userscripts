// ==UserScript==
// @name         Itiliti Content Downloader
// @namespace    https://github.com/warthurton/userscripts
// @version      1.0
// @description  Auto-download content data from Itiliti admin portal
// @match        https://portal.itiliti.io/app/admin/content/*
// @icon         https://favicons-blue.vercel.app/?domain=itiliti.io
// @run-at       document-start
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
//
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/general/itiliti-content-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/general/itiliti-content-downloader.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
//
// @grant        none
// @author       warthurton
// ==/UserScript==

(function () {
    'use strict';

    let currentContentId = null;
    const API_ENDPOINTS = [
        {
            key: 'templates',
            pattern: '/api/content/templates?',
            filename: 'templates.json'
        },
        {
            key: 'content',
            pattern: '/api/content/content?',
            filename: 'content.json'
        },
        {
            key: 'assessments',
            pattern: '/api/content/assessments/options?',
            filename: 'assessments-options.json'
        }
    ];

    // Store intercepted data
    const interceptedData = {};
    let debugMode = true;
    let downloadButton = null;
    let statusDisplay = null;

    /**
     * Extract content ID from current URL
     */
    function getContentIdFromURL() {
        const match = window.location.pathname.match(/\/content\/(\d+)$/);
        return match ? match[1] : null;
    }

    /**
     * Extract content title from page using XPath
     */
    function getContentTitle() {
        try {
            const xpath = '/html/body/app/div/div[2]/div[2]/div/az-compliance/az-content/div/page-header/div/div/div[1]/div[1]/div';
            const element = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;

            if (element && element.textContent) {
                return element.textContent.trim();
            }
        } catch (e) {
            console.warn('[Itiliti Content Downloader] Could not extract content title:', e);
        }
        return null;
    }

    /**
     * Create and download a zip file with all collected data
     */
    async function createAndDownloadZip() {
        const zip = new JSZip();
        let count = 0;
        const contentId = currentContentId || 'unknown';
        const title = getContentTitle();

        // Add intercepted API data to zip
        for (const key in interceptedData) {
            const item = interceptedData[key];
            zip.file(item.filename, JSON.stringify(item.data, null, 2));
            count++;
        }

        // Add title information if available
        if (title) {
            zip.file('content-title.txt', title);
            count++;
        }

        if (count > 0) {
            // Generate and download the zip file
            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `itiliti-content-${contentId}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            console.log(`[Itiliti Content Downloader] Downloaded zip with ${count} file(s)`);
            showToast(`Downloaded ${count} file(s) as zip`);
            return count;
        } else {
            showToast('No data available yet. Please wait for API calls to complete.', 4000);
            return 0;
        }
    }

    /**
     * Show toast message in UI
     */
    function showToast(message, duration = 3000) {
        const toast = document.getElementById('itiliti-toast');
        if (toast) {
            toast.textContent = message;
            toast.style.opacity = '1';
            toast.style.display = 'block';
            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => {
                    toast.style.display = 'none';
                }, 300);
            }, duration);
        }
    }

    /**
     * Update status display
     */
    function updateStatusDisplay() {
        if (!statusDisplay) return;

        const contentId = currentContentId ? `<span style="color: #10a37f; font-weight: 600;">${currentContentId}</span>` : '<span style="color: #999;">loading...</span>';
        const fileCount = Object.keys(interceptedData).length;
        const fileCountDisplay = `<span style="color: #10a37f; font-weight: 600;">${fileCount}/3</span>`;

        statusDisplay.innerHTML = `
            <span style="color: #10a37f; font-weight: 500;">📦</span>
            <span>Content ID: ${contentId} | API Calls: ${fileCountDisplay}</span>
        `;
    }

    /**
     * Handle content ID change
     */
    function handleContentIdChange() {
        const newContentId = getContentIdFromURL();

        if (newContentId && newContentId !== currentContentId) {
            console.log(`[Itiliti Content Downloader] Content ID changed to: ${newContentId}`);
            currentContentId = newContentId;

            // Clear previous data
            Object.keys(interceptedData).forEach(key => delete interceptedData[key]);

            // Start timeout to download after 10 seconds if not all data is fetched
            startAutoDownloadTimer();

            updateStatusDisplay();
        }
    }

    /**
     * Start a 10-second timer for auto-download
     */
    let autoDownloadTimer = null;
    function startAutoDownloadTimer() {
        // Clear any existing timer
        if (autoDownloadTimer) {
            clearTimeout(autoDownloadTimer);
        }

        // Set new timer
        autoDownloadTimer = setTimeout(() => {
            const dataCount = Object.keys(interceptedData).length;
            if (dataCount > 0 && dataCount < 3) {
                console.log(`[Itiliti Content Downloader] Auto-download triggered with ${dataCount}/3 files`);
                showToast(`Auto-downloading ${dataCount} available file(s)...`);
                createAndDownloadZip();
            }
        }, 10000);
    }

    /**
     * Check if all data is collected and download
     */
    function checkAndDownloadIfComplete() {
        if (Object.keys(interceptedData).length === 3) {
            // Clear the auto-download timer since we have all data
            if (autoDownloadTimer) {
                clearTimeout(autoDownloadTimer);
                autoDownloadTimer = null;
            }

            console.log('[Itiliti Content Downloader] All API calls completed, auto-downloading...');
            showToast('All data received, downloading...');
            createAndDownloadZip();
        }
    }

    // Intercept fetch requests
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

        // Check if this is one of our target API endpoints
        let matchedEndpoint = null;
        for (const endpoint of API_ENDPOINTS) {
            if (url && url.includes(endpoint.pattern)) {
                matchedEndpoint = endpoint;
                break;
            }
        }

        if (matchedEndpoint) {
            if (debugMode) {
                console.log(`[Itiliti Content Downloader] Intercepted ${matchedEndpoint.key}:`, url);
            }
        }

        const response = await originalFetch.apply(this, args);

        if (matchedEndpoint && response.ok) {
            try {
                const clonedResponse = response.clone();
                const data = await clonedResponse.json();

                if (debugMode) {
                    console.log(`[Itiliti Content Downloader] Data received for ${matchedEndpoint.key}:`, data);
                }

                // Store the data
                interceptedData[matchedEndpoint.key] = {
                    data: data,
                    filename: matchedEndpoint.filename
                };

                updateStatusDisplay();
                checkAndDownloadIfComplete();
            } catch (error) {
                console.error(`[Itiliti Content Downloader] Error processing ${matchedEndpoint.key}:`, error);
            }
        }

        return response;
    };

    // Intercept XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._url = url;
        return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener('load', function () {
            const url = this._url;

            // Check if this is one of our target endpoints
            let matchedEndpoint = null;
            for (const endpoint of API_ENDPOINTS) {
                if (url && url.includes(endpoint.pattern)) {
                    matchedEndpoint = endpoint;
                    break;
                }
            }

            if (matchedEndpoint && this.status === 200) {
                if (debugMode) {
                    console.log(`[Itiliti Content Downloader] XHR Intercepted ${matchedEndpoint.key}:`, url);
                }

                try {
                    const data = JSON.parse(this.responseText);

                    if (debugMode) {
                        console.log(`[Itiliti Content Downloader] XHR Data received for ${matchedEndpoint.key}:`, data);
                    }

                    // Store the data
                    interceptedData[matchedEndpoint.key] = {
                        data: data,
                        filename: matchedEndpoint.filename
                    };

                    updateStatusDisplay();
                    checkAndDownloadIfComplete();
                } catch (error) {
                    console.error(`[Itiliti Content Downloader] Error processing XHR ${matchedEndpoint.key}:`, error);
                }
            }
        });

        return originalSend.apply(this, args);
    };

    /**
     * Create UI elements
     */
    function createUI() {
        // Create status display
        const statusContainer = document.createElement('div');
        statusContainer.id = 'itiliti-downloader-status';
        statusContainer.style.cssText = `
            position: fixed;
            top: 20px;
            left: 20px;
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 12px;
            color: #333;
            padding: 10px 16px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            z-index: 10000;
        `;

        statusDisplay = document.createElement('div');
        statusDisplay.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
        `;

        const debugToggle = document.createElement('span');
        debugToggle.style.cssText = `
            font-size: 10px;
            color: #999;
            cursor: pointer;
            text-decoration: underline;
            user-select: none;
            margin-left: 8px;
            border-left: 1px solid #ddd;
            padding-left: 8px;
        `;
        debugToggle.textContent = 'debug';
        debugToggle.title = 'Toggle debug logs in console';
        debugToggle.addEventListener('click', () => {
            debugMode = !debugMode;
            console.log(`[Itiliti Content Downloader] Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
            showToast(`Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
        });

        statusContainer.appendChild(statusDisplay);
        statusContainer.appendChild(debugToggle);
        document.body.appendChild(statusContainer);

        // Create download button
        downloadButton = document.createElement('button');
        downloadButton.id = 'itiliti-download-btn';
        downloadButton.textContent = 'Download Data';
        downloadButton.style.cssText = `
            position: fixed;
            top: 20px;
            left: 320px;
            padding: 8px 16px;
            background: linear-gradient(to bottom, #10a37f, #0d8c6d) !important;
            border: 1px solid #10a37f !important;
            color: white !important;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            z-index: 10000;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        `;
        downloadButton.addEventListener('mouseover', () => {
            downloadButton.style.background = 'linear-gradient(to bottom, #0d8c6d, #0a7558) !important';
        });
        downloadButton.addEventListener('mouseout', () => {
            downloadButton.style.background = 'linear-gradient(to bottom, #10a37f, #0d8c6d) !important';
        });
        downloadButton.addEventListener('click', async () => {
            await createAndDownloadZip();
        });
        document.body.appendChild(downloadButton);

        // Toast notification
        const toast = document.createElement('div');
        toast.id = 'itiliti-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            font-size: 12px;
            color: white;
            background: #10a37f;
            padding: 10px 16px;
            border-radius: 6px;
            display: none;
            opacity: 0;
            transition: opacity 0.3s ease;
            z-index: 10001;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        `;
        document.body.appendChild(toast);

        // Initial content ID check
        handleContentIdChange();
        updateStatusDisplay();

        console.log('[Itiliti Content Downloader] UI created and monitoring...');
    }

    // Watch for URL changes (for SPA navigation)
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            console.log('[Itiliti Content Downloader] URL changed, checking for content ID...');
            handleContentIdChange();
        }
    });

    observer.observe(document, { subtree: true, childList: true });

    // Also use popstate for history navigation
    window.addEventListener('popstate', () => {
        console.log('[Itiliti Content Downloader] Navigation detected');
        handleContentIdChange();
    });

    // Wait for page to load before creating UI
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }

    console.log('[Itiliti Content Downloader] Script loaded and monitoring...');
    console.log('[Itiliti Content Downloader] Endpoints:', API_ENDPOINTS.map(e => e.key).join(', '));
})();
