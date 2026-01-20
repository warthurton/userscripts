// ==UserScript==
// @name         CloudRadial Content Downloader
// @namespace    https://github.com/warthurton/userscripts
// @version      1.1
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
    const processedEndpoints = {}; // Track which endpoints we've already processed in this load

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
        const contentId = currentContentId || 'all';
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
        const isRootPage = !currentContentId && (isRootContentPage() || isQuestionsListPage() || isTokensPage());
        const contentId = currentContentId ? `<span style="color: #10a37f; font-weight: 600;">${currentContentId}</span>` : (isRootPage ? '' : '<span style="color: #999;">loading...</span>');
        const fileCount = Object.keys(interceptedData).length;
        const fileCountDisplay = `<span style="color: #10a37f; font-weight: 600;">${fileCount}/${expectedCount}</span>`;

        statusDisplay.innerHTML = `
            <span style="color: #10a37f; font-weight: 500;">📦</span>
            <span>${contentId ? `Content ID: ${contentId} | ` : ''}API Calls: ${fileCountDisplay}</span>
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

            // Clear previous data and processed endpoints
            const clearedKeys = Object.keys(interceptedData);
            Object.keys(interceptedData).forEach(key => delete interceptedData[key]);
            Object.keys(processedEndpoints).forEach(key => delete processedEndpoints[key]);
            log(`✓ Cleared intercepted data (was: ${clearedKeys.join(', ') || 'none'})`);

            // Only start auto-download timer if in batch download mode
            const batchState = localStorage.getItem('cloudradial-batch-download');
            if (batchState) {
                log(`✓ In batch mode - starting auto-download timer (10s timeout)`);
                startAutoDownloadTimer();
            } else {
                log(`ℹ Manual navigation - auto-download disabled`);
            }

            updateStatusDisplay();
            updateButtonVisibility();
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
            
            // Clear intercepted data and processed endpoints
            const clearedKeys = Object.keys(interceptedData);
            Object.keys(interceptedData).forEach(key => delete interceptedData[key]);
            Object.keys(processedEndpoints).forEach(key => delete processedEndpoints[key]);
            if (clearedKeys.length > 0) {
                log(`✓ Cleared root page data (was: ${clearedKeys.join(', ')})`);
            }
            updateStatusDisplay();
            updateButtonVisibility();
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
            // Skip if we've already processed this endpoint in the current load
            if (processedEndpoints[matchedEndpoint.key]) {
                log(`⊛ [FETCH] ${matchedEndpoint.key} already processed in this load, skipping duplicate`);
                return response;
            }
            
            try {
                const clonedResponse = response.clone();
                const data = await clonedResponse.json();

                log(`✓ [FETCH] ${matchedEndpoint.key} received`, { status: response.status, size: JSON.stringify(data).length });

                // Store the data and mark as processed
                interceptedData[matchedEndpoint.key] = {
                    data: data,
                    filename: matchedEndpoint.filename
                };
                processedEndpoints[matchedEndpoint.key] = true;

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
                // Skip if we've already processed this endpoint in the current load
                if (processedEndpoints[matchedEndpoint.key]) {
                    log(`⊛ [XHR] ${matchedEndpoint.key} already processed in this load, skipping duplicate`);
                    return;
                }
                
                log(`→ [XHR] Intercepting ${matchedEndpoint.key} from ${currentPage} page`);

                try {
                    const data = JSON.parse(this.responseText);

                    log(`✓ [XHR] ${matchedEndpoint.key} received`, { status: this.status, size: this.responseText.length });

                    // Store the data and mark as processed
                    interceptedData[matchedEndpoint.key] = {
                        data: data,
                        filename: matchedEndpoint.filename
                    };
                    processedEndpoints[matchedEndpoint.key] = true;

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

        // Navigate to the first content using SPA navigation
        const firstId = ids[0];
        console.log(`[CloudRadial Content Downloader] Navigating to first content ${firstId}...`);
        history.pushState(null, '', `/app/admin/content/${firstId}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
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

        // Navigate to the first question using SPA navigation
        const firstId = ids[0];
        console.log(`[CloudRadial Content Downloader] Navigating to first question ${firstId}...`);
        history.pushState(null, '', `/app/admin/questions/${firstId}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
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
            
            // Small delay before SPA navigation
            setTimeout(() => {
                log(`→ Navigating to: ${urlPath}/${nextId}`);
                history.pushState(null, '', `${urlPath}/${nextId}`);
                window.dispatchEvent(new PopStateEvent('popstate'));
            }, 1000);
        } catch (error) {
            log(`✗ Error in batch continuation:`, error.message);
            localStorage.removeItem('cloudradial-batch-download');
        }
    }

    /**
     * Update button visibility based on batch download state
     */
    function updateButtonVisibility() {
        const batchState = localStorage.getItem('cloudradial-batch-download');
        const currentPage = getCurrentPageType();
        let hasContentBatch = false;
        let hasQuestionsBatch = false;

        if (batchState) {
            try {
                const state = JSON.parse(batchState);
                if (state.type === 'content') hasContentBatch = true;
                if (state.type === 'questions') hasQuestionsBatch = true;
            } catch (e) {
                // Invalid state, ignore
            }
        }

        // Content page buttons
        const downloadTemplatesBtn = document.getElementById('cloudradial-download-templates-btn');
        const downloadAllBtn = document.getElementById('cloudradial-download-all-btn');
        const resetContentBtn = document.getElementById('cloudradial-reset-content-btn');
        const resumeContentBtn = document.getElementById('cloudradial-resume-content-btn');

        const isContentPage = isRootContentPage();
        if (downloadTemplatesBtn) downloadTemplatesBtn.style.display = isContentPage ? 'inline-block' : 'none';
        if (downloadAllBtn) downloadAllBtn.style.display = (isContentPage && !hasContentBatch) ? 'inline-block' : 'none';
        if (resetContentBtn) resetContentBtn.style.display = (isContentPage && hasContentBatch) ? 'inline-block' : 'none';
        if (resumeContentBtn) resumeContentBtn.style.display = (isContentPage && hasContentBatch) ? 'inline-block' : 'none';

        // Questions page buttons
        const downloadAllQuestionsBtn = document.getElementById('cloudradial-download-all-questions-btn');
        const resetBtn = document.getElementById('cloudradial-reset-btn');
        const resumeBtn = document.getElementById('cloudradial-resume-btn');

        const isQuestionsPage = isQuestionsListPage();
        if (downloadAllQuestionsBtn) downloadAllQuestionsBtn.style.display = (isQuestionsPage && !hasQuestionsBatch) ? 'inline-block' : 'none';
        if (resetBtn) resetBtn.style.display = (isQuestionsPage && hasQuestionsBatch) ? 'inline-block' : 'none';
        if (resumeBtn) resumeBtn.style.display = (isQuestionsPage && hasQuestionsBatch) ? 'inline-block' : 'none';

        // Tokens page button
        const downloadPSABtn = document.getElementById('cloudradial-download-psa-btn');
        const isTokensPageNow = isTokensPage();
        if (downloadPSABtn) downloadPSABtn.style.display = isTokensPageNow ? 'inline-block' : 'none';
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

        // Debug toggle container
        const debugContainer = document.createElement('div');
        debugContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            margin-left: 8px;
            border-left: 1px solid #ddd;
            padding-left: 8px;
        `;
        
        const debugCheckbox = document.createElement('input');
        debugCheckbox.type = 'checkbox';
        debugCheckbox.id = 'cloudradial-debug-checkbox';
        debugCheckbox.checked = debugMode;
        debugCheckbox.style.cssText = `
            cursor: pointer;
            margin: 0;
        `;
        debugCheckbox.title = 'Toggle debug logs in console';
        
        const debugLabel = document.createElement('label');
        debugLabel.htmlFor = 'cloudradial-debug-checkbox';
        debugLabel.textContent = 'debug';
        debugLabel.style.cssText = `
            font-size: 10px;
            color: #999;
            cursor: pointer;
            user-select: none;
        `;
        
        debugCheckbox.addEventListener('change', () => {
            debugMode = debugCheckbox.checked;
            console.log(`[CloudRadial Content Downloader] Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
            showToast(`Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
        });
        
        debugContainer.appendChild(debugCheckbox);
        debugContainer.appendChild(debugLabel);

        statusContainer.appendChild(statusDisplay);
        statusContainer.appendChild(debugContainer);
        
        // Add click handler to re-evaluate button visibility
        statusContainer.addEventListener('click', (e) => {
            // Don't interfere with checkbox clicks
            if (e.target !== debugCheckbox) {
                log('UI clicked, re-evaluating button visibility');
                updateButtonVisibility();
            }
        });
        statusContainer.style.cursor = 'pointer';

        // Create ALL buttons upfront (visibility controlled by updateButtonVisibility)
        
        // Content page buttons
        {
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
                display: none;
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
            downloadAllBtn.textContent = 'All';
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
                display: none;
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
                downloadAllBtn.textContent = 'All';
            });

            const resetContentBtn = document.createElement('button');
            resetContentBtn.id = 'cloudradial-reset-content-btn';
            resetContentBtn.textContent = 'Reset';
            resetContentBtn.title = 'Reset in-progress batch download';
            resetContentBtn.style.cssText = `
                padding: 4px 10px;
                margin-left: 8px;
                background: #d32f2f !important;
                border: 1px solid #b71c1c !important;
                color: white !important;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                font-weight: 500;
                height: auto;
                line-height: 1;
                display: none;
            `;
            resetContentBtn.addEventListener('mouseover', () => {
                resetContentBtn.style.background = '#b71c1c !important';
            });
            resetContentBtn.addEventListener('mouseout', () => {
                resetContentBtn.style.background = '#d32f2f !important';
            });
            resetContentBtn.addEventListener('click', () => {
                const batchState = localStorage.getItem('cloudradial-batch-download');
                if (batchState) {
                    try {
                        const state = JSON.parse(batchState);
                        if (state.type === 'content') {
                            localStorage.removeItem('cloudradial-batch-download');
                            log(`✓ Content batch download state cleared`);
                            showToast('Batch download reset');
                            updateButtonVisibility();
                        } else {
                            showToast('No content batch download to reset', 2000);
                        }
                    } catch (e) {
                        localStorage.removeItem('cloudradial-batch-download');
                        showToast('Batch download state cleared');
                        updateButtonVisibility();
                    }
                } else {
                    log(`ℹ No batch download in progress`);
                    showToast('No batch download to reset', 2000);
                }
            });

            const resumeContentBtn = document.createElement('button');
            resumeContentBtn.id = 'cloudradial-resume-content-btn';
            resumeContentBtn.textContent = 'Resume';
            resumeContentBtn.title = 'Resume interrupted batch download';
            resumeContentBtn.style.cssText = `
                padding: 4px 10px;
                margin-left: 8px;
                background: #ff9800 !important;
                border: 1px solid #f57c00 !important;
                color: white !important;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                font-weight: 500;
                height: auto;
                line-height: 1;
                display: none;
            `;
            resumeContentBtn.addEventListener('mouseover', () => {
                resumeContentBtn.style.background = '#f57c00 !important';
            });
            resumeContentBtn.addEventListener('mouseout', () => {
                resumeContentBtn.style.background = '#ff9800 !important';
            });
            resumeContentBtn.addEventListener('click', () => {
                const batchState = localStorage.getItem('cloudradial-batch-download');
                if (batchState) {
                    try {
                        const state = JSON.parse(batchState);
                        if (state.type === 'content') {
                            const { ids, currentIndex } = state;
                            const nextId = ids[currentIndex];
                            log(`→ Resuming content batch download at item ${currentIndex + 1}/${ids.length} (ID: ${nextId})`);
                            showToast(`Resuming at ${currentIndex + 1}/${ids.length}...`);
                            history.pushState(null, '', `/app/admin/content/${nextId}`);
                            window.dispatchEvent(new PopStateEvent('popstate'));
                        } else {
                            showToast('No content batch download to resume', 2000);
                        }
                    } catch (e) {
                        log(`✗ Error resuming batch download:`, e.message);
                        showToast('Error resuming batch download', 2000);
                    }
                } else {
                    log(`ℹ No batch download in progress`);
                    showToast('No batch download to resume', 2000);
                }
            });

            statusContainer.appendChild(downloadTemplatesBtn);
            statusContainer.appendChild(downloadAllBtn);
            statusContainer.appendChild(resetContentBtn);
            statusContainer.appendChild(resumeContentBtn);
        }

        // Questions page buttons
        {
            const downloadAllQuestionsBtn = document.createElement('button');
            downloadAllQuestionsBtn.id = 'cloudradial-download-all-questions-btn';
            downloadAllQuestionsBtn.textContent = 'All';
            downloadAllQuestionsBtn.title = 'Batch download all questions';
            downloadAllQuestionsBtn.style.cssText = `
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
                display: none;
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

            const resetBtn = document.createElement('button');
            resetBtn.id = 'cloudradial-reset-btn';
            resetBtn.textContent = 'Reset';
            resetBtn.title = 'Reset in-progress batch download';
            resetBtn.style.cssText = `
                padding: 4px 10px;
                margin-left: 8px;
                background: #d32f2f !important;
                border: 1px solid #b71c1c !important;
                color: white !important;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                font-weight: 500;
                height: auto;
                line-height: 1;
                display: none;
            `;
            resetBtn.addEventListener('mouseover', () => {
                resetBtn.style.background = '#b71c1c !important';
            });
            resetBtn.addEventListener('mouseout', () => {
                resetBtn.style.background = '#d32f2f !important';
            });
            resetBtn.addEventListener('click', () => {
                const batchState = localStorage.getItem('cloudradial-batch-download');
                if (batchState) {
                    try {
                        const state = JSON.parse(batchState);
                        if (state.type === 'questions') {
                            localStorage.removeItem('cloudradial-batch-download');
                            log(`✓ Questions batch download state cleared`);
                            showToast('Batch download reset');
                            updateButtonVisibility();
                        } else {
                            showToast('No questions batch download to reset', 2000);
                        }
                    } catch (e) {
                        localStorage.removeItem('cloudradial-batch-download');
                        showToast('Batch download state cleared');
                        updateButtonVisibility();
                    }
                } else {
                    log(`ℹ No batch download in progress`);
                    showToast('No batch download to reset', 2000);
                }
            });

            const resumeBtn = document.createElement('button');
            resumeBtn.id = 'cloudradial-resume-btn';
            resumeBtn.textContent = 'Resume';
            resumeBtn.title = 'Resume interrupted batch download';
            resumeBtn.style.cssText = `
                padding: 4px 10px;
                margin-left: 8px;
                background: #ff9800 !important;
                border: 1px solid #f57c00 !important;
                color: white !important;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                font-weight: 500;
                height: auto;
                line-height: 1;
                display: none;
            `;
            resumeBtn.addEventListener('mouseover', () => {
                resumeBtn.style.background = '#f57c00 !important';
            });
            resumeBtn.addEventListener('mouseout', () => {
                resumeBtn.style.background = '#ff9800 !important';
            });
            resumeBtn.addEventListener('click', () => {
                const batchState = localStorage.getItem('cloudradial-batch-download');
                if (batchState) {
                    try {
                        const state = JSON.parse(batchState);
                        if (state.type === 'questions') {
                            const { ids, currentIndex } = state;
                            const nextId = ids[currentIndex];
                            log(`→ Resuming questions batch download at item ${currentIndex + 1}/${ids.length} (ID: ${nextId})`);
                            showToast(`Resuming at ${currentIndex + 1}/${ids.length}...`);
                            history.pushState(null, '', `/app/admin/questions/${nextId}`);
                            window.dispatchEvent(new PopStateEvent('popstate'));
                        } else {
                            showToast('No questions batch download to resume', 2000);
                        }
                    } catch (e) {
                        log(`✗ Error resuming batch download:`, e.message);
                        showToast('Error resuming batch download', 2000);
                    }
                } else {
                    log(`ℹ No batch download in progress`);
                    showToast('No batch download to resume', 2000);
                }
            });

            statusContainer.appendChild(downloadAllQuestionsBtn);
            statusContainer.appendChild(resetBtn);
            statusContainer.appendChild(resumeBtn);
        }

        // Tokens page button
        {
            const downloadPSABtn = document.createElement('button');
            downloadPSABtn.id = 'cloudradial-download-psa-btn';
            downloadPSABtn.textContent = 'Tokens';
            downloadPSABtn.title = 'Download PSA data';
            downloadPSABtn.style.cssText = `
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
                display: none;
            `;
            downloadPSABtn.addEventListener('mouseover', () => {
                downloadPSABtn.style.background = '#0d8c6d !important';
            });
            downloadPSABtn.addEventListener('mouseout', () => {
                downloadPSABtn.style.background = '#10a37f !important';
            });
            downloadPSABtn.addEventListener('click', async () => {
                createAndDownloadZip();
            });

            statusContainer.appendChild(downloadPSABtn);
        }

        // Set initial button visibility based on current page
        updateButtonVisibility();

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
            updateButtonVisibility();
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
        updateButtonVisibility();
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
