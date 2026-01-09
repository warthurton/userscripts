// ==UserScript==
// @name         ChatGPT Admin Usage Downloader
// @namespace    http://tampermonkey.net/
// @version      1.0.17
// @description  Auto-download analytics data from ChatGPT admin usage page
// @author       Your Name
// @match        https://chatgpt.com/admin/usage
// @grant        none
// @run-at       document-start
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// ==/UserScript==

(function() {
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
    let debugMode = true;
    let authToken = null;
    let downloadButton = null;
    let currentDate = null;

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
                        console.log(`[Analytics Downloader] Fetching reporting data: ${reportType}`);
                        
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
                            console.log(`[Analytics Downloader] Added to zip: ${filename}`);
                        } else {
                            console.warn(`[Analytics Downloader] Failed to fetch ${reportType}: ${response.status}`);
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
            
            console.log(`[Analytics Downloader] Downloaded zip with ${count} file(s)`);
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
    window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        
        // Extract account ID and auth token from request headers
        if (url && (url.includes('/analytics/') || url.includes('/reporting'))) {
            // Extract account ID if not already set
            if (!ACCOUNT_ID) {
                const accountId = extractAccountId(url);
                if (accountId) {
                    ACCOUNT_ID = accountId;
                    console.log('[Analytics Downloader] Account ID captured:', ACCOUNT_ID);
                }
            }
            
            const requestInit = typeof args[0] === 'string' ? args[1] : args[0];
            if (requestInit?.headers) {
                const headers = requestInit.headers;
                if (headers instanceof Headers) {
                    const auth = headers.get('Authorization');
                    if (auth && !authToken) {
                        authToken = auth;
                        console.log('[Analytics Downloader] Auth token captured');
                    }
                } else if (typeof headers === 'object') {
                    const auth = headers['Authorization'] || headers['authorization'];
                    if (auth && !authToken) {
                        authToken = auth;
                        console.log('[Analytics Downloader] Auth token captured');
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
                console.log(`[Analytics Downloader] Intercepted reporting ${reportType}:`, url);
                
                try {
                    const clonedResponse = response.clone();
                    const data = await clonedResponse.json();
                    
                    console.log(`[Analytics Downloader] Reporting data received for ${reportType}:`, data);
                    
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
                console.log(`[Analytics Downloader] Intercepted ${endpoint.key}:`, url);
                
                const startDate = getStartDateFromUrl(url);
                if (startDate) {
                    // Check if date changed - clear old data if so
                    if (currentDate && currentDate !== startDate) {
                        console.log(`[Analytics Downloader] Date changed from ${currentDate} to ${startDate}, clearing old data`);
                        // Clear old intercepted data
                        Object.keys(interceptedData).forEach(key => delete interceptedData[key]);
                        Object.keys(reportingData).forEach(key => delete reportingData[key]);
                    }
                    currentDate = startDate;
                    
                    try {
                        const clonedResponse = response.clone();
                        const data = await clonedResponse.json();
                        
                        console.log(`[Analytics Downloader] Data received for ${endpoint.key}:`, data);
                        
                        const orgPrefix = getOrgPrefix();
                        
                        // Store the data
                        interceptedData[endpoint.key] = {
                            data: data,
                            startDate: startDate,
                            filename: `${orgPrefix}${endpoint.filename}-${startDate}.json`
                        };
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
    
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._url = url;
        if (debugMode && url?.includes('/analytics/')) {
            console.log('[Analytics Downloader] XHR detected:', url);
        }
        return originalOpen.apply(this, [method, url, ...rest]);
    };
    
    XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
            const url = this._url;
            
            // Check if this is one of our target endpoints
            for (const endpoint of ENDPOINTS) {
                if (url && url.includes(`/analytics/${endpoint.key}`)) {
                    console.log(`[Analytics Downloader] XHR Intercepted ${endpoint.key}:`, url);
                    
                    const startDate = getStartDateFromUrl(url);
                    if (startDate && this.status === 200) {
                        // Check if date changed - clear old data if so
                        if (currentDate && currentDate !== startDate) {
                            console.log(`[Analytics Downloader] Date changed from ${currentDate} to ${startDate}, clearing old data`);
                            // Clear old intercepted data
                            Object.keys(interceptedData).forEach(key => delete interceptedData[key]);
                            Object.keys(reportingData).forEach(key => delete reportingData[key]);
                        }
                        currentDate = startDate;
                        
                        try {
                            const data = JSON.parse(this.responseText);
                            
                            console.log(`[Analytics Downloader] XHR Data received for ${endpoint.key}:`, data);
                            
                            const orgPrefix = getOrgPrefix();
                            
                            // Store the data
                            interceptedData[endpoint.key] = {
                                data: data,
                                startDate: startDate,
                                filename: `${orgPrefix}chatgpt-${endpoint.filename}-${startDate}.json`
                            };
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
        const container = document.createElement('div');
        container.id = 'analytics-downloader-ui';
        container.style.cssText = `
            background: white;
            border: 2px solid #10a37f;
            border-radius: 8px;
            padding: 15px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            min-width: 250px;
        `;

        const title = document.createElement('div');
        title.textContent = 'Analytics Downloader';
        title.style.cssText = `
            font-weight: bold;
            margin-bottom: 10px;
            color: #10a37f;
            font-size: 14px;
        `;

        downloadButton = document.createElement('button');
        downloadButton.textContent = 'Download';
        downloadButton.style.cssText = `
            background: #10a37f;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 8px 16px;
            cursor: pointer;
            font-size: 13px;
            width: 100%;
            font-weight: 500;
        `;
        downloadButton.addEventListener('mouseover', () => {
            downloadButton.style.background = '#0d8c6d';
        });
        downloadButton.addEventListener('mouseout', () => {
            downloadButton.style.background = '#10a37f';
        });
        downloadButton.addEventListener('click', async () => {
            await createAndDownloadZip(true);
        });

        const info = document.createElement('div');
        info.style.cssText = `
            font-size: 11px;
            color: #666;
            margin-top: 10px;
            line-height: 1.4;
        `;
        info.innerHTML = 'Date: <span style="color: #999;">waiting...</span><br>Data files: 0';
        info.id = 'data-count-info';
        
        const debugToggle = document.createElement('div');
        debugToggle.style.cssText = `
            font-size: 10px;
            color: #999;
            margin-top: 5px;
            cursor: pointer;
            text-decoration: underline;
        `;
        debugToggle.textContent = 'Toggle Debug Logs';
        debugToggle.addEventListener('click', () => {
            debugMode = !debugMode;
            console.log(`[Analytics Downloader] Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
            showToast(`Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
        });

        const toast = document.createElement('div');
        toast.id = 'analytics-toast';
        toast.style.cssText = `
            font-size: 12px;
            color: white;
            background: #10a37f;
            padding: 8px 12px;
            margin-top: 10px;
            border-radius: 4px;
            display: none;
            opacity: 0;
            transition: opacity 0.3s ease;
            text-align: center;
        `;

        container.appendChild(title);
        container.appendChild(downloadButton);
        container.appendChild(info);
        container.appendChild(debugToggle);
        container.appendChild(toast);

        // Find the sidebar element and position the box to its right
        const sidebarTarget = document.evaluate(
            '//*[@id="stage-slideover-sidebar"]/div/div[2]',
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
        ).singleNodeValue;
        
        if (sidebarTarget) {
            // Get sidebar dimensions
            const rect = sidebarTarget.getBoundingClientRect();
            const sidebarWidth = rect.width;
            const sidebarLeft = rect.left;
            
            // Calculate box dimensions and position
            const boxWidth = sidebarWidth * 0.8; // 80% of sidebar width
            const boxLeft = sidebarLeft + sidebarWidth + (sidebarWidth * 0.05); // Right edge + 5% spacing
            
            // Apply positioning - right of sidebar, bottom of screen
            container.style.cssText = `
                background: white;
                border: 2px solid #10a37f;
                border-radius: 8px;
                padding: 15px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                position: fixed;
                left: ${boxLeft}px;
                bottom: 20px;
                width: ${boxWidth}px;
                max-height: 80vh;
                overflow-y: auto;
                z-index: 10000;
            `;
            
            document.body.appendChild(container);
            console.log('[Analytics Downloader] UI positioned next to sidebar');
        } else {
            // Fallback to bottom-left if sidebar not found
            container.style.cssText = `
                background: white;
                border: 2px solid #10a37f;
                border-radius: 8px;
                padding: 15px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                position: fixed;
                bottom: 20px;
                left: 20px;
                min-width: 250px;
                z-index: 10000;
            `;
            document.body.appendChild(container);
            console.warn('[Analytics Downloader] Sidebar not found, using fallback position');
        }

        // Update data count periodically
        setInterval(() => {
            const dateDisplay = currentDate ? `<span style="color: #10a37f; font-weight: 600;">${currentDate}</span>` : '<span style="color: #999;">waiting...</span>';
            
            // Count only analytics files matching current date (reports not included)
            let analyticsCount = 0;
            if (currentDate) {
                analyticsCount = Object.values(interceptedData).filter(item => item.startDate === currentDate).length;
            }
            
            info.innerHTML = `Date: ${dateDisplay}<br>Data files: ${analyticsCount}`;
        }, 500);
    }

    // Wait for page to load before creating UI
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }

    console.log('[Analytics Downloader] Script loaded and monitoring...');
    console.log('[Analytics Downloader] Looking for URLs matching:', BASE_URL_PATTERN);
    console.log('[Analytics Downloader] Endpoints:', ENDPOINTS.map(e => e.key).join(', '));
})();
