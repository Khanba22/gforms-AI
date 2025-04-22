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
          
          // Check if we're on a supported page
          let supportedSite = false;
          let siteType = '';
          
          if (activeTab.url.includes('docs.google.com/forms')) {
            supportedSite = true;
            siteType = 'googleForm';
          } else if (activeTab.url.includes('coursera.org')) {
            supportedSite = true;
            siteType = 'courseraQuiz';
          }
          
          if (!supportedSite) {
            showStatus('Error: Please navigate to a Google Form or Coursera Quiz', 'error');
            return;
          }
          
          // First, ensure content script is injected
          chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ['content.js']
          })
          .then(() => {
            // After ensuring content script is loaded, send the analysis message
            showStatus(`Analyzing ${siteType === 'googleForm' ? 'form' : 'quiz'}...`, 'success');
            
            if (siteType === 'googleForm') {
              sendGoogleFormAnalysisMessage(activeTab.id, apiKey);
            } else if (siteType === 'courseraQuiz') {
              sendCourseraQuizAnalysisMessage(activeTab.id, apiKey);
            }
          })
          .catch(err => {
            showStatus('Error: Could not inject content script. ' + err.message, 'error');
          });
        });
      });
    });
    
    // Function to send message to content script for Google Forms with retry
    function sendGoogleFormAnalysisMessage(tabId, apiKey, retryCount = 0) {
      const maxRetries = 2;
      
      chrome.tabs.sendMessage(tabId, { action: 'analyzeForm', apiKey: apiKey }, function(response) {
        if (chrome.runtime.lastError) {
          console.error('Error sending message:', chrome.runtime.lastError);
          
          // If we haven't reached max retries, try again after a delay
          if (retryCount < maxRetries) {
            showStatus(`Connection failed. Retrying (${retryCount + 1}/${maxRetries})...`, 'error');
            
            // Wait a bit and retry
            setTimeout(() => {
              sendGoogleFormAnalysisMessage(tabId, apiKey, retryCount + 1);
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
          const formQuestions = response.content; // an array of {question, image} objects
        
          showStatus('Sending questions to Gemini for analysis...', 'success');
        
          analyzeQuestions(formQuestions, apiKey);
        } else {
          showStatus('Error: ' + (response?.error || 'Could not analyze form'), 'error');
        }
      });
    }
    
    // Function to send message to content script for Coursera Quizzes with retry
    function sendCourseraQuizAnalysisMessage(tabId, apiKey, retryCount = 0) {
      const maxRetries = 2;
      
      chrome.tabs.sendMessage(tabId, { action: 'analyzeCourseraQuiz', apiKey: apiKey }, function(response) {
        if (chrome.runtime.lastError) {
          console.error('Error sending message:', chrome.runtime.lastError);
          
          // If we haven't reached max retries, try again after a delay
          if (retryCount < maxRetries) {
            showStatus(`Connection failed. Retrying (${retryCount + 1}/${maxRetries})...`, 'error');
            
            // Wait a bit and retry
            setTimeout(() => {
              sendCourseraQuizAnalysisMessage(tabId, apiKey, retryCount + 1);
            }, 1000);
            
            return;
          } else {
            // Max retries reached
            showStatus('Error: Could not establish connection to the quiz page. Please refresh the page and try again.', 'error');
            return;
          }
        }
        
        // If we got a response
        if (response && response.success) {
          const quizContent = response.content; // map of {question: options}
        
          showStatus('Sending quiz questions to Gemini for analysis...', 'success');
        
          analyzeCourseraQuiz(quizContent, apiKey);
        } else {
          showStatus('Error: ' + (response?.error || 'Could not analyze Coursera quiz'), 'error');
        }
      });
    }
  });

  // Function to update status display for the user
  function showStatus(message, type) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.className = 'status ' + type;
      statusElement.style.display = 'block';
    }
  }
  
  async function analyzeQuestions(questions, apiKey) {
    const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=" + apiKey;
  
    const contents = await Promise.all(questions.map(async (q) => {
      const contentBlock = {
        parts: [{ text: q.question || 'No question text.' }]
      };
  
      if (q.image) {
        contentBlock.parts.push({
          inlineData: {
            mimeType: "image/jpeg", // or "image/png" depending on the image
            data: await getImageBase64(q.image)
          }
        });
      }
  
      return contentBlock;
    }));
  
    const requestBody = { contents };
  
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
  
      const data = await res.json();
      console.log('Gemini response:', data);
  
      showStatus('Analysis complete!', 'success');
      // TODO: Parse and mark answers based on Gemini's response
    } catch (error) {
      console.error('Error analyzing questions:', error);
      showStatus('Error analyzing form: ' + error.message, 'error');
    }
  }
  
  async function analyzeCourseraQuiz(quizContent, apiKey) {
    const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=" + apiKey;
    
    // Format the quiz content for Gemini
    const questionsText = Object.entries(quizContent)
      .map(([question, options], index) => {
        // Look for hints that this is a checkbox question (choose multiple)
        const isCheckboxHint = question.match(/choose\s+(two|multiple|several|\d+)/i) ? 
          " (This is a checkbox question where multiple answers should be selected)" : "";
          
        // Check if this is a numeric input question
        const isNumericQuestion = options.length === 1 && options[0] === "[NUMERIC_INPUT]";
        
        if (isNumericQuestion) {
          return `Question ${index + 1}: ${question}\n(This requires a numeric answer. Please provide just the number.)`;
        } else {
          return `Question ${index + 1}: ${question}${isCheckboxHint}\nOptions:\n${options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}`;
        }
      })
      .join('\n\n');
    
    const prompt = `
    You are an AI assistant that helps answer Coursera quiz questions accurately.
    
    Here are the questions from the quiz:
    ${questionsText}
    
    For each question, provide the correct answer(s) in this format:
    Question 1: [Answer]
    Question 2: [Answer]
    ...
    
    - For multiple choice questions, specify the option number (e.g., "Option 2").
    - For checkbox questions requiring multiple selections, list ALL correct options (e.g., "Option 1, Option 3").
    - For numeric questions, just provide the number (e.g., "42").
    - Pay careful attention to questions that ask you to "Choose two", "Select all that apply", or similar phrases.
    
    Be precise and thorough in identifying all correct answers for checkbox questions. If a question asks you to select multiple answers, you must provide all of them.
    
    Give only the answers in the exact format requested, without additional explanation or conversation.
    `;
    
    try {
      showStatus('Asking Gemini for answers...', 'success');
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            topP: 0.8,
            topK: 40,
          }
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Gemini API error: ${errorData.error?.message || response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Gemini response for Coursera quiz:', data);
      
      // Process Gemini's response and parse the answers
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      
      if (!responseText) {
        throw new Error("Empty response from Gemini API");
      }
      
      // Parse the answers from the response
      const answers = parseCourseraAnswers(responseText);
      
      if (Object.keys(answers).length === 0) {
        throw new Error("Could not parse any answers from the response");
      }
      
      showStatus(`Found answers for ${Object.keys(answers).length} questions. Highlighting...`, 'success');
      
      // Send the answers back to the content script
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (!tabs || tabs.length === 0) {
          showStatus('Error: No active tab found', 'error');
          return;
        }
        
        const activeTab = tabs[0];
        
        // Send the answers to the content script to process
        chrome.tabs.sendMessage(
          activeTab.id, 
          { action: 'processCourseraAnswers', answers: answers }, 
          function(response) {
            if (chrome.runtime.lastError) {
              console.error('Error sending answers to content script:', chrome.runtime.lastError);
              showStatus('Error highlighting answers. Please refresh the page and try again.', 'error');
              return;
            }
            
            if (response && response.success) {
              showStatus(`Successfully highlighted ${response.highlightCount} answers!`, 'success');
            } else {
              showStatus('Error: ' + (response?.error || 'Could not highlight answers'), 'error');
            }
          }
        );
      });
      
    } catch (error) {
      console.error('Error analyzing Coursera quiz:', error);
      showStatus('Error analyzing quiz: ' + error.message, 'error');
    }
  }
  
  // Parse the answers from Gemini's response
  function parseCourseraAnswers(responseText) {
    const answers = {};
    
    // Match patterns like "Question X: [Answer]"
    const answerRegex = /Question\s+(\d+)\s*:\s*(.+?)(?=Question\s+\d+:|$)/gs;
    let match;
    
    while ((match = answerRegex.exec(responseText)) !== null) {
      const questionNum = parseInt(match[1], 10);
      const answerText = match[2].trim();
      
      // Parse the answer text - handle both single and multiple options
      if (answerText.toLowerCase().includes('option')) {
        // Check if answer contains multiple options (comma separated)
        if (answerText.includes(',')) {
          // Handle multiple options (for checkbox questions)
          const optionMatches = answerText.match(/Option\s+(\d+)/gi) || [];
          if (optionMatches.length > 0) {
            answers[questionNum] = answerText; // Keep the full text with multiple options
          }
        } else {
          // Single option (for radio questions)
          answers[questionNum] = answerText;
        }
      } else {
        // Just use the text as is if it doesn't match the option pattern
        answers[questionNum] = answerText;
      }
    }
    
    return answers;
  }
  
  async function getImageBase64(imageUrl) {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
  
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result.split(',')[1];
        resolve(base64data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  
