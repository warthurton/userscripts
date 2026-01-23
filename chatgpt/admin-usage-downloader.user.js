// ==UserScript==
// @name         ChatGPT Admin Usage Downloader
// @namespace    https://github.com/warthurton/userscripts
// @version      1.6.4
// @description  Auto-download analytics data and statistics from ChatGPT admin usage page
// @author       warthurton
// @match        https://chatgpt.com/admin/usage
// @icon         https://favicons-blue.vercel.app/?domain=chatgpt.com
// @run-at       document-start
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/chatgpt/admin-usage-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/chatgpt/admin-usage-downloader.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function () {
    'use strict';

    let ACCOUNT_ID = null;
    const BASE_URL_PATTERN = '/backend-api/accounts/';

    const ENDPOINTS = [
        { key: 'overview', filename: 'gpt' },
        { key: 'gizmo_overview', filename: 'gizmo' },
        { key: 'tool_overview', filename: 'tool' },
        { key: 'project_overview', filename: 'project' },
        { key: 'connector_overview', filename: 'connector' }
    ];

    // Store intercepted data
    const interceptedData = {};
    const reportingData = {};
    let debugMode = false;
    let debugTimeout = null;
    let authToken = null;
    let downloadButton = null;
    let currentDate = null;
    let debugCheckbox = null;
    let dataLoadStartTime = null;
    let thirtySecondTimeout = null;

    // Version info
    const VERSION = GM_info?.script?.version || '1.6.2';

    /**
     * Update download button state based on captured files
     */
    function updateDownloadButtonState() {
        if (!downloadButton) return;

        const capturedCount = Object.keys(interceptedData).length;
        const allCaptured = capturedCount >= 5;
        
        if (allCaptured) {
            // All 5 files captured - enable with normal styling
            downloadButton.disabled = false;
            downloadButton.style.background = 'linear-gradient(to bottom, #10a37f, #0d8c6d) !important';
            downloadButton.style.cursor = 'pointer';
            downloadButton.style.opacity = '1';
            
            // Clear the 30-second timeout if it exists
            if (thirtySecondTimeout) {
                clearTimeout(thirtySecondTimeout);
                thirtySecondTimeout = null;
            }
        } else {
            // Not all files captured yet
            const elapsed = dataLoadStartTime ? (Date.now() - dataLoadStartTime) / 1000 : 0;
            
            if (elapsed >= 30) {
                // More than 30 seconds - enable but make red
                downloadButton.disabled = false;
                downloadButton.style.background = 'linear-gradient(to bottom, #dc2626, #991b1b) !important';
                downloadButton.style.cursor = 'pointer';
                downloadButton.style.opacity = '1';
            } else {
                // Less than 30 seconds - keep disabled/grayed
                downloadButton.disabled = true;
                downloadButton.style.background = 'linear-gradient(to bottom, #9ca3af, #6b7280) !important';
                downloadButton.style.cursor = 'not-allowed';
                downloadButton.style.opacity = '0.6';
            }
        }
    }

    /**
     * Reset debug timer - auto-disable debug after 5 minutes
     */
    function resetDebugTimer() {
        if (debugTimeout) {
            clearTimeout(debugTimeout);
        }
        if (debugMode) {
            debugTimeout = setTimeout(() => {
                debugMode = false;
                if (debugCheckbox) {
                    debugCheckbox.checked = false;
                }
                console.log('[Analytics Downloader] Debug mode auto-disabled after 5 minutes of inactivity');
            }, 5 * 60 * 1000); // 5 minutes
        }
    }

    /**
     * Extract statistics from the page DOM
     */
    function extractPageStatistics() {
        if (debugMode) console.log('[Analytics Downloader] Extracting page statistics...');
        const now = new Date();
        const localTimestamp = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, -1);
        const stats = {
            timestamp: localTimestamp,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            metrics: {}
        };

        try {
            // Strategy 1: Look for text-xl elements (the values) and traverse up to find the container
            const valueElements = document.querySelectorAll('.text-xl');
            if (debugMode) console.log(`[Analytics Downloader] Found ${valueElements.length} .text-xl elements`);
            
            if (valueElements.length === 0) {
                if (debugMode) console.warn('[Analytics Downloader] No .text-xl elements found - the page may not be fully loaded');
                return stats;
            }
            
            let processedCount = 0;
            for (const valueEl of valueElements) {
                try {
                    // Look for the parent container with the metric structure
                    let parent = valueEl.closest('.flex.w-0.grow.flex-col.justify-between');
                    if (!parent) {
                        parent = valueEl.closest('div[class*="flex"][class*="flex-col"]');
                    }
                    
                    if (!parent) {
                        if (debugMode) console.log('[Analytics Downloader] No parent found for .text-xl element:', valueEl.textContent.trim());
                        continue;
                    }
                    
                    // Get label - look for text-sm with secondary color
                    const labelElement = parent.querySelector('.text-token-text-secondary.text-sm, .text-sm');
                    if (!labelElement) {
                        if (debugMode) console.log('[Analytics Downloader] No label element found in parent');
                        continue;
                    }
                    
                    const label = labelElement.textContent.trim();
                    
                    // Skip if label doesn't look like a metric we want
                    if (!label || label.length > 50) {
                        if (debugMode) console.log('[Analytics Downloader] Skipping label (too long or empty):', label);
                        continue;
                    }
                    
                    const value = valueEl.textContent.trim();
                    if (debugMode) console.log(`[Analytics Downloader] Processing: label="${label}", value="${value}"`);
                    
                    // Get comparison percentage if exists
                    let comparison = null;
                    const comparisonContainer = parent.querySelector('.inline-flex.items-center[class*="text-green"], .inline-flex.items-center[class*="text-red"]');
                    if (comparisonContainer) {
                        const percentageSpans = comparisonContainer.querySelectorAll('span');
                        for (const span of percentageSpans) {
                            const text = span.textContent.trim();
                            if (text.includes('%')) {
                                comparison = {
                                    percentage: text,
                                    trend: comparisonContainer.className.includes('green') ? 'positive' : 'negative'
                                };
                                if (debugMode) console.log(`[Analytics Downloader] Found comparison: ${text} (${comparison.trend})`);
                                break;
                            }
                        }
                    }
                    
                    // Create a key from the label (lowercase, replace spaces with underscores)
                    const key = label.toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');
                    
                    if (key && value) {
                        stats.metrics[key] = {
                            label: label,
                            value: value
                        };
                        
                        if (comparison) {
                            stats.metrics[key].comparison = comparison;
                        }
                        
                        processedCount++;
                        if (debugMode) console.log(`[Analytics Downloader] ✓ Captured metric #${processedCount}: ${label} = ${value}`, comparison || '');
                    }
                } catch (innerError) {
                    console.error('[Analytics Downloader] Error processing value element:', innerError);
                }
            }

            const metricCount = Object.keys(stats.metrics).length;
            if (debugMode) console.log(`[Analytics Downloader] Extracted ${metricCount} metrics total`);
            
            if (metricCount === 0 && debugMode) {
                console.warn('[Analytics Downloader] No statistics found on page. Make sure you are on the usage page and the statistics section is loaded.');
                console.log('[Analytics Downloader] DOM structure sample:', document.body.innerHTML.substring(0, 500));
            }
        } catch (error) {
            console.error('[Analytics Downloader] Error in extractPageStatistics:', error);
            console.error('[Analytics Downloader] Stack trace:', error.stack);
        }

        return stats;
    }

    /**
     * Create and download a zip file with all collected data
     * @param {boolean} fetchMissing - If true, will attempt to fetch missing reporting data
     */
    async function createAndDownloadZip(fetchMissing = false) {
        const zip = new JSZip();
        let count = 0;
        const orgPrefix = getOrgPrefix();
        const startDate = Object.values(interceptedData)[0]?.startDate || '2026-01-01';

        // Add intercepted analytics data to zip
        for (const key in interceptedData) {
            const item = interceptedData[key];
            zip.file(item.filename, JSON.stringify(item.data, null, 2));
            count++;
        }

        // Add intercepted reporting data to zip
        for (const key in reportingData) {
            const item = reportingData[key];
            // Prefer CSV over JSON
            if (item.csvData) {
                zip.file(item.csvFilename, item.csvData);
            } else {
                zip.file(item.jsonFilename, JSON.stringify(item.jsonData, null, 2));
            }
            count++;
        }

        // Extract and add page statistics
        try {
            const pageStats = extractPageStatistics();
            if (debugMode) {
                console.log('[Analytics Downloader] Page stats extraction complete');
                console.log('[Analytics Downloader] Page stats result:', JSON.stringify(pageStats, null, 2));
            }
            
            if (pageStats.metrics && Object.keys(pageStats.metrics).length > 0) {
                const statsFilename = `${orgPrefix}chatgpt-statistics-${startDate}.json`;
                zip.file(statsFilename, JSON.stringify(pageStats, null, 2));
                count++;
                if (debugMode) console.log('[Analytics Downloader] ✓ Successfully added page statistics to zip:', statsFilename);
            } else {
                if (debugMode) console.warn('[Analytics Downloader] ⚠ No page statistics to add - metrics object is empty');
            }
        } catch (statsError) {
            console.error('[Analytics Downloader] Error extracting or adding page statistics:', statsError);
            if (debugMode) console.error('[Analytics Downloader] Stack trace:', statsError.stack);
        }

        // Reset debug timer
        resetDebugTimer();

        // Fetch missing reporting data if requested
        if (fetchMissing) {
            const reportTypes = ['user', 'gpt'];
            // Get fresh startDate from intercepted data when fetching
            const fetchStartDate = Object.values(interceptedData)[0]?.startDate || startDate;

            if (!authToken) {
                console.warn('[Analytics Downloader] No auth token available yet. Try again after page loads analytics data.');
            }

            if (!ACCOUNT_ID) {
                console.warn('[Analytics Downloader] No account ID available yet. Try again after page loads analytics data.');
            }

            for (const reportType of reportTypes) {
                if (!reportingData[reportType] && ACCOUNT_ID) {
                    try {
                        const reportUrl = `https://chatgpt.com/backend-api/accounts/${ACCOUNT_ID}/reporting?period=monthly&period_start=${fetchStartDate}&report_type=${reportType}`;
                        if (debugMode) console.log(`[Analytics Downloader] Fetching reporting data: ${reportType}`);

                        const headers = {};
                        if (authToken) {
                            headers['Authorization'] = authToken;
                        }

                        const response = await fetch(reportUrl, { headers });
                        if (response.ok) {
                            const data = await response.json();

                            // Try to get CSV content or convert to CSV
                            let filename;
                            if (data.csv_content) {
                                filename = `${orgPrefix}chatgpt-${reportType}-${fetchStartDate}.csv`;
                                zip.file(filename, data.csv_content);
                            } else if (Array.isArray(data)) {
                                const csvContent = jsonToCSV(data);
                                filename = `${orgPrefix}chatgpt-${reportType}-${fetchStartDate}.csv`;
                                zip.file(filename, csvContent);
                            } else if (data.data && Array.isArray(data.data)) {
                                const csvContent = jsonToCSV(data.data);
                                filename = `${orgPrefix}chatgpt-${reportType}-${fetchStartDate}.csv`;
                                zip.file(filename, csvContent);
                            } else {
                                // Fallback to JSON if can't convert to CSV
                                filename = `${orgPrefix}chatgpt-${reportType}-${fetchStartDate}.json`;
                                zip.file(filename, JSON.stringify(data, null, 2));
                            }
                            count++;
                            if (debugMode) console.log(`[Analytics Downloader] Added to zip: ${filename}`);
                        } else {
                            if (debugMode) console.warn(`[Analytics Downloader] Failed to fetch ${reportType}: ${response.status}`);
                        }
                    } catch (error) {
                        console.error(`[Analytics Downloader] Error fetching reporting ${reportType}:`, error);
                    }
                }
            }
        }

        if (count > 0) {
            // Show generating message if fetching missing data
            if (fetchMissing) {
                showToast(`Generating zip with ${count} file(s)...`);
            }

            // Generate and download the zip file
            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${orgPrefix}chatgpt-analytics-${startDate}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showToast(`Downloaded ${count} file(s) as zip`);
            return count;
        } else {
            if (fetchMissing) {
                showToast('No data available yet. Please wait for the page to load analytics data.', 4000);
            }
            return 0;
        }
    }

    /**
     * Show toast message in UI
     */
    function showToast(message, duration = 3000) {
        const toast = document.getElementById('analytics-toast');
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

    // Function to download JSON data
    function downloadJSON(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Function to download CSV data
    function downloadCSV(data, filename) {
        const blob = new Blob([data], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Convert JSON array to CSV
    function jsonToCSV(data) {
        if (!Array.isArray(data) || data.length === 0) {
            return '';
        }

        // Get all unique keys from all objects
        const keys = [...new Set(data.flatMap(obj => Object.keys(obj)))];

        // Create header row
        const header = keys.join(',');

        // Create data rows
        const rows = data.map(obj => {
            return keys.map(key => {
                const value = obj[key];
                // Handle null/undefined
                if (value === null || value === undefined) return '';
                // Escape and quote strings that contain commas, quotes, or newlines
                const stringValue = String(value);
                if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                    return `"${stringValue.replace(/"/g, '""')}"`;
                }
                return stringValue;
            }).join(',');
        });

        return [header, ...rows].join('\n');
    }

    // Get organization name prefix from page
    function getOrgPrefix() {
        try {
            const element = document.evaluate(
                '//*[@id="stage-slideover-sidebar"]/div/div[2]/nav/div[2]/div[1]/div[2]/h2',
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;

            if (element && element.textContent) {
                const firstWord = element.textContent.trim().split(/\s+/)[0];
                return firstWord ? `${firstWord}-` : '';
            }
        } catch (e) {
            console.warn('[Analytics Downloader] Could not extract org prefix:', e);
        }
        return '';
    }

    // Extract account ID from URL
    function extractAccountId(url) {
        const match = url.match(/\/backend-api\/accounts\/([a-f0-9-]+)\//i);
        return match ? match[1] : null;
    }

    // Extract start_date parameter from URL
    function getStartDateFromUrl(url) {
        const urlObj = new URL(url);
        return urlObj.searchParams.get('start_date');
    }

    // Intercept fetch requests
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

        // Extract account ID and auth token from request headers
        if (url && (url.includes('/analytics/') || url.includes('/reporting'))) {
            // Extract account ID if not already set
            if (!ACCOUNT_ID) {
                const accountId = extractAccountId(url);
                if (accountId) {
                    ACCOUNT_ID = accountId;
                    if (debugMode) console.log('[Analytics Downloader] Account ID captured:', ACCOUNT_ID);
                }
            }

            const requestInit = typeof args[0] === 'string' ? args[1] : args[0];
            if (requestInit?.headers) {
                const headers = requestInit.headers;
                if (headers instanceof Headers) {
                    const auth = headers.get('Authorization');
                    if (auth && !authToken) {
                        authToken = auth;
                        if (debugMode) console.log('[Analytics Downloader] Auth token captured');
                    }
                } else if (typeof headers === 'object') {
                    const auth = headers['Authorization'] || headers['authorization'];
                    if (auth && !authToken) {
                        authToken = auth;
                        if (debugMode) console.log('[Analytics Downloader] Auth token captured');
                    }
                }
            }
        }

        if (debugMode && (url?.includes('/analytics/') || url?.includes('/reporting'))) {
            console.log('[Analytics Downloader] Fetch detected:', url);
        }

        const response = await originalFetch.apply(this, args);

        // Check if this is a reporting endpoint
        if (url && url.includes('/reporting')) {
            const urlObj = new URL(url);
            const reportType = urlObj.searchParams.get('report_type');
            const periodStart = urlObj.searchParams.get('period_start');

            if (reportType && periodStart) {
                if (debugMode) console.log(`[Analytics Downloader] Intercepted reporting ${reportType}:`, url);

                try {
                    const clonedResponse = response.clone();
                    const data = await clonedResponse.json();

                    if (debugMode) console.log(`[Analytics Downloader] Reporting data received for ${reportType}:`, data);

                    const orgPrefix = getOrgPrefix();
                    let csvContent = null;
                    let jsonData = null;

                    // Check if response has csv_content (from API)
                    if (data.csv_content) {
                        csvContent = data.csv_content;
                    }
                    // Otherwise convert JSON to CSV if it's an array
                    else if (Array.isArray(data)) {
                        csvContent = jsonToCSV(data);
                        jsonData = data;
                    }
                    // Or if it has a data property that's an array
                    else if (data.data && Array.isArray(data.data)) {
                        csvContent = jsonToCSV(data.data);
                        jsonData = data.data;
                    }
                    // Otherwise just store the JSON
                    else {
                        jsonData = data;
                    }

                    // Store the reporting data (use analytics startDate for consistency)
                    // Get the most common startDate from all intercepted analytics data
                    let analyticsStartDate = periodStart;
                    const startDates = Object.values(interceptedData).map(item => item.startDate).filter(Boolean);
                    if (startDates.length > 0) {
                        // Use the first analytics date (they should all be the same)
                        analyticsStartDate = startDates[0];
                    }

                    reportingData[reportType] = {
                        csvData: csvContent,
                        jsonData: jsonData || data,
                        periodStart: analyticsStartDate,
                        csvFilename: `${orgPrefix}chatgpt-${reportType}-${analyticsStartDate}.csv`,
                        jsonFilename: `${orgPrefix}chatgpt-${reportType}-${analyticsStartDate}.json`
                    };
                } catch (error) {
                    console.error(`[Analytics Downloader] Error processing reporting ${reportType}:`, error);
                }
            }
        }

        // Check if this is one of our target endpoints
        for (const endpoint of ENDPOINTS) {
            if (url && url.includes(`/analytics/${endpoint.key}`)) {
                if (debugMode) console.log(`[Analytics Downloader] Intercepted ${endpoint.key}:`, url);

                const startDate = getStartDateFromUrl(url);
                if (startDate) {
                    // Check if date changed - clear old data if so
                    if (currentDate && currentDate !== startDate) {
                        if (debugMode) console.log(`[Analytics Downloader] Date changed from ${currentDate} to ${startDate}, clearing old data`);
                        // Clear old intercepted data
                        Object.keys(interceptedData).forEach(key => delete interceptedData[key]);
                        Object.keys(reportingData).forEach(key => delete reportingData[key]);
                        // Reset debug timer on date change
                        resetDebugTimer();
                        // Reset data load timer
                        dataLoadStartTime = Date.now();
                        if (thirtySecondTimeout) {
                            clearTimeout(thirtySecondTimeout);
                        }
                        // Set 30-second timeout to enable button in red if not all files loaded
                        thirtySecondTimeout = setTimeout(() => {
                            updateDownloadButtonState();
                        }, 30000);
                    }
                    
                    // Start timer on first data capture
                    if (!dataLoadStartTime) {
                        dataLoadStartTime = Date.now();
                        // Set 30-second timeout to enable button in red if not all files loaded
                        thirtySecondTimeout = setTimeout(() => {
                            updateDownloadButtonState();
                        }, 30000);
                    }
                    
                    currentDate = startDate;

                    try {
                        const clonedResponse = response.clone();
                        const data = await clonedResponse.json();

                        if (debugMode) console.log(`[Analytics Downloader] Data received for ${endpoint.key}:`, data);

                        const orgPrefix = getOrgPrefix();

                        // Store the data
                        interceptedData[endpoint.key] = {
                            data: data,
                            startDate: startDate,
                            filename: `${orgPrefix}${endpoint.filename}-${startDate}.json`
                        };
                        
                        // Update button state after capturing data
                        updateDownloadButtonState();
                    } catch (error) {
                        console.error(`[Analytics Downloader] Error processing ${endpoint.key}:`, error);
                    }
                } else {
                    console.warn(`[Analytics Downloader] No start_date found in URL: ${url}`);
                }
                break;
            }
        }

        return response;
    };

    // Intercept XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._url = url;
        if (debugMode && url?.includes('/analytics/')) {
            console.log('[Analytics Downloader] XHR detected:', url);
        }
        return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener('load', function () {
            const url = this._url;

            // Check if this is one of our target endpoints
            for (const endpoint of ENDPOINTS) {
                if (url && url.includes(`/analytics/${endpoint.key}`)) {
                    if (debugMode) console.log(`[Analytics Downloader] XHR Intercepted ${endpoint.key}:`, url);

                    const startDate = getStartDateFromUrl(url);
                    if (startDate && this.status === 200) {
                        // Check if date changed - clear old data if so
                        if (currentDate && currentDate !== startDate) {
                            if (debugMode) console.log(`[Analytics Downloader] Date changed from ${currentDate} to ${startDate}, clearing old data`);
                            // Clear old intercepted data
                            Object.keys(interceptedData).forEach(key => delete interceptedData[key]);
                            Object.keys(reportingData).forEach(key => delete reportingData[key]);
                            // Reset debug timer on date change
                            resetDebugTimer();
                            // Reset data load timer
                            dataLoadStartTime = Date.now();
                            if (thirtySecondTimeout) {
                                clearTimeout(thirtySecondTimeout);
                            }
                            thirtySecondTimeout = setTimeout(() => {
                                updateDownloadButtonState();
                            }, 30000);
                        }
                        
                        // Start timer on first data capture
                        if (!dataLoadStartTime) {
                            dataLoadStartTime = Date.now();
                            thirtySecondTimeout = setTimeout(() => {
                                updateDownloadButtonState();
                            }, 30000);
                        }
                        
                        currentDate = startDate;

                        try {
                            const data = JSON.parse(this.responseText);

                            if (debugMode) console.log(`[Analytics Downloader] XHR Data received for ${endpoint.key}:`, data);

                            const orgPrefix = getOrgPrefix();

                            // Store the data
                            interceptedData[endpoint.key] = {
                                data: data,
                                startDate: startDate,
                                filename: `${orgPrefix}chatgpt-${endpoint.filename}-${startDate}.json`
                            };
                            
                            // Update button state after capturing data
                            updateDownloadButtonState();
                        } catch (error) {
                            console.error(`[Analytics Downloader] Error processing XHR ${endpoint.key}:`, error);
                        }
                    } else if (!startDate) {
                        console.warn(`[Analytics Downloader] No start-date found in XHR URL: ${url}`);
                    }
                    break;
                }
            }
        });

        return originalSend.apply(this, args);
    };

    // Create UI
    function createUI() {
        // Create info display to go under date picker
        const infoContainer = document.createElement('div');
        infoContainer.id = 'analytics-downloader-info';
        infoContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 11px;
            color: #666;
            padding: 4px 0;
            margin-top: 4px;
        `;

        const info = document.createElement('div');
        info.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        info.innerHTML = '<span style="color: #10a37f; font-weight: 500;">📊</span><span>Date: <span style="color: #999;">waiting...</span> | Files: <span style="color: #10a37f; font-weight: 600;">0</span></span>';
        info.id = 'data-count-info';

        // Debug checkbox
        const debugLabel = document.createElement('label');
        debugLabel.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 10px;
            color: #999;
            cursor: pointer;
            user-select: none;
        `;
        
        debugCheckbox = document.createElement('input');
        debugCheckbox.type = 'checkbox';
        debugCheckbox.checked = false;
        debugCheckbox.style.cssText = `
            cursor: pointer;
            margin: 0;
        `;
        debugCheckbox.addEventListener('change', () => {
            debugMode = debugCheckbox.checked;
            console.log(`[Analytics Downloader] Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
            showToast(`Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
            resetDebugTimer();
        });
        
        const debugLabelText = document.createElement('span');
        debugLabelText.textContent = 'debug';
        debugLabel.title = 'Enable debug logs in console (auto-disables after 5 min)';
        debugLabel.appendChild(debugCheckbox);
        debugLabel.appendChild(debugLabelText);

        infoContainer.appendChild(info);
        infoContainer.appendChild(debugLabel);

        // Create download button to go under Export button
        downloadButton = document.createElement('button');
        downloadButton.className = 'btn relative btn-secondary btn-small ms-2';
        downloadButton.disabled = true; // Start disabled
        downloadButton.style.cssText = `
            background: linear-gradient(to bottom, #9ca3af, #6b7280) !important;
            border-color: #9ca3af !important;
            color: white !important;
            cursor: not-allowed !important;
            opacity: 0.6 !important;
        `;
        downloadButton.innerHTML = '<div class="flex items-center justify-center">Download Zip</div>';
        downloadButton.addEventListener('mouseover', () => {
            if (!downloadButton.disabled) {
                const isRed = downloadButton.style.background.includes('dc2626');
                if (isRed) {
                    downloadButton.style.background = 'linear-gradient(to bottom, #b91c1c, #7f1d1d) !important';
                } else {
                    downloadButton.style.background = 'linear-gradient(to bottom, #0d8c6d, #0a7558) !important';
                }
            }
        });
        downloadButton.addEventListener('mouseout', () => {
            if (!downloadButton.disabled) {
                const isRed = downloadButton.style.background.includes('b91c1c') || downloadButton.style.background.includes('7f1d1d');
                if (isRed) {
                    downloadButton.style.background = 'linear-gradient(to bottom, #dc2626, #991b1b) !important';
                } else {
                    downloadButton.style.background = 'linear-gradient(to bottom, #10a37f, #0d8c6d) !important';
                }
            }
        });
        downloadButton.addEventListener('click', async () => {
            if (!downloadButton.disabled) {
                await createAndDownloadZip(true);
            }
        });

        // Toast notification
        const toast = document.createElement('div');
        toast.id = 'analytics-toast';
        toast.style.cssText = `
            position: fixed;
            top: 20px;
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

        // Function to try inserting elements
        function tryInsertElements() {
            // Find the date picker container
            const datePickerButtons = document.querySelectorAll('.flex.items-stretch button');
            let datePickerContainer = null;

            for (const btn of datePickerButtons) {
                if (btn.textContent.match(/[A-Z][a-z]{2}\s+\d{4}/)) { // Matches "Aug 2025" pattern
                    datePickerContainer = btn.closest('.flex.items-stretch');
                    break;
                }
            }

            // Insert info under date picker
            if (datePickerContainer && !document.getElementById('analytics-downloader-info')) {
                const parentContainer = datePickerContainer.parentElement;
                if (parentContainer) {
                    // Insert after the date picker's parent flex container
                    parentContainer.parentElement.insertBefore(infoContainer, parentContainer.nextSibling);
                    if (debugMode) console.log('[Analytics Downloader] Info display inserted under date picker');
                }
            }

            // Find Export button and insert Download button after it
            const exportButton = Array.from(document.querySelectorAll('button')).find(btn =>
                btn.textContent.includes('Export')
            );

            if (exportButton && !document.querySelector('#analytics-download-btn')) {
                downloadButton.id = 'analytics-download-btn';
                exportButton.parentElement.appendChild(downloadButton);
                if (debugMode) console.log('[Analytics Downloader] Download button inserted after Export button');
            }
        }

        // Try immediately and with retries
        tryInsertElements();
        setTimeout(tryInsertElements, 500);
        setTimeout(tryInsertElements, 1000);
        setTimeout(tryInsertElements, 2000);

        // Watch for DOM changes to re-insert if needed (e.g., page navigation)
        const observer = new MutationObserver(() => {
            if (!document.getElementById('analytics-downloader-info') || !document.querySelector('#analytics-download-btn')) {
                tryInsertElements();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // Update data count periodically
        setInterval(() => {
            const dateDisplay = currentDate ? `<span style="color: #10a37f; font-weight: 600;">${currentDate}</span>` : '<span style="color: #999;">waiting...</span>';

            // Count only analytics files matching current date (reports not included)
            let analyticsCount = 0;
            if (currentDate) {
                analyticsCount = Object.values(interceptedData).filter(item => item.startDate === currentDate).length;
            }

            const fileCount = `<span style="color: #10a37f; font-weight: 600;">${analyticsCount}</span>`;
            info.innerHTML = `<span style="color: #10a37f; font-weight: 500;">📊</span><span>Date: ${dateDisplay} | Files: ${fileCount}</span>`;
        }, 500);
    }

    // Wait for page to load before creating UI
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }

    // Always log version on load
    console.log(`[Analytics Downloader] v${VERSION} loaded`);
    if (debugMode) {
        console.log('[Analytics Downloader] Looking for URLs matching:', BASE_URL_PATTERN);
        console.log('[Analytics Downloader] Endpoints:', ENDPOINTS.map(e => e.key).join(', '));
    }
})();
// test comment
