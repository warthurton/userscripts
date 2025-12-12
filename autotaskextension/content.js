// console.log("Stopwatch Timer Colorizer & Toolbar Visibility Controller: Content script injected.");
// Context: Current time is Monday, April 7, 2025 at 8:43:19 AM AEST. Location: Australia
// console.log("Current Time (AEST):", new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" }));


// --- Stopwatch Functionality ---
const targetClassName = 'StopwatchTime';
let stopwatchElement = null;
let stopwatchObserver = null;
let intervalId = null;
// NOTE: Thresholds represent TOTAL MINUTES (can be fractional comparison)
let amberThreshold = 15; // Default threshold in minutes
let redThreshold = 30;   // Default threshold in minutes

// --- Work Type & Toolbar Item Visibility Functionality ---
const targetText = "Work Type";
const replacementText = "Work Type *";
const workTypeContainerSelector = '.Dialog1';   // Container where "Work Type" span appears
const targetChipListSelector = '.ChipList.SingleDataSelection';     // The ChipList element to monitor
// Selector for the specific element to hide/show based on ChipList content
const visibilityTargetSelector = '.VerticalContainer .Header .ToolBar .ToolBarItem.Left';
let workTypeContainerObserver = null; // Observer waits for the Dialog1 container
let chipListObserver = null;          // Observer waits for changes INSIDE ChipList

// ===========================================
// Stopwatch Functions (Calculation Changed to Fractional Minutes)
// ===========================================

/** Fetches thresholds (interpreted as minutes) from chrome.storage.sync. */
async function loadThresholdsFromStorage() {
    try {
        const items = await chrome.storage.sync.get({
            inputOptionAmber: amberThreshold, // Default minutes
            inputOptionRed: redThreshold      // Default minutes
        });
        const parsedAmber = parseInt(items.inputOptionAmber, 10);
        const parsedRed = parseInt(items.inputOptionRed, 10);
        if (!isNaN(parsedAmber) && parsedAmber >= 0) amberThreshold = parsedAmber;
        if (!isNaN(parsedRed) && parsedRed >= 0) redThreshold = parsedRed;
        // console.log(`Stopwatch Colorizer: Thresholds loaded - Amber: ${amberThreshold} mins, Red: ${redThreshold} mins`);
    } catch (error) {
        console.error("Stopwatch Colorizer: Error loading thresholds:", error);
    }
 }

/**
 * Updates background color based on FRACTIONAL MINUTES elapsed.
 * Thresholds (amberThreshold, redThreshold) are interpreted as minutes.
 */
function updateStopwatchColor() {
    if (!stopwatchElement || !document.body.contains(stopwatchElement)) {
        if (intervalId) clearInterval(intervalId);
        intervalId = null;
        stopwatchElement = null;
        startStopwatchObserver(); // Restart search if element lost
        return;
    }
    const timeString = stopwatchElement.textContent.trim();
    const timeParts = timeString.split(':'); // hh:MM:ss
    let newBgColor = '';
    let newTextColor = 'white';

    if (timeParts.length === 3) {
        const hours = parseInt(timeParts[0], 10);
        const minutes = parseInt(timeParts[1], 10);
        const seconds = parseInt(timeParts[2], 10); // *** Seconds are now parsed ***

        // Check if hours, minutes, AND seconds parsed correctly
        if (!isNaN(hours) && !isNaN(minutes) && !isNaN(seconds)) {
            // *** CHANGED: Calculate total minutes including fractional seconds ***
            const totalMinutes = (hours * 60) + minutes + (seconds / 60);

            // *** Compare totalMinutes (potentially fractional) against thresholds ***
            if (totalMinutes <= amberThreshold) {
                newBgColor = 'green';
            } else if (totalMinutes <= redThreshold) { // totalMinutes > amberThreshold implied
                newBgColor = 'orange';
            } else { // totalMinutes > redThreshold
                newBgColor = 'red';
            }
        } else {
             newBgColor = ''; newTextColor = ''; // Reset on parse error
             console.warn("Stopwatch Colorizer: Could not parse H, M, or S from element:", timeString);
        }
    } else {
         newBgColor = ''; newTextColor = ''; // Reset on format error
         console.warn("Stopwatch Colorizer: Unexpected time format in element:", timeString);
    }
    // Apply styles
    stopwatchElement.style.backgroundColor = newBgColor;
    stopwatchElement.style.color = newTextColor;
}


/** Starts the interval timer after the stopwatch element is found. */
async function startStopwatchMonitoring() {
    // console.log("Stopwatch Colorizer: Starting monitoring (using fractional minutes).");
    await loadThresholdsFromStorage(); // Load thresholds first (interpreted as minutes)
    if (intervalId) clearInterval(intervalId); // Clear previous interval if any
    updateStopwatchColor(); // Update color immediately
    intervalId = setInterval(updateStopwatchColor, 1000); // Still check every second for visual update
}

/** Helper: Checks node and descendants for the stopwatch element */
function checkForStopwatchElement(node) {
     if (node.nodeType === Node.ELEMENT_NODE) {
        // Check self
        if (typeof node.matches === 'function' && node.matches('.' + targetClassName)) return node;
        // Check descendants
        if (typeof node.querySelector === 'function') return node.querySelector('.' + targetClassName);
    }
    return null;
}

/** Callback for the stopwatch element MutationObserver */
function handleStopwatchMutations(mutationsList, obs) {
     for (const mutation of mutationsList) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
                const foundElement = checkForStopwatchElement(node);
                if (foundElement) {
                    stopwatchElement = foundElement;
                    obs.disconnect(); // Stop observing once found
                    stopwatchObserver = null;
                    startStopwatchMonitoring(); // Start the color update interval
                    return; // Exit loop/callback
                }
            }
        }
    }
}

/** Checks if stopwatch exists; if not, sets up the observer. */
function startStopwatchObserver() {
     if (stopwatchElement) { // If already found (e.g. restart after loss)
       if (!intervalId) startStopwatchMonitoring(); // Ensure monitoring is running
       return;
    }
    // Try finding immediately
    stopwatchElement = document.querySelector('.' + targetClassName);
    if (stopwatchElement) {
        // console.log("Stopwatch Colorizer: Target element found immediately.");
        startStopwatchMonitoring(); // Start monitoring if found on init
    } else {
        // console.log("Stopwatch Colorizer: Target element not found initially. Setting up stopwatch observer.");
        if (stopwatchObserver) stopwatchObserver.disconnect(); // Disconnect old if exists
        stopwatchObserver = new MutationObserver(handleStopwatchMutations);
        stopwatchObserver.observe(document.body, { childList: true, subtree: true });
    }
}


// ===========================================
// Work Type Text Mod & Toolbar Item Visibility (Unchanged Section)
// ===========================================
/** Finds "Work Type" spans and modifies text. */
function findAndModifyWorkTypeSpansOnly(searchNode) { /* ... unchanged ... */
    // console.log("Work Type Modifier: Searching for spans within:", searchNode);
    try {
        const spans = searchNode.querySelectorAll('span');
        spans.forEach(span => {
            // Check exact text, trimmed
            if (span.textContent.trim() === targetText) {
                // console.log("Work Type Modifier: Found target span:", span);
                span.textContent = replacementText; // Apply replacement text
                span.style.color = ''; // Reset any custom color
            }
        });
    } catch (e) {
       if (!(searchNode instanceof Element)) { console.warn("Work Type Modifier: searchNode is not an Element", searchNode); }
       else { console.error("Work Type Modifier: Error finding/modifying work type spans:", e); }
    }
 }
/** Checks ChipList children and updates visibility of ALL matching target elements. */
function updateTargetElementVisibility() { /* ... unchanged ... */
    const chipList = document.querySelector(targetChipListSelector);
    const visibilityTargetElements = document.querySelectorAll(visibilityTargetSelector);
    if (!chipList) { return; }
    if (visibilityTargetElements.length === 0) { return; }
    const hasChildren = chipList.children.length > 0;
    const newDisplay = hasChildren ? '' : 'none';
    visibilityTargetElements.forEach(element => { element.style.display = newDisplay; });
}
/** Finds ChipList/TargetElements, sets initial visibility, and starts observing ChipList. */
function setupChipListObserverAndVisibility() { /* ... unchanged ... */
    const chipList = document.querySelector(targetChipListSelector);
    const visibilityTargetElements = document.querySelectorAll(visibilityTargetSelector);
    if (chipList && visibilityTargetElements.length > 0) {
        // console.log(`Visibility Control: Found ChipList and ${visibilityTargetElements.length} Target Elements. Setting up observer.`);
        updateTargetElementVisibility();
        if (chipListObserver) chipListObserver.disconnect();
        chipListObserver = new MutationObserver(updateTargetElementVisibility);
        chipListObserver.observe(chipList, { childList: true });
        // console.log("Visibility Control: Observer started on ChipList:", chipList);
    } else {
        if (!chipList) console.warn("Visibility Control Setup: ChipList (" + targetChipListSelector + ") not found.");
        if (visibilityTargetElements.length === 0) console.warn("Visibility Control Setup: Target Elements (" + visibilityTargetSelector + ") not found.");
    }
}
/** Helper: Checks node and descendants for a given selector */
function findElementInNode(node, selector) { /* ... unchanged ... */
    if (node.nodeType === Node.ELEMENT_NODE) {
        if (typeof node.matches === 'function' && node.matches(selector)) return node;
        if (typeof node.querySelector === 'function') return node.querySelector(selector);
    }
    return null;
}
/** Callback for the Work Type CONTAINER (.Dialog1) MutationObserver. */
function handleWorkTypeContainerMutations(mutationsList, obs) { /* ... unchanged ... */
    for (const mutation of mutationsList) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
                const foundContainer = findElementInNode(node, workTypeContainerSelector);
                if (foundContainer) {
                    // console.log("Work Type Modifier: Container (" + workTypeContainerSelector + ") found:", foundContainer);
                    findAndModifyWorkTypeSpansOnly(foundContainer);
                    setupChipListObserverAndVisibility();
                    obs.disconnect();
                    workTypeContainerObserver = null;
                    // console.log("Work Type Modifier: Disconnected container observer.");
                    return;
                }
            }
        }
    }
}
/** Checks if container exists initially; if not, sets up the observer to wait for it. */
function startWorkTypeFeature() { /* ... unchanged ... */
    // console.log("Work Type Modifier: Initializing feature setup...");
    const existingContainer = document.querySelector(workTypeContainerSelector);
    if (existingContainer) {
        // console.log("Work Type Modifier: Container already exists on init. Processing now.");
        findAndModifyWorkTypeSpansOnly(existingContainer);
        setupChipListObserverAndVisibility();
    } else {
        // console.log("Work Type Modifier: Container (" + workTypeContainerSelector + ") not found initially. Setting up observer.");
        if (workTypeContainerObserver) workTypeContainerObserver.disconnect();
        workTypeContainerObserver = new MutationObserver(handleWorkTypeContainerMutations);
        workTypeContainerObserver.observe(document.body, { childList: true, subtree: true });
    }
}


// ===========================================
// Initial Setup Function (Checks Options Setting)
// ===========================================

/** Initializes all features, checking settings first. */
async function initializeExtensionFeatures() {
    // console.log("Initializing Extension Features...");
    startStopwatchObserver(); // Always setup Stopwatch Feature
    try {
        const settings = await chrome.storage.sync.get({ workTypeFeatureEnabled: false }); // Check setting
        if (settings.workTypeFeatureEnabled) {
            // console.log("Work Type feature is ENABLED. Starting setup...");
            startWorkTypeFeature(); // Conditionally setup Work Type / Toolbar Feature
        } else {
            // console.log("Work Type feature is DISABLED in options.");
            if (workTypeContainerObserver) workTypeContainerObserver.disconnect(); // Cleanup observers if disabled
            if (chipListObserver) chipListObserver.disconnect();
            workTypeContainerObserver = null; chipListObserver = null;
        }
    } catch (error) {
        console.error("Error reading workTypeFeatureEnabled setting:", error);
    }
}


// ===========================================
// Script Execution Starts Here
// ===========================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtensionFeatures);
} else {
    setTimeout(initializeExtensionFeatures, 50);
}

// ===========================================
// Cleanup Logic
// ===========================================
window.addEventListener('unload', () => {
    if (stopwatchObserver) stopwatchObserver.disconnect();
    if (intervalId) clearInterval(intervalId);
    if (workTypeContainerObserver) workTypeContainerObserver.disconnect();
    if (chipListObserver) chipListObserver.disconnect();
    // console.log("Stopwatch Timer Colorizer & Toolbar Controller: Cleaned up on unload.");
});