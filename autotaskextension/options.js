// Function to update the declarativeNetRequest ruleset
async function updateRuleState(enableNewTabRules) {
  const options = {
    enableRulesetIds: [],
    disableRulesetIds: []
  };

  if (enableNewTabRules) {
    options.enableRulesetIds.push('newTabRules');
    options.disableRulesetIds = options.disableRulesetIds.filter(id => id !== 'newTabRules');
  } else {
    options.enableRulesetIds = options.enableRulesetIds.filter(id => id !== 'newTabRules');
    options.disableRulesetIds.push('newTabRules');
  }

  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets(options);
  } catch (error) {
    console.error("Error updating ruleset state:", error);
  }
}

// Function to save options to chrome.storage
function saveOptions(e) {
  e.preventDefault();

  // Get threshold values and parse them
  var amberValStr = document.querySelector('#inputOptionAmber').value;
  var redValStr = document.querySelector('#inputOptionRed').value;
  var inputOptionAmber = parseInt(amberValStr, 10);
  var inputOptionRed = parseInt(redValStr, 10);

  // Get checkbox value
  var workTypeEnabled = document.querySelector('#enableWorkTypeFeature').checked; // Get boolean value
  var linksOpeningInNewTabsEnabled = document.querySelector('#enableLinksOpeningInNewTabs').checked;

  var status = document.querySelector('#status'); // Get status element early

  // Check if thresholds are valid numbers
  if (isNaN(inputOptionAmber) || isNaN(inputOptionRed)) {
    status.textContent = 'Please enter valid numbers for thresholds.';
    status.className = "alert alert-danger"; // Use alert classes if using Bootstrap etc.
    return;
  }

  // Check if red threshold is greater than amber
  if (inputOptionRed > inputOptionAmber) {
    // Prepare settings object
    const settingsToSave = {
      'inputOptionAmber': inputOptionAmber,
      'inputOptionRed': inputOptionRed,
      'workTypeFeatureEnabled': workTypeEnabled,
      'linksOpeningInNewTabsEnabled': linksOpeningInNewTabsEnabled
    };

    // Save all settings
    chrome.storage.sync.set(settingsToSave, async function () {
      // Update status to let user know options were saved
      status.className = "alert alert-success";
      status.textContent = 'Options saved.';
      setTimeout(function () {
        status.textContent = '';
        status.className = "alert"; // Reset class
      }, 1500); // Increased timeout slightly

      // Update the rule state AFTER saving
      await updateRuleState(linksOpeningInNewTabsEnabled);
    });

  } else {
    // Validation failed for thresholds
    status.textContent = 'Red value needs to be greater than Amber.';
    status.className = "alert alert-danger";
  }
}

// Function to restore options from chrome.storage
function restoreOptions() {
  // Use default values: amber=15, red=45, workTypeEnabled=false (unchecked)
  chrome.storage.sync.get({
    inputOptionAmber: 15, // Default Amber
    inputOptionRed: 45,   // Default Red
    workTypeFeatureEnabled: false, // Default for the new checkbox (unchecked)
    linksOpeningInNewTabsEnabled: false // Default for the new checkbox (unchecked)
  }, function (items) {
    document.querySelector('#inputOptionAmber').value = items.inputOptionAmber;
    document.querySelector('#inputOptionRed').value = items.inputOptionRed;
    // Set the checkbox state based on loaded value
    document.querySelector('#enableWorkTypeFeature').checked = items.workTypeFeatureEnabled;
    document.querySelector('#enableLinksOpeningInNewTabs').checked = items.linksOpeningInNewTabsEnabled;

    // Update the rule state based on the loaded setting
    updateRuleState(items.linksOpeningInNewTabsEnabled);
  });
}

// Add event listeners once the DOM is loaded
document.addEventListener('DOMContentLoaded', restoreOptions);
// Ensure your form element exists before adding listener
const form = document.querySelector('form');
if (form) {
  form.addEventListener('submit', saveOptions);
} else {
  console.error("Options form not found!");
}