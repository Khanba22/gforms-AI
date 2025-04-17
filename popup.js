document.addEventListener('DOMContentLoaded', function() {
    // Load saved API key
    chrome.storage.local.get(['geminiApiKey'], function(result) {
      if (result.geminiApiKey) {
        document.getElementById('api-key').value = result.geminiApiKey;
      }
    });
  
    // Save API key and start analysis when button is clicked
    document.querySelector('#analyze-form').addEventListener('click', function() {
      const apiKey = document.getElementById('api-key').value.trim();
      
      if (!apiKey) {
        showStatus('Please enter a valid Gemini API key', 'error');
        return;
      }
      
      // Save API key
      chrome.storage.local.set({ geminiApiKey: apiKey }, function() {
        showStatus('Preparing analysis...', 'success');
        
        // Check current tab
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
          if (!tabs || tabs.length === 0) {
            showStatus('Error: No active tab found', 'error');
            return;
          }
          
          const activeTab = tabs[0];
          if (!activeTab.url || !activeTab.url.includes('docs.google.com/forms')) {
            showStatus('Error: Please navigate to a Google Form', 'error');
            return;
          }
          
          // First, ensure content script is injected
          chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ['content.js']
          })
          .then(() => {
            // After ensuring content script is loaded, send the analysis message
            showStatus('Analyzing form...', 'success');
            sendAnalysisMessage(activeTab.id, apiKey);
          })
          .catch(err => {
            showStatus('Error: Could not inject content script. ' + err.message, 'error');
          });
        });
      });
    });
    
    // Function to send message to content script with retry
    function sendAnalysisMessage(tabId, apiKey, retryCount = 0) {
      const maxRetries = 2;
      
      chrome.tabs.sendMessage(tabId, { action: 'analyzeForm', apiKey: apiKey }, function(response) {
        if (chrome.runtime.lastError) {
          console.error('Error sending message:', chrome.runtime.lastError);
          
          // If we haven't reached max retries, try again after a delay
          if (retryCount < maxRetries) {
            showStatus(`Connection failed. Retrying (${retryCount + 1}/${maxRetries})...`, 'error');
            
            // Wait a bit and retry
            setTimeout(() => {
              sendAnalysisMessage(tabId, apiKey, retryCount + 1);
            }, 1000);
            
            return;
          } else {
            // Max retries reached
            showStatus('Error: Could not establish connection to the form page. Please refresh the page and try again.', 'error');
            return;
          }
        }
        
        // If we got a response
        if (response && response.success) {
          showStatus('Analysis complete! Answers marked.', 'success');
        } else {
          showStatus('Error: ' + (response?.error || 'Could not analyze form'), 'error');
        }
      });
    }
    
    function showStatus(message, type) {
      const statusElement = document.getElementById('status');
      statusElement.textContent = message;
      statusElement.className = 'status ' + type;
      statusElement.style.display = 'block';
    }
  });