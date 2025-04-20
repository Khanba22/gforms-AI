(function () {
  function extractFormContent() {
    const questions = [];
    const questionElements = document.querySelectorAll(
      ".freebirdFormviewerComponentsQuestionBaseRoot"
    ); // Google Forms question block

    questionElements.forEach((qEl) => {
      const textElement = qEl.querySelector(".M7eMe"); // Text question content
      const imgElement = qEl.querySelector("img"); // Image if any

      let questionText = textElement ? textElement.innerText.trim() : "";
      let imageSrc = imgElement ? imgElement.src : null;

      questions.push({
        question: questionText,
        image: imageSrc, // can be null if no image
      });
    });

    return questions;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "analyzeForm") {
      const formContent = extractFormContent();
      sendResponse({ success: true, content: formContent });
    }
  });

  // Prevent the content script from being injected into the page multiple times

  // Create UI elements
  function createUI() {
    const container = document.createElement("div");
    container.className = "gemini-forms-helper";
    container.innerHTML = `
        <div class="gemini-forms-header">
          <img src="${chrome.runtime.getURL(
            "images/icon48.png"
          )}" alt="Gemini Forms Helper">
          <span>Gemini Forms Helper</span>
        </div>
        <div class="gemini-forms-status">Ready</div>
        <div class="gemini-forms-progress" style="display: none;">
          <div class="gemini-forms-progress-bar"></div>
        </div>
      `;
    document.body.appendChild(container);
    return container;
  }

  // Extract form data
  function extractFormData() {
    const formData = {
      title:
        document.querySelector(".freebirdFormviewerViewHeaderTitle, .F9yp7e")
          ?.textContent || "Google Form",
      questions: [],
    };

    // Get all question containers - try different selectors used by Google Forms
    const questionContainers = document.querySelectorAll(
      '.freebirdFormviewerViewNumberedItemContainer, .Qr7Oae[role="listitem"]'
    );

    questionContainers.forEach((container) => {
      // Get question text - try different possible selectors
      const questionText =
        container.querySelector(
          ".freebirdFormviewerViewItemsItemItemTitle, .HoXoMd, .M7eMe"
        )?.textContent || "";

      // Determine question type
      let questionType = "unknown";
      let options = [];

      // Multiple choice - try different radiogroup selectors
      if (
        container.querySelector(
          '[role="radiogroup"], .lLfZXe[role="radiogroup"]'
        )
      ) {
        questionType = "multipleChoice";
        // Try different option selectors
        const optionElements = container.querySelectorAll(
          ".docssharedWizToggleLabeledLabelWrapper, .aDTYNe, .ulDsOb span"
        );
        optionElements.forEach((option) => {
          const optionElement = option.closest(
            ".freebirdFormviewerViewItemsRadioOptionContainer, .nWQGrd, .docssharedWizToggleLabeledContainer"
          );
          if (optionElement) {
            options.push({
              text: option.textContent.trim(),
              element: optionElement,
            });
          }
        });
      }
      // Checkboxes
      else if (
        container.querySelector(
          '.freebirdFormviewerViewItemsCheckboxContainer, [role="group"]'
        )
      ) {
        questionType = "checkboxes";
        const optionElements = container.querySelectorAll(
          ".docssharedWizToggleLabeledLabelWrapper, .aDTYNe, .ulDsOb span"
        );
        optionElements.forEach((option) => {
          const optionElement = option.closest(
            ".freebirdFormviewerViewItemsCheckboxOptionContainer, .nWQGrd, .docssharedWizToggleLabeledContainer"
          );
          if (optionElement) {
            options.push({
              text: option.textContent.trim(),
              element: optionElement,
            });
          }
        });
      }
      // Short answer
      else if (container.querySelector('input[type="text"]')) {
        questionType = "shortAnswer";
      }
      // Paragraph
      else if (container.querySelector("textarea")) {
        questionType = "paragraph";
      }

      formData.questions.push({
        text: questionText,
        type: questionType,
        options: options,
        container: container,
      });
    });

    return formData;
  }

  // Analyze form with Gemini API
  async function analyzeWithGemini(formData, apiKey) {
    const endpoint =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent";

    // Format the questions for the prompt
    const formattedQuestions = formData.questions
      .map((q, index) => {
        let questionInfo = `Question ${index + 1}: ${q.text}\nType: ${q.type}`;

        if (q.options.length > 0) {
          questionInfo += "\nOptions:";
          q.options.forEach((opt, optIndex) => {
            questionInfo += `\n- Option ${optIndex + 1}: ${opt.text}`;
          });
        }

        return questionInfo;
      })
      .join("\n\n");

    const prompt = `
  You are an AI assistant that helps answer Google Form questions accurately.
  
  This form has the following title: "${formData.title}"
  
  Here are the questions in the form:
  ${formattedQuestions}
  
  For each question, provide the correct answer(s) in this format:
  Question 1: [Answer]
  Question 2: [Answer]
  ...
  
  For multiple choice questions, specify the option number (e.g., "Option 2").
  For checkbox questions, list all correct options (e.g., "Option 1, Option 3").
  For text/paragraph questions, provide the best possible answer.
  
  Give only the answers in the exact format requested, without additional explanation or conversation.
  `;

    try {
      const response = await fetch(`${endpoint}?key=${apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            topP: 0.8,
            topK: 40,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          `Gemini API error: ${errorData.error?.message || response.statusText}`
        );
      }

      const data = await response.json();
      return parseGeminiResponse(data);
    } catch (error) {
      console.error("Error calling Gemini API:", error);
      throw error;
    }
  }

  // Parse the Gemini API response
  function parseGeminiResponse(response) {
    try {
      // Handle both gemini-pro and gemini-2.0-flash-001 response formats
      const responseText =
        response.candidates?.[0]?.content?.parts?.[0]?.text ||
        response.candidates?.[0]?.text ||
        "";

      if (!responseText) {
        throw new Error("Empty response from Gemini API");
      }

      const answers = {};

      // Match patterns like "Question X: [Answer]"
      const answerRegex = /Question\s+(\d+)\s*:\s*(.+?)(?=Question\s+\d+:|$)/gs;
      let match;

      while ((match = answerRegex.exec(responseText)) !== null) {
        const questionNum = parseInt(match[1], 10);
        const answerText = match[2].trim();
        answers[questionNum] = answerText;
      }

      return answers;
    } catch (error) {
      console.error("Error parsing Gemini response:", error);
      throw new Error("Could not parse Gemini response");
    }
  }

  // Fill in the form with the answers
  function fillFormWithAnswers(formData, answers) {
    formData.questions.forEach((question, index) => {
      const questionNum = index + 1;
      const answer = answers[questionNum];

      if (!answer) return;

      if (question.type === "multipleChoice") {
        // For multiple choice, find the option mentioned in the answer
        const optionMatch = answer.match(/Option\s+(\d+)/i);
        if (optionMatch) {
          const optionNum = parseInt(optionMatch[1], 10) - 1;
          if (question.options[optionNum]) {
            const optionElement = question.options[optionNum].element;

            // Try different ways to click the option
            const input = optionElement.querySelector("input, .Od2TWd");
            if (input) {
              input.click();
              highlightAnswer(optionElement);
            } else {
              // If no input found, try clicking the element itself
              optionElement.click();
              highlightAnswer(optionElement);
            }

            // Log the selection for verification
            console.log(
              `Selected option ${optionNum + 1} for question ${questionNum}: ${
                question.text
              }`
            );
          }
        }
      } else if (question.type === "checkboxes") {
        // For checkboxes, there might be multiple options
        const optionMatches = answer.match(/Option\s+(\d+)/gi) || [];
        optionMatches.forEach((optMatch) => {
          const optionNum =
            parseInt(optMatch.replace(/Option\s+/i, ""), 10) - 1;
          if (question.options[optionNum]) {
            const optionElement = question.options[optionNum].element;

            // Try different ways to click the checkbox
            const input = optionElement.querySelector("input, .Od2TWd");
            if (input) {
              input.click();
              highlightAnswer(optionElement);
            } else {
              // If no input found, try clicking the element itself
              optionElement.click();
              highlightAnswer(optionElement);
            }

            // Log the selection for verification
            console.log(
              `Selected checkbox option ${
                optionNum + 1
              } for question ${questionNum}: ${question.text}`
            );
          }
        });
      } else if (
        question.type === "shortAnswer" ||
        question.type === "paragraph"
      ) {
        // For text inputs
        const input = question.container.querySelector(
          'input[type="text"], textarea'
        );
        if (input) {
          input.value = answer;
          // Trigger input event to update form state
          const event = new Event("input", { bubbles: true });
          input.dispatchEvent(event);
          highlightAnswer(input);

          // Log the input for verification
          console.log(
            `Entered text for question ${questionNum}: ${question.text}`
          );
        }
      }
    });

    // Scroll through the form to make selections visible
    window.scrollTo(0, 0);
    setTimeout(() => {
      window.scrollTo(0, document.body.scrollHeight);
      setTimeout(() => {
        window.scrollTo(0, 0);
      }, 500);
    }, 500);
  }

  // Add visual highlight to answered elements
  function highlightAnswer(element) {
    // Create a highlight overlay
    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.backgroundColor = "rgba(240 235 248 0.4)";
    overlay.style.borderRadius = "4px";
    overlay.style.zIndex = "1";
    overlay.style.pointerEvents = "none";

    // Add a checkmark or indicator
    const indicator = document.createElement("div");
    indicator.style.position = "absolute";
    indicator.style.right = "10px";
    indicator.style.top = "50%";
    indicator.style.transform = "translateY(-50%)";
    indicator.style.fontSize = "12px";
    indicator.innerHTML = "~"; // Checkmark or any other indicator

    indicator.style.zIndex = "2";
    indicator.style.pointerEvents = "none";

    // Add strong box-shadow for more visibility
    element.style.position = "relative";

    // Only add overlay if element doesn't already have one
    if (!element.querySelector(".gemini-answer-highlight")) {
      overlay.classList.add("gemini-answer-highlight");
      indicator.classList.add("gemini-answer-indicator");
      element.appendChild(overlay);
      element.appendChild(indicator);
    }

    // Scroll the element into view to make it visible
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Update UI status
  function updateUIStatus(container, status, isError = false) {
    const statusElement = container.querySelector(".gemini-forms-status");
    if (statusElement) {
      statusElement.textContent = status;
      statusElement.style.color = isError ? "#c62828" : "#2e7d32";
    }
  }

  // Handle progress updates
  function updateProgress(container, percent) {
    const progressContainer = container.querySelector(".gemini-forms-progress");
    const progressBar = container.querySelector(".gemini-forms-progress-bar");

    if (progressContainer && progressBar) {
      progressContainer.style.display = percent >= 0 ? "block" : "none";
      progressBar.style.width = `${percent}%`;
    }
  }

  // Main process function
  async function processForm(apiKey) {
    const uiContainer = createUI();

    try {
      updateUIStatus(uiContainer, "Extracting form data...");
      updateProgress(uiContainer, 20);
      const formData = extractFormData();

      updateUIStatus(uiContainer, "Analyzing with Gemini...");
      updateProgress(uiContainer, 50);
      const answers = await analyzeWithGemini(formData, apiKey);

      updateUIStatus(uiContainer, "Filling in answers...");
      updateProgress(uiContainer, 80);
      fillFormWithAnswers(formData, answers);

      updateUIStatus(uiContainer, "Complete! Answers marked.");
      updateProgress(uiContainer, 100);

      // Remove UI after 5 seconds
      setTimeout(() => {
        uiContainer.style.opacity = "0";
        setTimeout(() => uiContainer.remove(), 500);
      }, 5000);

      return { success: true };
    } catch (error) {
      updateUIStatus(uiContainer, `Error: ${error.message}`, true);
      updateProgress(uiContainer, -1);
      console.error("Form processing error:", error);
      return { success: false, error: error.message };
    }
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "analyzeForm") {
      processForm(message.apiKey)
        .then(sendResponse)
        .catch((error) =>
          sendResponse({ success: false, error: error.message })
        );
      return true; // Indicates async response
    }
  });
})();
