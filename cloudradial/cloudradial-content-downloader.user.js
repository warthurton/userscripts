// ==UserScript==
// @name         CloudRadial Content Downloader
// @namespace    https://github.com/warthurton/userscripts
// @version      1.0
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

            console.log(`[CloudRadial Content Downloader] Downloaded zip with ${count} file(s)`);
            showToast(`Downloaded ${count} file(s) as zip`);
            
            // If in batch download mode, continue to next item
            const batchState = localStorage.getItem('cloudradial-batch-download');
            if (batchState) {
                setTimeout(() => continueNextBatchDownload(), 2000);
            }
            
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

        if (newContentId && newContentId !== currentContentId) {
            const currentPage = getCurrentPageType();
            const itemType = currentPage === 'questions' ? 'Question' : 'Content';
            console.log(`[CloudRadial Content Downloader] ${itemType} ID changed to: ${newContentId}`);
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
            const currentPage = getCurrentPageType();
            const expectedCount = currentPage === 'content' ? 3 : 1;
            const dataCount = Object.keys(interceptedData).length;
            
            if (dataCount > 0 && dataCount < expectedCount) {
                console.log(`[CloudRadial Content Downloader] Auto-download triggered with ${dataCount}/${expectedCount} files`);
                showToast(`Auto-downloading ${dataCount} available file(s)...`);
                createAndDownloadZip();
            } else if (dataCount >= expectedCount) {
                console.log(`[CloudRadial Content Downloader] Auto-download triggered with all ${dataCount} files`);
                showToast('All data received, downloading...');
                createAndDownloadZip();
            }
        }, 10000);
    }

    /**
     * Check if all data is collected and download
     */
    function checkAndDownloadIfComplete() {
        const currentPage = getCurrentPageType();
        const expectedCount = currentPage === 'content' ? 3 : 1; // Content needs 3 APIs, others need 1
        
        if (Object.keys(interceptedData).length >= expectedCount) {
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
        if (!batchState) return;

        try {
            const state = JSON.parse(batchState);
            const { ids, currentIndex } = state;

            // Check if batch download timed out (over 1 hour old)
            if (Date.now() - state.startTime > 3600000) {
                console.log('[CloudRadial Content Downloader] Batch download timed out, clearing state');
                localStorage.removeItem('cloudradial-batch-download');
                return;
            }

            console.log(`[CloudRadial Content Downloader] Batch download in progress: ${currentIndex + 1}/${ids.length}`);
            
            // Wait for auto-download to complete, then move to next
            // We'll check after the download completes
        } catch (error) {
            console.error('[CloudRadial Content Downloader] Error parsing batch state:', error);
            localStorage.removeItem('cloudradial-batch-download');
        }
    }

    /**
     * Move to next item in batch download
     */
    function continueNextBatchDownload() {
        const batchState = localStorage.getItem('cloudradial-batch-download');
        if (!batchState) return;

        try {
            const state = JSON.parse(batchState);
            const { ids, currentIndex, type = 'content' } = state;
            const nextIndex = currentIndex + 1;

            if (nextIndex >= ids.length) {
                // Batch complete
                console.log('[CloudRadial Content Downloader] Batch download complete!');
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
            
            console.log(`[CloudRadial Content Downloader] Moving to next ${itemType} ${nextId} (${nextIndex + 1}/${ids.length})...`);
            showToast(`Downloading ${nextIndex + 1}/${ids.length}...`);
            
            // Small delay before navigation
            setTimeout(() => {
                window.location.href = `${urlPath}/${nextId}`;
            }, 1000);
        } catch (error) {
            console.error('[CloudRadial Content Downloader] Error in batch continuation:', error);
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

        // Try immediately and with retries
        tryInsertIntoNavbar();
        setTimeout(tryInsertIntoNavbar, 500);
        setTimeout(tryInsertIntoNavbar, 1000);

        // Add download buttons if on root content page
        if (isRootContentPage()) {
            // Container for buttons
            const btnContainer = document.createElement('div');
            btnContainer.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                display: flex;
                gap: 10px;
                z-index: 10000;
            `;

            // Download templates button
            const downloadTemplatesBtn = document.createElement('button');
            downloadTemplatesBtn.id = 'cloudradial-download-templates-btn';
            downloadTemplatesBtn.textContent = 'Download Templates';
            downloadTemplatesBtn.style.cssText = `
                padding: 12px 20px;
                background: linear-gradient(to bottom, #10a37f, #0d8c6d) !important;
                border: 1px solid #10a37f !important;
                color: white !important;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 600;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            `;
            downloadTemplatesBtn.addEventListener('mouseover', () => {
                downloadTemplatesBtn.style.background = 'linear-gradient(to bottom, #0d8c6d, #0a7558) !important';
            });
            downloadTemplatesBtn.addEventListener('mouseout', () => {
                downloadTemplatesBtn.style.background = 'linear-gradient(to bottom, #10a37f, #0d8c6d) !important';
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

            // Download all button
            const downloadAllBtn = document.createElement('button');
            downloadAllBtn.id = 'cloudradial-download-all-btn';
            downloadAllBtn.textContent = 'Download All Content';
            downloadAllBtn.style.cssText = `
                padding: 12px 20px;
                background: linear-gradient(to bottom, #10a37f, #0d8c6d) !important;
                border: 1px solid #10a37f !important;
                color: white !important;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 600;
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
                downloadAllBtn.textContent = 'Download All Content';
            });

            btnContainer.appendChild(downloadTemplatesBtn);
            btnContainer.appendChild(downloadAllBtn);
            document.body.appendChild(btnContainer);
        }

        // Add download all button for questions list page
        if (isQuestionsListPage()) {
            const btnContainer = document.createElement('div');
            btnContainer.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                display: flex;
                gap: 10px;
                z-index: 10000;
            `;

            const downloadAllQuestionsBtn = document.createElement('button');
            downloadAllQuestionsBtn.id = 'cloudradial-download-all-questions-btn';
            downloadAllQuestionsBtn.textContent = 'Download All Questions';
            downloadAllQuestionsBtn.style.cssText = `
                padding: 12px 20px;
                background: linear-gradient(to bottom, #10a37f, #0d8c6d) !important;
                border: 1px solid #10a37f !important;
                color: white !important;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 600;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            `;
            downloadAllQuestionsBtn.addEventListener('mouseover', () => {
                downloadAllQuestionsBtn.style.background = 'linear-gradient(to bottom, #0d8c6d, #0a7558) !important';
            });
            downloadAllQuestionsBtn.addEventListener('mouseout', () => {
                downloadAllQuestionsBtn.style.background = 'linear-gradient(to bottom, #10a37f, #0d8c6d) !important';
            });
            downloadAllQuestionsBtn.addEventListener('click', async () => {
                downloadAllQuestionsBtn.disabled = true;
                downloadAllQuestionsBtn.textContent = 'Processing...';
                await downloadAllQuestions();
                downloadAllQuestionsBtn.disabled = false;
                downloadAllQuestionsBtn.textContent = 'Download All Questions';
            });

            btnContainer.appendChild(downloadAllQuestionsBtn);
            document.body.appendChild(btnContainer);
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
