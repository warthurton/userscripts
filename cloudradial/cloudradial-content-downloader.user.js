// ==UserScript==
// @name         CloudRadial Content Downloader
// @namespace    https://github.com/warthurton/userscripts
// @version      1.0
// @description  Auto-download content data from CloudRadial admin portal
// @match        https://portal.itiliti.io/app/admin/content*
// @icon         https://favicons-blue.vercel.app/?domain=itiliti.io
// @run-at       document-start
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
//
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/cloudradial/cloudradial-content-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/cloudradial/cloudradial-content-downloader.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
//
// @grant        none
// @author       warthurton
// ==/UserScript==

(function () {
    'use strict';

    // Block the chatwidget script from loading
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName, ...args) {
        const element = originalCreateElement.apply(document, [tagName, ...args]);
        
        if (tagName.toLowerCase() === 'script') {
            const originalSetAttribute = element.setAttribute;
            element.setAttribute = function(name, value) {
                if (name === 'src' && value && value.includes('crchat-chatwidget.js')) {
                    console.log('[CloudRadial Content Downloader] Blocking chatwidget script');
                    return; // Don't set the src attribute
                }
                return originalSetAttribute.apply(this, [name, value]);
            };
        }
        
        return element;
    };

    // Also block if script is already in the page
    const chatwidgetScript = document.querySelector('script[src*="crchat-chatwidget.js"]');
    if (chatwidgetScript) {
        console.log('[CloudRadial Content Downloader] Removing existing chatwidget script');
        chatwidgetScript.remove();
    }

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
    let statusDisplay = null;
    const lastDownloadTimes = {}; // Map of contentId -> timestamp

    /**
     * Check if on root content page
     */
    function isRootContentPage() {
        return window.location.pathname === '/app/admin/content' || window.location.pathname === '/app/admin/content/';
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
            console.warn('[CloudRadial Content Downloader] Could not extract content title:', e);
        }
        return null;
    }

    /**
     * Create and download a zip file with all collected data
     */
    async function createAndDownloadZip() {
        // Check if this content ID was recently downloaded (within 1 minute)
        const now = Date.now();
        const contentId = currentContentId || 'unknown';
        const lastDownload = lastDownloadTimes[contentId];
        
        if (lastDownload && (now - lastDownload) < 60000) {
            const secondsLeft = Math.ceil((60000 - (now - lastDownload)) / 1000);
            showToast(`Content ${contentId} downloaded recently. Wait ${secondsLeft}s before downloading again.`, 4000);
            return 0;
        }

        const zip = new JSZip();
        let count = 0;
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
            a.download = `cloudradial-content-${contentId}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Update last download time for this content ID
            lastDownloadTimes[contentId] = Date.now();

            console.log(`[CloudRadial Content Downloader] Downloaded zip with ${count} file(s)`);
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
        const toast = document.getElementById('cloudradial-toast');
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
            console.log(`[CloudRadial Content Downloader] Content ID changed to: ${newContentId}`);
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
                console.log(`[CloudRadial Content Downloader] Auto-download triggered with ${dataCount}/3 files`);
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

            console.log('[CloudRadial Content Downloader] All API calls completed, auto-downloading...');
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
                console.log(`[CloudRadial Content Downloader] Intercepted ${matchedEndpoint.key}:`, url);
            }
        }

        const response = await originalFetch.apply(this, args);

        if (matchedEndpoint && response.ok) {
            try {
                const clonedResponse = response.clone();
                const data = await clonedResponse.json();

                if (debugMode) {
                    console.log(`[CloudRadial Content Downloader] Data received for ${matchedEndpoint.key}:`, data);
                }

                // Store the data
                interceptedData[matchedEndpoint.key] = {
                    data: data,
                    filename: matchedEndpoint.filename
                };

                updateStatusDisplay();
                checkAndDownloadIfComplete();
            } catch (error) {
                console.error(`[CloudRadial Content Downloader] Error processing ${matchedEndpoint.key}:`, error);
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
                    console.log(`[CloudRadial Content Downloader] XHR Intercepted ${matchedEndpoint.key}:`, url);
                }

                try {
                    const data = JSON.parse(this.responseText);

                    if (debugMode) {
                        console.log(`[CloudRadial Content Downloader] XHR Data received for ${matchedEndpoint.key}:`, data);
                    }

                    // Store the data
                    interceptedData[matchedEndpoint.key] = {
                        data: data,
                        filename: matchedEndpoint.filename
                    };

                    updateStatusDisplay();
                    checkAndDownloadIfComplete();
                } catch (error) {
                    console.error(`[CloudRadial Content Downloader] Error processing XHR ${matchedEndpoint.key}:`, error);
                }
            }
        });

        return originalSend.apply(this, args);
    };

    /**
     * Check if on root content page
     */
    function isRootContentPage() {
        return window.location.pathname === '/app/admin/content' || window.location.pathname === '/app/admin/content/';
    }

    /**
     * Get all content IDs from templates API
     */
    async function getAllContentIds() {
        try {
            const response = await fetch('https://portal.itiliti.io/api/content/templates?s=0&t=999&d=a');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            
            // Extract IDs from the response
            let ids = [];
            if (Array.isArray(data)) {
                ids = data.map(item => item.id).filter(id => id);
            } else if (data.data && Array.isArray(data.data)) {
                ids = data.data.map(item => item.id).filter(id => id);
            }
            
            console.log(`[CloudRadial Content Downloader] Found ${ids.length} content IDs`);
            return ids;
        } catch (error) {
            console.error('[CloudRadial Content Downloader] Error fetching content IDs:', error);
            return [];
        }
    }

    /**
     * Download all content IDs sequentially
     */
    async function downloadAllContent() {
        const ids = await getAllContentIds();
        if (ids.length === 0) {
            showToast('No content IDs found');
            return;
        }

        showToast(`Starting download of ${ids.length} items...`);
        console.log(`[CloudRadial Content Downloader] Starting batch download of ${ids.length} items:`, ids);

        let completed = 0;
        for (const id of ids) {
            try {
                console.log(`[CloudRadial Content Downloader] Navigating to content ${id}...`);
                showToast(`Downloading ${completed + 1}/${ids.length}...`);
                
                // Navigate to the content page
                window.location.href = `/app/admin/content/${id}`;
                
                // Wait for the page to load and auto-download to happen
                await new Promise(resolve => setTimeout(resolve, 5000));
                completed++;
            } catch (error) {
                console.error(`[CloudRadial Content Downloader] Error downloading content ${id}:`, error);
            }
        }

        showToast(`Completed download of ${completed}/${ids.length} items`);
    }

    /**
     * Try to insert status container into navbar
     */
    let statusContainer = null;
    function tryInsertIntoNavbar() {
        if (!statusContainer) return;
        
        // Get the navbar right container element
        const navbarRight = document.evaluate(
            '//*[@id="navbar0"]/div[2]/div[2]',
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
        ).singleNodeValue;

        if (navbarRight && !document.getElementById('cloudradial-downloader-status')) {
            navbarRight.parentElement.insertBefore(statusContainer, navbarRight);
            console.log('[CloudRadial Content Downloader] Status inserted into navbar');
        }
    }

    /**
     * Create UI elements
     */
    function createUI() {
        // Create status display
        statusContainer = document.createElement('div');
        statusContainer.id = 'cloudradial-downloader-status';
        statusContainer.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            font-size: 12px;
            color: #333;
            padding: 0 12px;
            background: transparent;
            border: none;
            border-radius: 0;
            box-shadow: none;
            height: 100%;
            white-space: nowrap;
            flex: 1;
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
            console.log(`[CloudRadial Content Downloader] Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
            showToast(`Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
        });

        statusContainer.appendChild(statusDisplay);
        statusContainer.appendChild(debugToggle);

        // Try immediately and with retries
        tryInsertIntoNavbar();
        setTimeout(tryInsertIntoNavbar, 500);
        setTimeout(tryInsertIntoNavbar, 1000);

        // Add download all button if on root content page
        if (isRootContentPage()) {
            const downloadAllBtn = document.createElement('button');
            downloadAllBtn.id = 'cloudradial-download-all-btn';
            downloadAllBtn.textContent = 'Download All';
            downloadAllBtn.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                padding: 12px 20px;
                background: linear-gradient(to bottom, #10a37f, #0d8c6d) !important;
                border: 1px solid #10a37f !important;
                color: white !important;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 600;
                z-index: 10000;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            `;
            downloadAllBtn.addEventListener('mouseover', () => {
                downloadAllBtn.style.background = 'linear-gradient(to bottom, #0d8c6d, #0a7558) !important';
            });
            downloadAllBtn.addEventListener('mouseout', () => {
                downloadAllBtn.style.background = 'linear-gradient(to bottom, #10a37f, #0d8c6d) !important';
            });
            downloadAllBtn.addEventListener('click', async () => {
                downloadAllBtn.disabled = true;
                downloadAllBtn.textContent = 'Processing...';
                await downloadAllContent();
                downloadAllBtn.disabled = false;
                downloadAllBtn.textContent = 'Download All';
            });
            document.body.appendChild(downloadAllBtn);
        }

        // Toast notification
        const toast = document.createElement('div');
        toast.id = 'cloudradial-toast';
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

        console.log('[CloudRadial Content Downloader] UI created and monitoring...');
    }

    // Watch for DOM and URL changes
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            console.log('[CloudRadial Content Downloader] URL changed, checking for content ID...');
            handleContentIdChange();
        }
        // Re-insert if navbar structure changes
        if (!document.getElementById('cloudradial-downloader-status')) {
            tryInsertIntoNavbar();
        }
    });

    observer.observe(document, { subtree: true, childList: true });

    // Also use popstate for history navigation
    window.addEventListener('popstate', () => {
        console.log('[CloudRadial Content Downloader] Navigation detected');
        handleContentIdChange();
    });

    // Wait for page to load before creating UI
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }

    console.log('[CloudRadial Content Downloader] Script loaded and monitoring...');
    console.log('[CloudRadial Content Downloader] Endpoints:', API_ENDPOINTS.map(e => e.key).join(', '));
})();
