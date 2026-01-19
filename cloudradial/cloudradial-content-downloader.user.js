// ==UserScript==
// @name         CloudRadial Content Downloader
// @namespace    https://github.com/warthurton/userscripts
// @version      1.0.6
// @description  Auto-download content data from CloudRadial admin portal
// @author       warthurton
// @match        https://portal.itiliti.io/app/admin/content*
// @match        https://portal.itiliti.io/app/admin/tokens*
// @match        https://portal.itiliti.io/app/admin/questions*
// @icon         https://favicons-blue.vercel.app/?domain=itiliti.io
// @run-at       document-start
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/cloudradial/cloudradial-content-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/cloudradial/cloudradial-content-downloader.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function () {
    'use strict';

    let currentContentId = null;
    const API_ENDPOINTS = [
        {
            key: 'templates',
            pattern: '/api/content/templates?',
            filename: 'templates.json',
            page: 'content'
        },
        {
            key: 'content',
            pattern: '/api/content/content?',
            filename: 'content.json',
            page: 'content'
        },
        {
            key: 'assessments',
            pattern: '/api/content/assessments/options?',
            filename: 'assessments-options.json',
            page: 'content'
        },
        {
            key: 'psa',
            pattern: '/api/partner/psa?',
            filename: 'psa.json',
            page: 'tokens'
        },
        {
            key: 'questionTemplates',
            pattern: '/api/catalog/questionTemplates?',
            filename: 'questionTemplates.json',
            page: 'questions'
        }
    ];

    // Store intercepted data
    const interceptedData = {};
    let debugMode = true;
    let statusDisplay = null;
    const lastDownloadTimes = {}; // Map of contentId -> timestamp

    /**
     * Enhanced logging function
     */
    function log(message, data = null) {
        const timestamp = new Date().toLocaleTimeString();
        const prefix = `[${timestamp}] [CloudRadial]`;
        if (data !== null) {
            console.log(`${prefix} ${message}`, data);
        } else {
            console.log(`${prefix} ${message}`);
        }
    }

    /**
     * Get current page type
     */
    function getCurrentPageType() {
        const pathname = window.location.pathname;
        if (pathname.includes('/app/admin/content')) {
            return 'content';
        } else if (pathname.includes('/app/admin/tokens')) {
            return 'tokens';
        } else if (pathname.includes('/app/admin/questions')) {
            return 'questions';
        }
        return null;
    }

    /**
     * Check if on root content page
     */
    function isRootContentPage() {
        return window.location.pathname === '/app/admin/content' || window.location.pathname === '/app/admin/content/';
    }

    /**
     * Check if on tokens page
     */
    function isTokensPage() {
        return window.location.pathname === '/app/admin/tokens' || window.location.pathname === '/app/admin/tokens/';
    }

    /**
     * Check if on questions list page
     */
    function isQuestionsListPage() {
        return window.location.pathname === '/app/admin/questions' || window.location.pathname === '/app/admin/questions/';
    }

    /**
     * Check if on specific question detail page
     */
    function isQuestionDetailPage() {
        return /^\/app\/admin\/questions\/\d+/.test(window.location.pathname);
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
            log(`⚠ Download rate limit: ${contentId} was downloaded ${secondsLeft}s ago, waiting...`);
            showToast(`Content ${contentId} downloaded recently. Wait ${secondsLeft}s before downloading again.`, 4000);
            
            // If in batch mode, still continue to next item
            const batchState = localStorage.getItem('cloudradial-batch-download');
            if (batchState) {
                setTimeout(() => continueNextBatchDownload(), 2000);
            }
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
            const currentPage = getCurrentPageType();
            const pagePrefix = currentPage === 'questions' ? 'questions' : currentPage === 'tokens' ? 'tokens' : 'content';
            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cloudradial-${pagePrefix}-${contentId}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Update last download time for this content ID
            lastDownloadTimes[contentId] = Date.now();

            log(`✓ Downloaded ${count} files as: cloudradial-${pagePrefix}-${contentId}.zip`);
            showToast(`Downloaded ${count} file(s) as zip`);
            
            // If in batch download mode, continue to next item
            const batchState = localStorage.getItem('cloudradial-batch-download');
            if (batchState) {
                log(`✓ In batch mode, continuing to next item in 2s...`);
                setTimeout(() => continueNextBatchDownload(), 2000);
            }
            
            return count;
        } else {
            log(`✗ No data available to download`);
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

        const currentPage = getCurrentPageType();
        const expectedCount = currentPage === 'content' ? 3 : 1;
        const contentId = currentContentId ? `<span style="color: #10a37f; font-weight: 600;">${currentContentId}</span>` : '<span style="color: #999;">loading...</span>';
        const fileCount = Object.keys(interceptedData).length;
        const fileCountDisplay = `<span style="color: #10a37f; font-weight: 600;">${fileCount}/${expectedCount}</span>`;

        statusDisplay.innerHTML = `
            <span style="color: #10a37f; font-weight: 500;">📦</span>
            <span>Content ID: ${contentId} | API Calls: ${fileCountDisplay}</span>
        `;
    }

    /**
     * Get content ID from URL
     */
    function getContentIdFromURL() {
        const contentMatch = window.location.pathname.match(/\/app\/admin\/content\/(\d+)/);
        if (contentMatch) return contentMatch[1];
        
        const questionMatch = window.location.pathname.match(/\/app\/admin\/questions\/(\d+)/);
        if (questionMatch) return questionMatch[1];
        
        return null;
    }

    /**
     * Handle content ID change
     */
    function handleContentIdChange() {
        const newContentId = getContentIdFromURL();
        const currentPage = getCurrentPageType();

        log(`URL: ${window.location.pathname} | Page Type: ${currentPage} | New ID: ${newContentId} | Current ID: ${currentContentId}`);

        // Only process if we have a content ID (detail pages, not root pages)
        // Root pages (/app/admin/questions/, /app/admin/content/, etc.) have no content ID
        if (newContentId && newContentId !== currentContentId) {
            const itemType = currentPage === 'questions' ? 'Question' : 'Content';
            log(`✓ ${itemType} ID changed to: ${newContentId}`);
            currentContentId = newContentId;

            // Clear previous data
            const clearedKeys = Object.keys(interceptedData);
            Object.keys(interceptedData).forEach(key => delete interceptedData[key]);
            log(`✓ Cleared intercepted data (was: ${clearedKeys.join(', ') || 'none'})`);

            // Start timeout to download after 10 seconds if not all data is fetched
            log(`✓ Starting auto-download timer (10s timeout)`);
            startAutoDownloadTimer();

            updateStatusDisplay();
        } else if (!newContentId) {
            // On root pages - no auto-download
            log(`✓ On root page (${window.location.pathname}) - disabling auto-download`);
            currentContentId = null;
            
            // Clear any pending timers
            if (autoDownloadTimer) {
                log(`✓ Cleared pending auto-download timer`);
                clearTimeout(autoDownloadTimer);
                autoDownloadTimer = null;
            }
            
            // Clear intercepted data
            const clearedKeys = Object.keys(interceptedData);
            Object.keys(interceptedData).forEach(key => delete interceptedData[key]);
            if (clearedKeys.length > 0) {
                log(`✓ Cleared root page data (was: ${clearedKeys.join(', ')})`);
            }
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
            log(`✓ Cleared previous auto-download timer`);
            clearTimeout(autoDownloadTimer);
        }

        // Set new timer
        log(`➤ Auto-download timer started (10s delay)`);
        autoDownloadTimer = setTimeout(() => {
            const currentPage = getCurrentPageType();
            const expectedCount = currentPage === 'content' ? 3 : 1;
            const dataCount = Object.keys(interceptedData).length;
            
            log(`⏱ Timer fired: ${dataCount}/${expectedCount} files ready`);
            log(`  Intercepted keys: ${Object.keys(interceptedData).join(', ') || 'none'}`);
            
            if (dataCount > 0 && dataCount < expectedCount) {
                log(`⚠ Auto-download triggered with incomplete data (${dataCount}/${expectedCount})`);
                showToast(`Auto-downloading ${dataCount} available file(s)...`);
                createAndDownloadZip();
            } else if (dataCount >= expectedCount) {
                log(`✓ Auto-download triggered with complete data (${dataCount}/${expectedCount})`);
                showToast('All data received, downloading...');
                createAndDownloadZip();
            } else {
                log(`✗ No data collected, skipping auto-download`);
            }
        }, 10000);
    }

    /**
     * Check if all data is collected and download
     */
    function checkAndDownloadIfComplete() {
        const currentPage = getCurrentPageType();
        const expectedCount = currentPage === 'content' ? 3 : 1; // Content needs 3 APIs, others need 1
        const dataCount = Object.keys(interceptedData).length;
        
        log(`📊 API check: ${dataCount}/${expectedCount} | Keys: ${Object.keys(interceptedData).join(', ') || 'none'}`);
        
        // Only auto-download on detail pages (when we have a currentContentId)
        if (!currentContentId) {
            log(`ℹ On root page, skipping auto-download`);
            return;
        }
        
        if (dataCount >= expectedCount) {
            // Clear the auto-download timer since we have all data
            if (autoDownloadTimer) {
                log(`✓ All data received, cancelling timer`);
                clearTimeout(autoDownloadTimer);
                autoDownloadTimer = null;
            }

            log(`✓ All ${dataCount} APIs complete, triggering auto-download`);
            showToast('All data received, downloading...');
            createAndDownloadZip();
        }
    }

    // Intercept fetch requests
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        const currentPage = getCurrentPageType();

        // Check if this is one of our target API endpoints
        let matchedEndpoint = null;
        for (const endpoint of API_ENDPOINTS) {
            if (url && url.includes(endpoint.pattern) && endpoint.page === currentPage) {
                matchedEndpoint = endpoint;
                break;
            }
        }

        if (matchedEndpoint) {
            log(`→ [FETCH] Intercepting ${matchedEndpoint.key} from ${currentPage} page`);
        }

        const response = await originalFetch.apply(this, args);

        if (matchedEndpoint && response.ok) {
            try {
                const clonedResponse = response.clone();
                const data = await clonedResponse.json();

                log(`✓ [FETCH] ${matchedEndpoint.key} received`, { status: response.status, size: JSON.stringify(data).length });

                // Store the data
                interceptedData[matchedEndpoint.key] = {
                    data: data,
                    filename: matchedEndpoint.filename
                };

                updateStatusDisplay();
                checkAndDownloadIfComplete();
            } catch (error) {
                log(`✗ [FETCH] Error processing ${matchedEndpoint.key}:`, error.message);
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
            const currentPage = getCurrentPageType();

            // Check if this is one of our target endpoints
            let matchedEndpoint = null;
            for (const endpoint of API_ENDPOINTS) {
                // Must match both the URL pattern AND the current page type
                if (url && url.includes(endpoint.pattern) && endpoint.page === currentPage) {
                    matchedEndpoint = endpoint;
                    break;
                }
            }

            if (matchedEndpoint && this.status === 200) {
                log(`→ [XHR] Intercepting ${matchedEndpoint.key} from ${currentPage} page`);

                try {
                    const data = JSON.parse(this.responseText);

                    log(`✓ [XHR] ${matchedEndpoint.key} received`, { status: this.status, size: this.responseText.length });

                    // Store the data
                    interceptedData[matchedEndpoint.key] = {
                        data: data,
                        filename: matchedEndpoint.filename
                    };

                    updateStatusDisplay();
                    checkAndDownloadIfComplete();
                } catch (error) {
                    log(`✗ [XHR] Error processing ${matchedEndpoint.key}:`, error.message);
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
     * Get all content IDs from intercepted templates data
     */
    async function getAllContentIds() {
        if (!interceptedData['templates']) {
            console.error('[CloudRadial Content Downloader] No templates data available. Please wait for page to load.');
            showToast('No templates data available yet. Please wait for the page to load.', 4000);
            return [];
        }

        try {
            const data = interceptedData['templates'].data;
            
            // Extract IDs from the response
            let ids = [];
            if (Array.isArray(data)) {
                ids = data.map(item => item.id).filter(id => id);
            } else if (data.data && Array.isArray(data.data)) {
                ids = data.data.map(item => item.id).filter(id => id);
            }
            
            console.log(`[CloudRadial Content Downloader] Found ${ids.length} content IDs from intercepted templates`);
            return ids;
        } catch (error) {
            console.error('[CloudRadial Content Downloader] Error extracting content IDs:', error);
            return [];
        }
    }

    /**
     * Get all question IDs from intercepted questionTemplates data
     */
    async function getAllQuestionIds() {
        if (!interceptedData['questionTemplates']) {
            console.error('[CloudRadial Content Downloader] No question templates data available. Please wait for page to load.');
            showToast('No question templates data available yet. Please wait for the page to load.', 4000);
            return [];
        }

        try {
            const data = interceptedData['questionTemplates'].data;
            
            // Extract IDs from the response
            let ids = [];
            if (Array.isArray(data)) {
                ids = data.map(item => item.id).filter(id => id);
            } else if (data.data && Array.isArray(data.data)) {
                ids = data.data.map(item => item.id).filter(id => id);
            }
            
            console.log(`[CloudRadial Content Downloader] Found ${ids.length} question IDs from intercepted templates`);
            return ids;
        } catch (error) {
            console.error('[CloudRadial Content Downloader] Error extracting question IDs:', error);
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

        // Store the batch download state in localStorage
        localStorage.setItem('cloudradial-batch-download', JSON.stringify({
            ids: ids,
            currentIndex: 0,
            startTime: Date.now(),
            type: 'content'
        }));

        showToast(`Starting download of ${ids.length} items...`);
        console.log(`[CloudRadial Content Downloader] Starting batch download of ${ids.length} items:`, ids);

        // Navigate to the first content
        const firstId = ids[0];
        console.log(`[CloudRadial Content Downloader] Navigating to first content ${firstId}...`);
        window.location.href = `/app/admin/content/${firstId}`;
    }

    /**
     * Download all question IDs sequentially
     */
    async function downloadAllQuestions() {
        const ids = await getAllQuestionIds();
        if (ids.length === 0) {
            showToast('No question IDs found');
            return;
        }

        // Store the batch download state in localStorage
        localStorage.setItem('cloudradial-batch-download', JSON.stringify({
            ids: ids,
            currentIndex: 0,
            startTime: Date.now(),
            type: 'questions'
        }));

        showToast(`Starting download of ${ids.length} questions...`);
        console.log(`[CloudRadial Content Downloader] Starting batch download of ${ids.length} questions:`, ids);

        // Navigate to the first question
        const firstId = ids[0];
        console.log(`[CloudRadial Content Downloader] Navigating to first question ${firstId}...`);
        window.location.href = `/app/admin/questions/${firstId}`;
    }

    /**
     * Check if we're in batch download mode and continue if needed
     */
    function checkBatchDownloadState() {
        const batchState = localStorage.getItem('cloudradial-batch-download');
        if (!batchState) {
            log(`ℹ No batch download in progress`);
            return;
        }

        try {
            const state = JSON.parse(batchState);
            const { ids, currentIndex, type = 'content' } = state;

            // Check if batch download timed out (over 1 hour old)
            if (Date.now() - state.startTime > 3600000) {
                log(`✗ Batch download timed out (over 1 hour), clearing state`);
                localStorage.removeItem('cloudradial-batch-download');
                return;
            }

            log(`✓ Batch download in progress: ${currentIndex + 1}/${ids.length} (${type}s)`);
            log(`  IDs: [${ids.join(', ')}]`);
            
            // Wait for auto-download to complete, then move to next
            // We'll check after the download completes
        } catch (error) {
            log(`✗ Error parsing batch state:`, error.message);
            localStorage.removeItem('cloudradial-batch-download');
        }
    }

    /**
     * Move to next item in batch download
     */
    function continueNextBatchDownload() {
        const batchState = localStorage.getItem('cloudradial-batch-download');
        if (!batchState) {
            log(`ℹ No batch download to continue`);
            return;
        }

        try {
            const state = JSON.parse(batchState);
            const { ids, currentIndex, type = 'content' } = state;
            const nextIndex = currentIndex + 1;

            if (nextIndex >= ids.length) {
                // Batch complete
                log(`✓ Batch download complete! Downloaded ${ids.length} items`);
                showToast(`Batch download complete! Downloaded ${ids.length} items`);
                localStorage.removeItem('cloudradial-batch-download');
                return;
            }

            // Update state and navigate to next
            state.currentIndex = nextIndex;
            localStorage.setItem('cloudradial-batch-download', JSON.stringify(state));

            const nextId = ids[nextIndex];
            const itemType = type === 'questions' ? 'question' : 'content';
            const urlPath = type === 'questions' ? '/app/admin/questions' : '/app/admin/content';
            
            log(`→ Moving to next ${itemType}: ${nextId} (${nextIndex + 1}/${ids.length})`);
            showToast(`Downloading ${nextIndex + 1}/${ids.length}...`);
            
            // Small delay before navigation
            setTimeout(() => {
                log(`→ Navigating to: ${urlPath}/${nextId}`);
                window.location.href = `${urlPath}/${nextId}`;
            }, 1000);
        } catch (error) {
            log(`✗ Error in batch continuation:`, error.message);
            localStorage.removeItem('cloudradial-batch-download');
        }
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

        // Add small buttons to navbar (root pages only)
        if (isRootContentPage()) {
            const downloadTemplatesBtn = document.createElement('button');
            downloadTemplatesBtn.id = 'cloudradial-download-templates-btn';
            downloadTemplatesBtn.textContent = 'Templates';
            downloadTemplatesBtn.title = 'Download templates list';
            downloadTemplatesBtn.style.cssText = `
                padding: 4px 10px;
                margin-left: 12px;
                background: #10a37f !important;
                border: 1px solid #0d8c6d !important;
                color: white !important;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                font-weight: 500;
                height: auto;
                line-height: 1;
            `;
            downloadTemplatesBtn.addEventListener('mouseover', () => {
                downloadTemplatesBtn.style.background = '#0d8c6d !important';
            });
            downloadTemplatesBtn.addEventListener('mouseout', () => {
                downloadTemplatesBtn.style.background = '#10a37f !important';
            });
            downloadTemplatesBtn.addEventListener('click', async () => {
                if (interceptedData['templates']) {
                    const zip = new JSZip();
                    zip.file('templates.json', JSON.stringify(interceptedData['templates'].data, null, 2));
                    const blob = await zip.generateAsync({ type: 'blob' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `cloudradial-templates-${Date.now()}.zip`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    showToast('Downloaded templates list');
                } else {
                    showToast('No templates data intercepted yet. Please wait or refresh the page.', 4000);
                }
            });

            const downloadAllBtn = document.createElement('button');
            downloadAllBtn.id = 'cloudradial-download-all-btn';
            downloadAllBtn.textContent = 'Download All';
            downloadAllBtn.title = 'Batch download all content';
            downloadAllBtn.style.cssText = `
                padding: 4px 10px;
                margin-left: 8px;
                background: #10a37f !important;
                border: 1px solid #0d8c6d !important;
                color: white !important;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                font-weight: 500;
                height: auto;
                line-height: 1;
            `;
            downloadAllBtn.addEventListener('mouseover', () => {
                downloadAllBtn.style.background = '#0d8c6d !important';
            });
            downloadAllBtn.addEventListener('mouseout', () => {
                downloadAllBtn.style.background = '#10a37f !important';
            });
            downloadAllBtn.addEventListener('click', async () => {
                downloadAllBtn.disabled = true;
                downloadAllBtn.textContent = 'Processing...';
                await downloadAllContent();
                downloadAllBtn.disabled = false;
                downloadAllBtn.textContent = 'Download All';
            });

            statusContainer.appendChild(downloadTemplatesBtn);
            statusContainer.appendChild(downloadAllBtn);
        }

        // Add download all button for questions list page
        if (isQuestionsListPage()) {
            const downloadAllQuestionsBtn = document.createElement('button');
            downloadAllQuestionsBtn.id = 'cloudradial-download-all-questions-btn';
            downloadAllQuestionsBtn.textContent = 'All';
            downloadAllQuestionsBtn.title = 'Batch download all questions';
            downloadAllQuestionsBtn.style.cssText = `
                padding: 4px 10px;
                margin-left: 12px;
                background: #10a37f !important;
                border: 1px solid #0d8c6d !important;
                color: white !important;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                font-weight: 500;
                height: auto;
                line-height: 1;
            `;
            downloadAllQuestionsBtn.addEventListener('mouseover', () => {
                downloadAllQuestionsBtn.style.background = '#0d8c6d !important';
            });
            downloadAllQuestionsBtn.addEventListener('mouseout', () => {
                downloadAllQuestionsBtn.style.background = '#10a37f !important';
            });
            downloadAllQuestionsBtn.addEventListener('click', async () => {
                downloadAllQuestionsBtn.disabled = true;
                downloadAllQuestionsBtn.textContent = 'Processing...';
                await downloadAllQuestions();
                downloadAllQuestionsBtn.disabled = false;
                downloadAllQuestionsBtn.textContent = 'All';
            });

            statusContainer.appendChild(downloadAllQuestionsBtn);
        }

        // Try immediately and with retries
        tryInsertIntoNavbar();
        setTimeout(tryInsertIntoNavbar, 500);
        setTimeout(tryInsertIntoNavbar, 1000);

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

        // Add manual download button for tokens and questions pages
        const pageType = getCurrentPageType();
        if (pageType === 'tokens' || pageType === 'questions') {
            const manualDownloadBtn = document.createElement('button');
            manualDownloadBtn.id = 'cloudradial-manual-download-btn';
            manualDownloadBtn.textContent = `Download ${pageType === 'tokens' ? 'PSA Data' : 'Questions'}`;
            manualDownloadBtn.style.cssText = `
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
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                z-index: 10000;
            `;
            manualDownloadBtn.addEventListener('mouseover', () => {
                manualDownloadBtn.style.background = 'linear-gradient(to bottom, #0d8c6d, #0a7558) !important';
            });
            manualDownloadBtn.addEventListener('mouseout', () => {
                manualDownloadBtn.style.background = 'linear-gradient(to bottom, #10a37f, #0d8c6d) !important';
            });
            manualDownloadBtn.addEventListener('click', async () => {
                createAndDownloadZip();
            });
            document.body.appendChild(manualDownloadBtn);
        }

        // Initial content ID check
        handleContentIdChange();
        updateStatusDisplay();
        
        // Check if we're in batch download mode
        checkBatchDownloadState();

        log(`✓ UI created and monitoring (Page: ${getCurrentPageType()})`);
    }

    // Watch for DOM and URL changes
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            log(`→ URL changed to: ${window.location.pathname}`);
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
        log(`→ History navigation detected`);
        handleContentIdChange();
    });

    // Wait for page to load before creating UI
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }

    log(`✓ Script initialized`);
    log(`📡 Monitoring endpoints: ${API_ENDPOINTS.map(e => e.key).join(', ')}`);
    log(`🌐 Current page: ${getCurrentPageType()} | URL: ${window.location.pathname}`);
})();
