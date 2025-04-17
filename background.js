// Listen for tab updates (when user navigates to a new page)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Check if the page is fully loaded and it's a Google Form
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('docs.google.com/forms')) {
    // Inject the content script programmatically to ensure it's loaded
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    })
    .catch(err => console.error('Error injecting content script:', err));
    
    // Also inject the CSS
    chrome.scripting.insertCSS({
      target: { tabId: tabId },
      files: ['styles.css']
    })
    .catch(err => console.error('Error injecting CSS:', err));
  }
});

// Listen for extension icon click
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.includes('docs.google.com/forms')) {
    // If on a Google Form, ensure the content script is loaded
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    })
    .catch(err => console.error('Error injecting content script:', err));
  }
}); 