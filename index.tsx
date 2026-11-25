
import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import * as pdfjsLib from 'pdfjs-dist';

// Set the worker source for pdf.js
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs`;

// --- Type Definitions ---
interface TestCase {
  testCaseId: string;
  testCaseTitle: string;
  description: string;
  precondition: string;
  testSteps: string;
  testData: string;
  expectedResults: string;
  status: string;
  bugReference: string;
  priority: string;
  automationStatus: string;
  testSuite: string;
}

interface SimpleNode {
    name: string;
    children?: SimpleNode[];
}

interface ImageFile {
    data: string;
    mimeType: string;
    name: string;
}

// --- Helper Functions ---

// Converts camelCase to Title Case (e.g., "positiveTestCases" -> "Positive Test Cases")
const formatCategoryName = (camelCaseString: string): string => {
  if (!camelCaseString) return '';
  const result = camelCaseString.replace(/([A-Z])/g, ' $1');
  return result.charAt(0).toUpperCase() + result.slice(1);
};

// Converts a file to a base64 string
const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve((reader.result as string).split(',')[1]);
  reader.onerror = error => reject(error);
});

const autoResizeTextarea = (element: HTMLTextAreaElement) => {
    if (element) {
        element.style.height = 'auto';
        element.style.height = `${element.scrollHeight}px`;
    }
};

// Converts the mind map JSON to a tab-indented string for Miro
const convertJsonToIndentedText = (node: SimpleNode, depth = 0): string => {
    const indent = '\t'.repeat(depth);
    let result = `${indent}${node.name}\n`;
    if (node.children) {
        for (const child of node.children) {
            result += convertJsonToIndentedText(child, depth + 1);
        }
    }
    return result;
};

// --- Main App Component ---
const App = () => {
  const [activeTab, setActiveTab] = useState('generator');
  
  // Test Case Generator State
  const [requirements, setRequirements] = useState('');
  const [pdfText, setPdfText] = useState('');
  const [testCases, setTestCases] = useState<Record<string, TestCase[]> | null>(null);
  const [isGeneratingTestCases, setIsGeneratingTestCases] = useState(false);
  const [generatorError, setGeneratorError] = useState<string | null>(null);
  const [uiImages, setUiImages] = useState<ImageFile[]>([]);
  const [pdfFiles, setPdfFiles] = useState<{ name: string; text: string }[]>([]);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [isGeneratingMindMap, setIsGeneratingMindMap] = useState(false);
  const [mindMapError, setMindMapError] = useState<string | null>(null);
  const [mindMapText, setMindMapText] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // SKILL File State & Embeddings
  const [skillContent, setSkillContent] = useState('');
  const [skillFileName, setSkillFileName] = useState('');
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const skillFileInputRef = useRef<HTMLInputElement>(null);

  // New State for Ambiguity Analysis
  const [ambiguityReport, setAmbiguityReport] = useState<string | null>(null);
  const [isGeneratingAmbiguities, setIsGeneratingAmbiguities] = useState(false);
  const [ambiguityError, setAmbiguityError] = useState<string | null>(null);

  // Visual Regression State
  const [beforeImage, setBeforeImage] = useState<ImageFile | null>(null);
  const [afterImage, setAfterImage] = useState<ImageFile | null>(null);
  const [visualAnalysisPrompt, setVisualAnalysisPrompt] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const beforeImageInputRef = useRef<HTMLInputElement>(null);
  const afterImageInputRef = useRef<HTMLInputElement>(null);

  // Accessibility Check State
  const [accessibilityImage, setAccessibilityImage] = useState<ImageFile | null>(null);
  const [isCheckingAccessibility, setIsCheckingAccessibility] = useState(false);
  const [accessibilityReport, setAccessibilityReport] = useState<string | null>(null);
  const [accessibilityError, setAccessibilityError] = useState<string | null>(null);
  const accessibilityImageInputRef = useRef<HTMLInputElement>(null);

  // Log Analyser State
  const [logFile, setLogFile] = useState<{ content: string; name: string } | null>(null);
  const [isAnalyzingLog, setIsAnalyzingLog] = useState(false);
  const [logAnalysisReport, setLogAnalysisReport] = useState<string | null>(null);
  const [logAnalysisError, setLogAnalysisError] = useState<string | null>(null);
  const logFileInputRef = useRef<HTMLInputElement>(null);


  // Gemini API Key - MUST be retrieved from environment variables
  const API_KEY = process.env.API_KEY;
  if (!API_KEY) {
      throw new Error("API_KEY environment variable not set.");
  }
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const categoryOrder = [
    'positiveTestCases',
    'negativeTestCases',
    'edgeCases',
    'securityTestCases',
    'performanceTestCases'
  ];

  // Defines the schema for a single test case object
  const testCaseObjectSchema = {
    type: Type.OBJECT,
    properties: {
      testCaseId: { type: Type.STRING, description: "A unique identifier for the test case (e.g., POS-001)." },
      testCaseTitle: { type: Type.STRING, description: "A short, clear, and descriptive title for the test case objective." },
      description: { type: Type.STRING, description: "A concise description of what the test case covers." },
      precondition: { type: Type.STRING, description: "Conditions that must be true before the test case can be executed. If none, set to 'N/A'." },
      testSteps: { type: Type.STRING, description: "CRITICAL: A single string containing a numbered list. Each step MUST be separated by a newline character (\\n). Test steps MUST be independent and not refer to other test cases." },
      testData: { type: Type.STRING, description: "Suggest any specific data needed to execute the test steps (e.g., username: 'testuser', password: 'password123'). If no specific data is needed, set to 'N/A'." },
      expectedResults: { type: Type.STRING, description: "The expected outcome after executing the test steps. This should be a clear and concise statement." },
      priority: { type: Type.STRING, description: "The priority of the test case (e.g., High, Medium, Low)." },
      status: { type: Type.STRING, description: "The initial status of the test case. Should be 'Not Run'." },
      automationStatus: { type: Type.STRING, description: "Based on the test steps, determine if this test case is a good candidate for UI automation. Set the value to 'Automatable' or 'Not automatable'." },
      testSuite: { type: Type.STRING, description: "Classify the test case. Use 'Smoke' for critical, core functionality checks. Use 'Regression' for tests verifying existing features after changes. Use 'Both' if it qualifies for both categories." },
      bugReference: { type: Type.STRING, description: "A reference to a bug tracking ticket. Should be 'N/A' initially." },
    },
    required: ["testCaseId", "testCaseTitle", "description", "precondition", "testData", "testSteps", "expectedResults", "priority", "status", "automationStatus", "testSuite", "bugReference"]
  };
  
  // Defines the expected JSON structure for the Gemini API response
  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      positiveTestCases: { type: Type.ARRAY, items: testCaseObjectSchema },
      negativeTestCases: { type: Type.ARRAY, items: testCaseObjectSchema },
      edgeCases: { type: Type.ARRAY, items: testCaseObjectSchema },
      securityTestCases: { type: Type.ARRAY, items: testCaseObjectSchema },
      performanceTestCases: { type: Type.ARRAY, items: testCaseObjectSchema },
    },
    required: categoryOrder,
  };
  
  // Auto-resize textareas when test cases are loaded to ensure full visibility
  useLayoutEffect(() => {
    if (testCases) {
      // useLayoutEffect runs synchronously after DOM mutations, so we can be sure the elements exist
      // without needing a setTimeout.
      const textareas = document.querySelectorAll<HTMLTextAreaElement>('[data-autoresize="true"]');
      textareas.forEach(autoResizeTextarea);
    }
  }, [testCases]);


  const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (pdfFiles.length + files.length > 3) {
      setGeneratorError('You can upload a maximum of 3 PDF files.');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    setIsGeneratingTestCases(true);
    setGeneratorError(null);

    const newPdfFiles: { name: string; text: string }[] = [];

    try {
      for (let fIndex = 0; fIndex < files.length; fIndex++) {
        const file = files[fIndex];
        if (file.type !== 'application/pdf') {
          setGeneratorError('Please upload valid PDF files only.');
          continue;
        }

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          
          if (!textContent.items || textContent.items.length === 0) {
            continue;
          }
          
          const sortedItems = (textContent.items
            .filter(item => 'str' in item && item.str.trim() !== '' && 'transform' in item) as { str: string, transform: number[], height?: number }[])
            .sort((a, b) => {
              if (a.transform[5] > b.transform[5]) return -1;
              if (a.transform[5] < b.transform[5]) return 1;
              if (a.transform[4] < b.transform[4]) return -1;
              if (a.transform[4] > b.transform[4]) return 1;
              return 0;
            });
            
          if (sortedItems.length === 0) continue;

          let pageText = '';
          let lastY = sortedItems[0].transform[5];
          let lastHeight = sortedItems[0].height ?? 10; 

          for (const item of sortedItems) {
            const currentY = item.transform[5];
            const currentHeight = item.height ?? lastHeight;
            const yDiff = lastY - currentY;
            
            if (yDiff > lastHeight * 1.5) {
              pageText += '\n\n' + item.str;
            } else if (yDiff > lastHeight * 0.2) {
              pageText += '\n' + item.str;
            } else {
              if (pageText.length > 0 && !pageText.endsWith(' ') && !pageText.endsWith('\n')) {
                pageText += ' ';
              }
              pageText += item.str;
            }
            
            lastY = currentY;
            lastHeight = currentHeight > 0 ? currentHeight : lastHeight;
          }
          
          fullText += pageText + '\n\n';
        }

        const cleanedText = fullText
            .replace(/ +/g, ' ')
            .replace(/ \n/g, '\n')
            .replace(/(\n\s*){3,}/g, '\n\n')
            .trim();

        newPdfFiles.push({ name: file.name, text: cleanedText });
      }

      if (newPdfFiles.length > 0) {
        const updatedList = [...pdfFiles, ...newPdfFiles];
        setPdfFiles(updatedList);
        const combined = updatedList.map(f => `--- Content from ${f.name} ---\n\n${f.text}`).join('\n\n');
        setPdfText(combined);
        setRequirements(prevRequirements => {
          const newAppends = newPdfFiles.map(f => `--- Content from ${f.name} ---\n\n${f.text}`).join('\n\n');
          return prevRequirements ? `${prevRequirements}\n\n${newAppends}` : newAppends;
        });
      }
    } catch (e) {
      setGeneratorError('Failed to read or process the PDF file(s). They might be corrupted or in an unsupported format.');
      console.error(e);
    } finally {
      setIsGeneratingTestCases(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleUiImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file && file.type.startsWith('image/')) {
          if (uiImages.length >= 3) {
              setGeneratorError('You can upload a maximum of 3 images.');
              if(imageInputRef.current) {
                  imageInputRef.current.value = '';
              }
              return;
          }
          setIsGeneratingTestCases(true);
          setGeneratorError(null);
          try {
              const base64Image = await fileToBase64(file);
              setUiImages(prevImages => [...prevImages, {
                  data: base64Image,
                  mimeType: file.type,
                  name: file.name
              }]);
          } catch (e) {
              setGeneratorError('Failed to process image file.');
              console.error(e);
          } finally {
              setIsGeneratingTestCases(false);
              if(imageInputRef.current) {
                  imageInputRef.current.value = '';
              }
          }
      } else if (file) {
          setGeneratorError('Please upload a valid image file.');
      }
  };

  const handleVisualImageUpload = async (event: React.ChangeEvent<HTMLInputElement>, type: 'before' | 'after') => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
        setAnalysisError(null);
        try {
            const base64Image = await fileToBase64(file);
            const imageFile = { data: base64Image, mimeType: file.type, name: file.name };
            if (type === 'before') {
                setBeforeImage(imageFile);
            } else {
                setAfterImage(imageFile);
            }
        } catch (e) {
            setAnalysisError('Failed to process image file.');
            console.error(e);
        } finally {
            if (type === 'before' && beforeImageInputRef.current) {
                beforeImageInputRef.current.value = '';
            } else if (type === 'after' && afterImageInputRef.current) {
                afterImageInputRef.current.value = '';
            }
        }
    } else if (file) {
        setAnalysisError('Please upload a valid image file.');
    }
  };
  
  const handleAccessibilityImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
        setAccessibilityError(null);
        try {
            const base64Image = await fileToBase64(file);
            const imageFile = { data: base64Image, mimeType: file.type, name: file.name };
            setAccessibilityImage(imageFile);
        } catch (e) {
            setAccessibilityError('Failed to process image file.');
            console.error(e);
        } finally {
            if (accessibilityImageInputRef.current) {
                accessibilityImageInputRef.current.value = '';
            }
        }
    } else if (file) {
        setAccessibilityError('Please upload a valid image file.');
    }
  };

  const handleLogUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const maxSize = 5 * 1024 * 1024; // 5MB limit
      if (file.size > maxSize) {
        setLogAnalysisError('Log file size exceeds 5MB limit.');
        return;
      }
      setLogAnalysisError(null);
      try {
        const text = await file.text();
        setLogFile({ content: text, name: file.name });
      } catch (e) {
        setLogAnalysisError('Failed to read log file.');
        console.error(e);
      } finally {
        if (logFileInputRef.current) {
          logFileInputRef.current.value = '';
        }
      }
    }
  };

  const performLogAnalysis = async () => {
    if (!logFile) {
      setLogAnalysisError('Please upload a log file for analysis.');
      return;
    }
    setIsAnalyzingLog(true);
    setLogAnalysisError(null);
    setLogAnalysisReport(null);

    try {
      const prompt = `
        You are an expert system administrator and software engineer specializing in log analysis and point of sale systems (POS). 
        Your task is to analyze the following log file content and provide a detailed, point-wise summary of the information found.
        
        **Instructions:**
        - Identify critical errors, warnings, and unusual patterns.
        - Group information logically (e.g., Error Summary, Performance Observations, System Events).
        - Provide actionable insights or potential causes for any errors found.
        - The summary should be point-wise for better readability.
        
        **Log Content (First 10,000 characters if too long):**
        ${logFile.content.substring(0, 10000)}
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });

      setLogAnalysisReport(response.text);

    } catch (e) {
      setLogAnalysisError('An error occurred during log analysis. Please try again.');
      console.error(e);
    } finally {
      setIsAnalyzingLog(false);
    }
  };

  const handleRemoveImage = (indexToRemove: number) => {
    setUiImages(prevImages => prevImages.filter((_, index) => index !== indexToRemove));
  };

  const handleRemovePdf = (indexToRemove: number) => {
    const updatedList = pdfFiles.filter((_, index) => index !== indexToRemove);
    setPdfFiles(updatedList);
    const combined = updatedList.map(f => `--- Content from ${f.name} ---\n\n${f.text}`).join('\n\n');
    setPdfText(combined);
    if(fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  const handleSkillFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      try {
        const text = await file.text();
        setSkillContent(text);
        setSkillFileName(file.name);
        setGeneratorError(null);
      } catch (e) {
        setGeneratorError('Failed to read SKILL file.');
        console.error(e);
      } finally {
        if (skillFileInputRef.current) {
          skillFileInputRef.current.value = '';
        }
      }
    }
  };

  const handleRemoveSkillFile = () => {
    setSkillFileName('');
    setSkillContent('');
    if (skillFileInputRef.current) {
      skillFileInputRef.current.value = '';
    }
  };

  const handleLoadSampleSkill = () => {
    setSkillFileName('sample-pos-skill.md');
    setSkillContent(`# Point of Sale (POS) QA Architecture & Domain Skill

## Core Domain Testing Guidelines:
1. **Transaction Processing & Payment Methods:**
   - Cash, credit/debit cards (EMV chip, contactless NFC, swipe, manual entry)
   - Split tenders (e.g., partial cash + remaining on credit card, loyalty points + cash)
   - Gift card redemptions, top-ups, and loyalty voucher validations

2. **Pricing & Promotions Engine:**
   - Real-time tax calculation (inclusive vs. exclusive VAT/GST, multi-jurisdiction sales tax)
   - Item discounts, basket-level promo codes, BOGO (Buy One Get One), and tiered mix-and-match deals

3. **Peripheral & Hardware Resilience:**
   - Barcode/QR scanner recognition speed and invalid UPC/EAN fallback
   - Cash drawer kick triggers on exact cash tendered vs card approval
   - Receipt printer out-of-paper / jam recovery without corrupting transaction state
   - Customer-facing display synchronization

4. **Network Outages & Offline Resilience:**
   - Seamless offline transaction queueing during network dropouts
   - Duplicate transaction prevention upon reconnect & background sync
   - Offline floor limits for payment processing

5. **Security & Management Controls:**
   - Supervisor / Manager override permissions (line void, transaction abort, price override, till open)
   - End-of-day Z-Report balancing, float declarations, and till drawer discrepancy detection`);
  };

  const getBaseTestCasePrompt = () => {
    return `You are Test Architect & Quality Advisor who is working for a POS (Point of Sale) application. Your primary goal is to be exhaustive and highly detailed. Focus on generating a comprehensive list of test cases that covers every possible edge case, negative scenario, and boundary condition with extreme precision. Leave no stone unturned.

Based on the provided software requirements and/or UI design images, generate a comprehensive suite of test cases.

**Test Case Generation Philosophy:**

persona:
  style: Comprehensive, systematic, advisory, educational, pragmatic
  identity: Test architect who provides thorough quality assessment and actionable recommendations without blocking progress
  focus: Comprehensive quality analysis through point of sale test architecture, risk assessment, and advisory gates
  core_principles:
    - Depth As Needed - Go deep based on risk signals, stay concise when low risk
    - Requirements Traceability - Map all stories to tests 
    - Risk-Based Testing - Assess and prioritize by probability × impact
    - Quality Attributes - Validate NFRs (security, performance, reliability) via scenarios
    - Testability Assessment - Evaluate controllability, observability, debuggability
    - Advisory Excellence - Educate through documentation, never block arbitrarily
    - Technical Debt Awareness - Identify and quantify debt with improvement suggestions
    - LLM Acceleration - Use LLMs to accelerate thorough yet focused analysis
    - Pragmatic Balance - Distinguish must-fix from nice-to-have improvements

To ensure maximum coverage, think about the test cases in the following layers:

1.  **Positive Scenarios (The "Happy Path"):**
    -   These test cases validate the primary functionality and acceptance criteria.
    -   Focus on the expected user behavior without errors.
    -   Example thinking: "Given a valid user, when they perform a standard action, then the expected successful outcome occurs."

2.  **Negative Scenarios (Error States & Invalid Inputs):**
    -   These test cases ensure the application handles errors gracefully.
    -   Consider what happens when the user provides incorrect data, has insufficient permissions, or tries to perform an action in a disallowed state (e.g., being offline).
    -   Example thinking: "Given a user with the wrong permissions, when they attempt a privileged action, then they should see a clear error message and be blocked." or "Given invalid data in a form, when the user submits, then validation errors should appear."

3.  **Edge Cases (Boundaries & Rare Scenarios):**
    -   These are the tricky, less common scenarios that can often cause bugs.
    -   Think about system limitations (full storage, maximum item limits), environmental factors (losing network connectivity during an operation), and unusual user behavior (logging out during a process).
    -   Example thinking: "Given the system is at its absolute limit (e.g., full storage), when the user tries to add more data, then the system should handle it gracefully with a specific error message."

**Output Format Requirements:**
For each test case, you MUST provide the following details in the specified order:
- Test Case ID: A unique identifier (e.g., POS-001, NEG-001).
- Test Case Title: A short, clear, and descriptive title for the test case objective. It's helpful to write this in a "Given-When-Then" style where appropriate.
- Description: A concise description of what the test case covers.
- Precondition: Conditions that must be true before the test. If none, set to 'N/A'.
- Test Data: Suggest any specific data needed. If none, set to 'N/A'.
- Test Steps: CRITICAL: Each step MUST be on a new line and be independent, self-contained, and suitable for automation. Do not refer to other test cases (e.g., "Continue from TC-001"). Format this as a single string with steps separated by the newline character '\\n'. For example: "1. Go to homepage\\n2. Click login button\\n3. Enter credentials".
- Expected Results: The expected outcome after executing the test steps.
- Priority: The priority of the test case (High, Medium, Low).
- Status: Set the initial status to 'Not Run'.
- Automation Status: Determine if functional test cases (Positive, Negative, Business Logic) are good candidates for UI automation ('Automatable' or 'Not automatable'). For ALL non-functional test categories (like Security, Performance, GDPR, Browser Compatibility, Backend), you MUST set this value to 'Not automatable'.
- Test Suite: Carefully analyze the test case's purpose. Assign 'Smoke' if it tests absolutely critical, build-verifying functionality (e.g., user can log in, main page loads). Assign 'Regression' if it tests a specific existing feature that isn't part of the core smoke suite but needs to be checked against regressions. Assign 'Both' if it's a critical feature that should be in both the smoke and regression suites.
- Bug Reference: Set the initial value to 'N/A'.

You MUST generate test cases for ALL of the following categories. If no specific test cases are relevant for a particular category, you must still include the category key with an empty array in the JSON response. The categories are:
- Positive Test Cases
- Negative Test Cases
- Edge Cases
- Security Test Cases
- Performance Test Cases`;
  };

  const getSkillTestCasePrompt = () => {
    return `You are an expert Test Architect & Quality Assurance specialist.
Follow the instructions, guidelines, persona, rules, and methodologies defined in the following SKILL file to generate test cases based on the provided software requirements and/or UI design images:

==================================================
SKILL FILE INSTRUCTIONS & GUIDELINES:
${skillContent.trim()}
==================================================

**Core Directive:**
Strictly follow and prioritize all testing guidelines, rules, domain knowledge, and instructions provided in the SKILL file above.

**Output Format Requirements:**
For each test case, you MUST provide the following details in the specified order:
- Test Case ID: A unique identifier (e.g., TC-001, POS-001, etc.).
- Test Case Title: A short, clear, and descriptive title for the test case objective.
- Description: A concise description of what the test case covers.
- Precondition: Conditions that must be true before the test. If none, set to 'N/A'.
- Test Data: Suggest any specific data needed. If none, set to 'N/A'.
- Test Steps: CRITICAL: Each step MUST be on a new line and be independent, self-contained, and suitable for automation. Format this as a single string with steps separated by the newline character '\\n' (e.g. "1. Go to homepage\\n2. Click login button\\n3. Enter credentials").
- Expected Results: The expected outcome after executing the test steps.
- Priority: The priority of the test case (High, Medium, Low).
- Status: Set the initial status to 'Not Run'.
- Automation Status: Determine if functional test cases are good candidates for UI automation ('Automatable' or 'Not automatable'). Non-functional categories must be 'Not automatable'.
- Test Suite: Assign 'Smoke' for critical path functionality, 'Regression' for regression test cases, or 'Both' if applicable.
- Bug Reference: Set to 'N/A'.

Organize the generated test cases into the appropriate categories (Positive Test Cases, Negative Test Cases, Edge Cases, Security Test Cases, Performance Test Cases) as required by the response schema.`;
  };

  const getCombinedPromptPreview = () => {
    let preview = '';
    if (skillContent.trim()) {
      preview = `=== PROMPT SOURCE: SKILL FILE INSTRUCTIONS (${skillFileName || 'custom-skill'}) ===\n${getSkillTestCasePrompt()}`;
    } else {
      preview = `=== PROMPT SOURCE: DEFAULT APP EMBEDDED PROMPT ===\n${getBaseTestCasePrompt()}`;
    }
    const combinedReq = `${pdfText}\n\n${requirements}`.trim();
    if (combinedReq) {
      preview += `\n\n=== SOFTWARE REQUIREMENTS ===\n${combinedReq}`;
    } else {
      preview += `\n\n=== SOFTWARE REQUIREMENTS ===\n(Requirements will be appended here when provided)`;
    }
    if (uiImages.length > 0) {
      preview += `\n\n=== UI IMAGES ===\n${uiImages.length} image(s) attached: ${uiImages.map(img => img.name).join(', ')}`;
    }
    return preview;
  };

  const generateAmbiguityReport = async () => {
    if (!requirements && uiImages.length === 0 && !pdfText) {
      setAmbiguityError('Please provide software requirements or a UI design to generate a report.');
      return;
    }
    setIsGeneratingAmbiguities(true);
    setAmbiguityError(null);
    setTestCases(null);
    setMindMapText(null);
    setAmbiguityReport(null);

    try {
      const combinedRequirements = `${pdfText}\n\n${requirements}`.trim();

      let prompt = `
      == YOUR PROCESS ==
      1. Analyse the Input: The user will provide a user story or requirement. This should be taken from the uploaded requirements.
      2. Identify Ambiguities: First, list any "Questions for the Product Manager". These are vague terms or missing rules (e.g., "What does 'fast' mean?", "How many articles can be downloaded?", "Do downloads expire?").

      == OUTPUT FORMAT ==
      You MUST return your analysis in this exact Markdown format:

      # QA Analysis Report
      **User Story:** ${combinedRequirements}

      ## 1. ❓ Ambiguities & Questions
      - (Questions for the Product Manager to clarify requirements)
      - [Question 1]
      - [Question 2]
      - ...
      `;

      if (skillContent.trim()) {
        prompt += `\n\n**Additional QA Domain SKILL Guidelines:**\n${skillContent.trim()}`;
      }
      
      const parts = [];
      if (combinedRequirements) {
          parts.push({ text: prompt });
      }

      if (uiImages.length > 0) {
          uiImages.forEach(image => {
              parts.push({
                  inlineData: {
                      data: image.data,
                      mimeType: image.mimeType
                  }
              });
          });
      }
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts: parts },
      });

      setAmbiguityReport(response.text);

    } catch (e) {
      setAmbiguityError('An error occurred while analyzing ambiguities. Please try again.');
      console.error(e);
    } finally {
      setIsGeneratingAmbiguities(false);
    }
  };

  const generateTestCases = async () => {
    if (!requirements && uiImages.length === 0 && !pdfText) {
      setGeneratorError('Please provide software requirements or a UI design to generate test cases.');
      return;
    }
    setIsGeneratingTestCases(true);
    setGeneratorError(null);
    setTestCases(null);
    setMindMapText(null);
    setAmbiguityReport(null);

    try {
      const model = 'gemini-3-flash-preview';
      const promptText = skillContent.trim() ? getSkillTestCasePrompt() : getBaseTestCasePrompt();

      const parts = [];
      const combinedRequirements = `${pdfText}\n\n${requirements}`.trim();

      if (combinedRequirements) {
          parts.push({ text: `Software Requirements:\n${combinedRequirements}` });
      }

      if (uiImages.length > 0) {
          uiImages.forEach(image => {
              parts.push({
                  inlineData: {
                      data: image.data,
                      mimeType: image.mimeType
                  }
              });
          });
      }

      const response = await ai.models.generateContent({
        model: model,
        contents: { parts: [...parts, { text: promptText }] },
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        },
      });

      const jsonString = response.text.trim();
      const resultObject = JSON.parse(jsonString);
      setTestCases(resultObject);

    } catch (e) {
      setGeneratorError('An error occurred while generating test cases. Please check your API key and try again.');
      console.error(e);
    } finally {
      setIsGeneratingTestCases(false);
    }
  };
  
  const performVisualAnalysis = async () => {
    if (!beforeImage || !afterImage) {
        setAnalysisError('Please upload both a "Design Image" and an "Implemented Image".');
        return;
    }
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    try {
        let prompt = `
        You are an expert QA engineer specializing in visual regression testing. Your task is to compare a "Design Image" with an "Implemented Image".

        **Primary Goal:** Identify and describe all meaningful visual and functional discrepancies. Focus on deviations a user or designer would notice, not minor pixel-level differences.

        **Output Structure:**
        Your analysis MUST be a well-structured markdown document. Create a main "Overall Summary" section first. Then, provide a detailed breakdown using the following mandatory categories as level-2 headings (##). For each discrepancy, use a bullet point (*). If a category has no issues, state "No issues found." under that heading. Use **bold** text for key elements you are referencing.
        - ## Overall Summary
        - ## Content Mismatches
        - ## Style & Branding Deviations
        - ## Layout & Spacing Issues
        - ## Missing Elements
        - ## Extra Elements

        **Analysis:**
        - **Be specific:** Instead of "button is wrong," say "The **Submit** button's background color is #5A67D8 instead of the design's #4F46E5."
        - **Clarity is key:** The output should be easy for a developer or designer to read and action. If the implementation perfectly matches the design, state that clearly in the summary.
        `;

        if (visualAnalysisPrompt.trim()) {
            prompt += `
            \n**User-Specific Instructions:**
            In addition to the standard analysis, pay close attention to the following user-provided instructions: "${visualAnalysisPrompt}"
            `;
        }

        const parts = [
            { text: prompt },
            { text: "Here is the 'Design Image':" },
            { inlineData: { data: beforeImage.data, mimeType: beforeImage.mimeType } },
            { text: "And here is the 'Implemented Image':" },
            { inlineData: { data: afterImage.data, mimeType: afterImage.mimeType } },
        ];

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { parts: parts },
        });

        setAnalysisResult(response.text);

    } catch (e) {
        setAnalysisError('An error occurred during the visual analysis. Please try again.');
        console.error(e);
    } finally {
        setIsAnalyzing(false);
    }
  };

  const performAccessibilityCheck = async () => {
    if (!accessibilityImage) {
        setAccessibilityError('Please upload a UI image for analysis.');
        return;
    }
    setIsCheckingAccessibility(true);
    setAccessibilityError(null);
    setAccessibilityReport(null);

    try {
        const prompt = `
        You are an expert accessibility (a11y) consultant. Your task is to analyze the following UI design image based on the latest Web Content Accessibility Guidelines (WCAG).

        Provide a comprehensive accessibility assessment report. Structure your report starting with the following sections at the very top:

        1.  **Ratings:** A markdown table that provides a score out of 10 for the following key accessibility areas. Provide a rating even if the area is not applicable (e.g., rate 'Form Usability' as N/A or 10 if no forms are present).
            | Area                      | Rating (out of 10) |
            | ------------------------- | ------------------ |
            | Color Contrast            | [Your rating]      |
            | Text Readability          | [Your rating]      |
            | Interactive Element Size  | [Your rating]      |
            | Form Usability            | [Your rating]      |
            | Overall Compliance        | [Your rating]      |

        2.  **Overall Summary:** After the table, provide a brief, high-level overview of the design's accessibility posture.

        Following the summary, provide a detailed breakdown with these sections:
        -   **Color Contrast:** Identify all instances of text and UI elements with insufficient color contrast against their background. For each instance, state the foreground/background colors and the contrast ratio if possible.
        -   **Text Readability:** Evaluate font sizes, font weights, and line spacing. Note any text that may be too small or difficult to read.
        -   **Interactive Element Size:** Check the size of all interactive elements (buttons, links, form controls). Identify any "tap targets" that might be too small for users with motor impairments, especially on mobile devices.
        -   **Image Alt Text:** Identify all images that would require descriptive alternative text for screen reader users and suggest what the alt text should convey.
        -   **Form Labeling:** If forms are present, check if all input fields have clear, visible labels.
        -   **Clarity and Consistency:** Assess the overall layout for clarity, logical reading order, and consistent design patterns.
        -   **Recommendations:** Provide a prioritized list of actionable recommendations to improve the accessibility of this UI.

        Format the entire output as a single block of well-structured markdown. Use headings, bold text, and bullet points to make the report easy to read.
        `;

        const parts = [
            { text: prompt },
            { inlineData: { data: accessibilityImage.data, mimeType: accessibilityImage.mimeType } },
        ];

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { parts: parts },
        });

        setAccessibilityReport(response.text);

    } catch (e) {
        setAccessibilityError('An error occurred during the accessibility analysis. Please try again.');
        console.error(e);
    } finally {
        setIsCheckingAccessibility(false);
    }
  };


  const handleTestCaseChange = (category: string, index: number, field: keyof TestCase, value: string) => {
    setTestCases(prevTestCases => {
        if (!prevTestCases) return null;
        
        const newTestCases = JSON.parse(JSON.stringify(prevTestCases));

        if (newTestCases[category] && newTestCases[category][index]) {
            newTestCases[category][index][field] = value;
        }

        return newTestCases;
    });
  };

  const generateCucumberScripts = async () => {
    if (!testCases) {
        setScriptError("No test cases available to convert.");
        return;
    }

    setIsGeneratingScript(true);
    setScriptError(null);

    try {
        const functionalTestCases = {
            positiveTestCases: testCases.positiveTestCases || [],
            negativeTestCases: testCases.negativeTestCases || [],
            edgeCases: testCases.edgeCases || [],
        };

        if (
            functionalTestCases.positiveTestCases.length === 0 &&
            functionalTestCases.negativeTestCases.length === 0 &&
            functionalTestCases.edgeCases.length === 0
        ) {
            setScriptError("No functional test cases (Positive, Negative, Edge Cases) found to convert.");
            setIsGeneratingScript(false);
            return;
        }

        const prompt = `
        Convert the following JSON test cases into a single, comprehensive Gherkin feature file (.feature).
        
        **Gherkin Structure:**
        - Use the 'Feature' keyword for the overall feature.
        - **Scenario Outlines:** Prefer using 'Scenario Outline' to reduce duplication. If multiple test cases share the same sequence of steps but differ only in their input data (acceptance criteria), consolidate them into a single Scenario Outline. Move the varying data points into an 'Examples' table.
        - For individual, unique test cases that don't fit a pattern, use the 'Scenario' keyword.
        - Use 'Given', 'When', 'And', and 'Then' steps derived from the 'precondition', 'testSteps', and 'expectedResults'.
        - Include the 'testCaseId' and 'testCaseTitle' in the Scenario title, or use a descriptive title for Scenario Outlines that reflects the group of tests.
        - Use tags (e.g., @Positive, @Negative, @BusinessLogic) based on the test case category.
        - If 'testData' is provided, incorporate it as variables in the steps (e.g., <variableName>) and include them in the 'Examples' table.

        **Example of Scenario Outline usage:**
        Scenario Outline: The list orders process an list orders request
            Given the earliest date <earliestDate> 
            And the latest date <latestDate>
            And the page size <pageSize>
            And the page offset <pageOffset>
            When the list orders process is executed
            Then the process outcome should be success
            And the process should return list orders response
           
        **General Instructions:**
        -   The output must be ONLY the raw Gherkin / Cucumber feature file text, without any markdown formatting, explanations, or code fences (\`\`\`).
        -   Ensure the syntax is valid Gherkin.

        Here is the JSON data containing the test cases to convert:
        ${JSON.stringify(functionalTestCases, null, 2)}
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
        });

        const scriptContent = response.text;

        const blob = new Blob([scriptContent], { type: 'text/plain;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'tests.feature');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

    } catch (e) {
        setScriptError('An error occurred while generating the Cucumber scripts. Please try again.');
        console.error(e);
    } finally {
        setIsGeneratingScript(false);
    }
  };

  const generateMindMap = async () => {
    if (!requirements && uiImages.length === 0 && !pdfText) {
        setMindMapError('Please provide software requirements or a UI design to generate a mind map.');
        return;
    }
    setIsGeneratingMindMap(true);
    setMindMapError(null);
    setMindMapText(null);
    setTestCases(null);
    setAmbiguityReport(null);
    
    try {
        const promptText = `
        Based on the provided software requirements and/or UI design images, generate a concise mind map structure as a JSON object.
        The output must be ONLY the raw JSON object, without any markdown formatting (like \`\`\`json), explanations, or other text.

        The JSON must follow this structure:
        {
          "name": "Root Node Title",
          "children": [
            {
              "name": "Main Branch 1",
              "children": [
                { "name": "Sub-branch 1.1" },
                { "name": "Sub-branch 1.2" }
              ]
            },
            {
              "name": "Main Branch 2"
            }
          ]
        }

        Start with a root node that represents the application's main purpose or title.
        Create main branches for each major feature, user flow, or component described.
        Under each main branch, add sub-branches for specific functionalities, user actions, data inputs, and expected outcomes.
        Keep the text for each node concise and clear.`;
        
        const parts = [];
        const combinedRequirements = `${pdfText}\n\n${requirements}`.trim();

        if (combinedRequirements) {
            parts.push({ text: `Software Requirements:\n${combinedRequirements}` });
        }
        if (skillContent.trim()) {
            parts.push({ text: `Additional QA Domain SKILL Guidelines:\n${skillContent.trim()}` });
        }
        if (uiImages.length > 0) {
            uiImages.forEach(image => {
                parts.push({
                    inlineData: {
                        data: image.data,
                        mimeType: image.mimeType
                    }
                });
            });
        }

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { parts: [...parts, { text: promptText }] },
            config: {
              responseMimeType: "application/json",
            }
        });
        
        const mindMapJsonString = response.text.trim();
        const simpleMindMap = JSON.parse(mindMapJsonString);

        const indentedText = convertJsonToIndentedText(simpleMindMap);
        setMindMapText(indentedText);
        setCopySuccess('');

    } catch(e) {
        setMindMapError(e instanceof Error ? e.message : 'An error occurred while creating the mind map. Please try again.');
        console.error(e);
    } finally {
        setIsGeneratingMindMap(false);
    }
  };

  const handleCopyMindMap = () => {
    if (mindMapText) {
        navigator.clipboard.writeText(mindMapText).then(() => {
            setCopySuccess('Copied!');
            setTimeout(() => setCopySuccess(''), 2000);
        }, (err) => {
            setCopySuccess('Failed to copy.');
            console.error('Could not copy text: ', err);
        });
    }
  };

  const downloadCsv = () => {
    if (!testCases) return;

    const headers = [
        "Test Category",
        "Test Case ID",
        "Test Case Title",
        "Description",
        "Precondition",
        "Test Data",
        "Test Steps",
        "Expected Results",
        "Priority",
        "Status",
        "Automation Status",
        "Test Suite",
        "Bug Reference"
    ];
    
    const escapeCsv = (field: string) => {
        if (field === null || field === undefined) return '';
        const str = String(field);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const csvRows = [headers.join(',')];

    categoryOrder.forEach(category => {
        if (testCases[category] && testCases[category].length > 0) {
            const formattedCategory = formatCategoryName(category);
            testCases[category].forEach(testCase => {
                const row = [
                    escapeCsv(formattedCategory),
                    escapeCsv(testCase.testCaseId),
                    escapeCsv(testCase.testCaseTitle),
                    escapeCsv(testCase.description),
                    escapeCsv(testCase.precondition),
                    escapeCsv(testCase.testData),
                    escapeCsv(testCase.testSteps),
                    escapeCsv(testCase.expectedResults),
                    escapeCsv(testCase.priority),
                    escapeCsv(testCase.status),
                    escapeCsv(testCase.automationStatus),
                    escapeCsv(testCase.testSuite),
                    escapeCsv(testCase.bugReference)
                ];
                csvRows.push(row.join(','));
            });
        }
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-t;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'test_cases.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
  };

  const downloadAccessibilityReportAsPdf = () => {
    if (!accessibilityReport) return;

    const reportWindow = window.open('', '_blank');
    if (reportWindow) {
        // Basic escaping to prevent HTML injection
        const escapedReport = accessibilityReport
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

        reportWindow.document.write(`
            <html>
                <head>
                    <title>Accessibility Report</title>
                    <style>
                        body { font-family: sans-serif; line-height: 1.6; padding: 2rem; }
                        h1, h2 { color: #333; }
                        table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #f2f2f2; }
                        pre { background-color: #eee; padding: 1rem; white-space: pre-wrap; word-wrap: break-word; }
                    </style>
                </head>
                <body>
                    <h1>Accessibility Analysis Report</h1>
                    <pre>${escapedReport}</pre>
                </body>
            </html>
        `);
        reportWindow.document.close();
        
        // Give the content time to render before printing
        setTimeout(() => {
            reportWindow.print();
        }, 500);
    }
  };
  
  const anyTaskRunning = isGeneratingTestCases || isGeneratingMindMap || isGeneratingAmbiguities;

  return (
    <>
      <style>{`
        :root {
          --primary-color: #4f46e5;
          --primary-hover: #4338ca;
          --secondary-color: #1e293b;
          --border-color: #cbd5e1;
          --background-color: #ffffff;
          --text-color: #334155;
          --light-text-color: #64748b;
          --error-color: #dc2626;
          --success-color: #16a34a;
          --container-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
        }
        .main-container {
          width: 100%;
          max-width: 1200px;
          margin: 0 auto;
          background-color: var(--background-color);
          border-radius: 0.75rem;
          box-shadow: var(--container-shadow);
          overflow: hidden;
        }
        header {
          padding: 1.5rem 2rem;
          border-bottom: 1px solid var(--border-color);
          background-color: #f8fafc;
          text-align: center;
        }
        .header-brand {
            color: #2563eb;
            font-size: 1.125rem;
            margin: 0 0 0.25rem 0;
            font-weight: 500;
        }
        .header-motto {
            color: var(--light-text-color);
            font-size: 0.875rem;
            margin: 0.5rem 0 0 0;
            font-weight: 400;
        }
        header h1 {
          font-size: 1.875rem;
          font-weight: 700;
          color: var(--secondary-color);
          margin: 0;
        }
        .tabs {
          display: flex;
          border-bottom: 1px solid var(--border-color);
          padding: 0 2rem;
          background-color: #f8fafc;
        }
        .tab-button {
          padding: 1rem 0.5rem;
          margin-right: 1.5rem;
          border: none;
          background: none;
          cursor: pointer;
          font-size: 1rem;
          font-weight: 500;
          color: var(--light-text-color);
          border-bottom: 2px solid transparent;
          transition: all 0.2s ease-in-out;
        }
        .tab-button.active {
          color: var(--primary-color);
          border-bottom-color: var(--primary-color);
        }
        .tab-button:hover {
          color: var(--primary-color);
        }
        .tab-content {
          padding: 2rem;
        }
        .grid-cols-2 {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 2rem;
        }
        .col-span-full {
            grid-column: 1 / -1;
        }
        .input-group {
          margin-bottom: 1.5rem;
        }
        .input-group h2, .input-group h3 {
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--secondary-color);
          margin: 0 0 0.75rem 0;
        }
        textarea {
          width: 100%;
          min-height: 150px;
          padding: 0.75rem 1rem;
          border: 1px solid var(--border-color);
          border-radius: 0.5rem;
          font-size: 1rem;
          line-height: 1.5;
          color: var(--text-color);
          transition: border-color 0.2s, box-shadow 0.2s;
          box-sizing: border-box;
          resize: vertical;
        }
        textarea:focus {
          outline: none;
          border-color: var(--primary-color);
          box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.2);
        }
        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.625rem 1.25rem;
          border: 1px solid transparent;
          border-radius: 0.5rem;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease-in-out;
          text-decoration: none;
        }
        .btn-primary {
          background-color: var(--primary-color);
          color: white;
        }
        .btn-primary:hover {
          background-color: var(--primary-hover);
        }
        .btn-primary:disabled {
          background-color: #a5b4fc;
          cursor: not-allowed;
        }
        .btn-secondary {
            background-color: var(--background-color);
            color: var(--secondary-color);
            border-color: var(--border-color);
        }
        .btn-secondary:hover {
            background-color: #f1f5f9;
        }
        .btn-tertiary {
            background-color: #f97316;
            color: white;
        }
        .btn-tertiary:hover {
            background-color: #ea580c;
        }
        .btn-icon {
          margin-right: 0.5rem;
        }
        .spinner {
          width: 1.25rem;
          height: 1.25rem;
          border: 2px solid currentColor;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .error-message {
          color: var(--error-color);
          background-color: #fee2e2;
          border: 1px solid #fecaca;
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          margin-top: 1rem;
        }
        .results-container {
          margin-top: 2rem;
          border-top: 1px solid var(--border-color);
          padding-top: 2rem;
        }
        .results-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
            flex-wrap: wrap;
            gap: 1rem;
        }
        .results-header h2 {
          font-size: 1.5rem;
          font-weight: 600;
          margin: 0;
        }
        .category-container {
          margin-bottom: 2.5rem;
        }
        .category-title {
          font-size: 1.25rem;
          font-weight: 600;
          margin-bottom: 1rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid var(--border-color);
        }
        .table-wrapper {
          overflow-x: auto;
          margin-top: 1rem;
        }
        .test-case-table {
          width: 100%;
          min-width: 1200px;
          border-collapse: collapse;
          font-size: 0.9rem;
        }
        .test-case-table th, .test-case-table td {
          border: 1px solid var(--border-color);
          padding: 0.5rem 0.75rem;
          text-align: left;
          vertical-align: top;
        }
        .test-case-table thead th {
          background-color: #f8fafc;
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 1;
        }
        .editable-textarea {
          width: 100%;
          border: none;
          padding: 0;
          margin: 0;
          background-color: transparent;
          font-family: inherit;
          font-size: inherit;
          color: inherit;
          resize: none;
          overflow: hidden;
          line-height: 1.5;
        }
        .editable-textarea:focus {
          outline: none;
          box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.2);
          border-radius: 0.25rem;
        }
        .upload-section {
            border: 2px dashed var(--border-color);
            border-radius: 0.5rem;
            padding: 1.5rem;
            text-align: center;
            background-color: #f8fafc;
            margin-bottom: 1rem;
        }
        .upload-section p {
            margin: 0 0 1rem 0;
            color: var(--light-text-color);
        }
        .file-list {
            list-style: none;
            padding: 0;
            margin: 1rem 0 0 0;
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem;
            justify-content: center;
        }
        .file-item {
            display: inline-flex;
            align-items: center;
            background-color: #eef2ff;
            color: #4338ca;
            padding: 0.5rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.875rem;
            font-weight: 500;
        }
        .remove-btn {
            background: none;
            border: none;
            color: #6366f1;
            margin-left: 0.5rem;
            cursor: pointer;
            padding: 0;
            line-height: 1;
        }
        .remove-btn:hover {
            color: var(--primary-hover);
        }
        .analysis-container {
            border-top: 1px solid var(--border-color);
            padding-top: 1.5rem;
            margin-top: 1.5rem;
        }
        .analysis-container h3 {
            font-size: 1.25rem;
            margin-top: 0;
        }
        .markdown-content {
          line-height: 1.7;
        }
        .markdown-content h1, .markdown-content h2, .markdown-content h3, .markdown-content h4 {
          font-weight: 600;
          margin-top: 1.5em;
          margin-bottom: 0.5em;
        }
        .markdown-content p { margin: 0 0 1em 0; }
        .markdown-content ul, .markdown-content ol { padding-left: 1.5rem; margin-bottom: 1em; }
        .markdown-content li { margin-bottom: 0.25em; }
        .markdown-content code {
          background-color: #f1f5f9;
          color: #334155;
          padding: 0.2em 0.4em;
          border-radius: 0.25rem;
          font-size: 0.9em;
        }
        .markdown-content table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 1em;
        }
        .markdown-content th, .markdown-content td {
          border: 1px solid var(--border-color);
          padding: 0.5rem 0.75rem;
          text-align: left;
        }
        .markdown-content th {
          background-color: #f8fafc;
          font-weight: 600;
        }
        .markdown-content strong {
            font-weight: 600;
        }
        .image-preview-container {
            position: relative;
            max-width: 300px;
            margin: 1rem auto;
        }
        .image-preview {
            width: 100%;
            height: auto;
            border-radius: 0.5rem;
            border: 1px solid var(--border-color);
        }
        .remove-image-btn {
            position: absolute;
            top: 0.5rem;
            right: 0.5rem;
            background-color: rgba(0,0,0,0.5);
            color: white;
            border: none;
            border-radius: 50%;
            width: 1.5rem;
            height: 1.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
        }
        .image-previews-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 1rem;
            margin-top: 1.5rem;
        }
        .image-previews-grid .image-preview-container {
            margin: 0;
            max-width: 100%;
        }
        .mind-map-container {
            background-color: #f8fafc;
            border: 1px solid var(--border-color);
            border-radius: 0.5rem;
            padding: 1.5rem;
            margin-top: 1rem;
        }
        .mind-map-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }
        .mind-map-header p {
            margin: 0;
            color: var(--light-text-color);
        }
        .mind-map-content {
            white-space: pre;
            font-family: monospace;
            background-color: white;
            padding: 1rem;
            border-radius: 0.25rem;
            overflow-x: auto;
        }
        .copy-success-msg {
            color: var(--success-color);
            font-weight: 500;
            margin-left: 1rem;
        }
        .loading-overlay {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background-color: rgba(255, 255, 255, 0.8);
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          z-index: 10;
        }
        .loading-text {
            margin-top: 1rem;
            font-weight: 500;
            color: var(--secondary-color);
        }
        .relative-container {
            position: relative;
        }
      `}</style>
      <main className="main-container">
        <header>
          <div className="header-brand">Enactor</div>
          <h1>AI QA Assistant</h1>
          <p className="header-motto">A tool that generates comprehensive test cases, mind maps, ambiguities, feature files, visual regression analysis, log analysis and checks accessibility.</p>
        </header>
        <nav className="tabs">
          <button className={`tab-button ${activeTab === 'generator' ? 'active' : ''}`} onClick={() => setActiveTab('generator')}>
            Test Cases & Scripts Generator
          </button>
          <button className={`tab-button ${activeTab === 'visual' ? 'active' : ''}`} onClick={() => setActiveTab('visual')}>
            Visual Regression Analyzer
          </button>
          <button className={`tab-button ${activeTab === 'log-analyser' ? 'active' : ''}`} onClick={() => setActiveTab('log-analyser')}>
            Log Analyser
          </button>
          <button className={`tab-button ${activeTab === 'accessibility' ? 'active' : ''}`} onClick={() => setActiveTab('accessibility')}>
            Accessibility Checker
          </button>
        </nav>
        <div className="tab-content">
          {activeTab === 'generator' && (
            <div className="relative-container">
              {anyTaskRunning && (
                <div className="loading-overlay">
                  <div className="spinner"></div>
                  <p className="loading-text">
                    {isGeneratingAmbiguities ? 'Analyzing requirements...' :
                     isGeneratingTestCases ? 'Generating test cases...' :
                     'Generating mind map...'}
                  </p>
                </div>
              )}
              <div className="input-group">
                <h2>1. Provide Your Requirements</h2>
                <textarea
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  placeholder="Paste your software requirements, user stories, or feature descriptions here..."
                  aria-label="1. Provide Your Requirements"
                />
              </div>

              <div className="input-group">
                <h2 style={{ textAlign: 'center' }}>OR</h2>
                <div className="upload-section">
                  <p>Upload up to 3 PDFs of requirements, or up to 3 UI images (PNG, JPG, etc.)</p>
                  <div>
                    <input type="file" id="pdf-upload" accept="application/pdf" multiple onChange={handlePdfUpload} ref={fileInputRef} style={{ display: 'none' }} />
                    <label htmlFor="pdf-upload" className="btn btn-secondary" style={{ marginRight: '0.5rem' }}>
                        Upload PDF {pdfFiles.length > 0 ? `(${pdfFiles.length}/3)` : ''}
                    </label>
                    <input type="file" id="image-upload" accept="image/*" multiple onChange={handleUiImageUpload} ref={imageInputRef} style={{ display: 'none' }} />
                    <label htmlFor="image-upload" className="btn btn-secondary">
                        Upload Image {uiImages.length > 0 ? `(${uiImages.length}/3)` : ''}
                    </label>
                  </div>
                  {pdfFiles.length > 0 && (
                    <ul className="file-list">
                      {pdfFiles.map((file, index) => (
                        <li key={index} className="file-item">
                            📄 {file.name}
                            <button onClick={() => handleRemovePdf(index)} className="remove-btn" aria-label={`Remove ${file.name}`}>&times;</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {uiImages.length > 0 && (
                      <div className="image-previews-grid">
                          {uiImages.map((image, index) => (
                              <div key={index} className="image-preview-container">
                                  <img 
                                      src={`data:${image.mimeType};base64,${image.data}`} 
                                      alt={image.name}
                                      title={image.name}
                                      className="image-preview"
                                  />
                                  <button onClick={() => handleRemoveImage(index)} className="remove-image-btn" aria-label={`Remove ${image.name}`}>&times;</button>
                              </div>
                          ))}
                      </div>
                  )}
                </div>
              </div>

              {/* SKILL File and Embedded Prompt Section */}
              <div className="input-group" style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                    2. Add SKILL File &amp; Domain Guidelines (Optional)
                  </h2>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {!skillContent && (
                      <button
                        type="button"
                        onClick={handleLoadSampleSkill}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
                      >
                        Load Sample POS Skill
                      </button>
                    )}
                    {skillContent && (
                      <button
                        type="button"
                        onClick={handleRemoveSkillFile}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem', color: 'var(--error-color)' }}
                      >
                        Clear Skill
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowPromptPreview(!showPromptPreview)}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
                    >
                      {showPromptPreview ? '👁️ Hide LLM Prompt Preview' : '👁️ View Embedded Prompt & SKILL Preview'}
                    </button>
                  </div>
                </div>

                <div 
                  className="upload-section" 
                  style={{ 
                    textAlign: 'left', 
                    backgroundColor: skillContent ? '#f0fdf4' : '#f8fafc', 
                    borderColor: skillContent ? '#86efac' : 'var(--border-color)',
                    padding: '1.25rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, color: 'var(--secondary-color)', fontSize: '0.95rem' }}>
                        Attach a SKILL file (e.g. <code>SKILL.md</code>, <code>.txt</code>, <code>.json</code>) or type domain instructions below:
                      </p>
                      <span style={{ fontSize: '0.825rem', color: 'var(--light-text-color)' }}>
                        The LLM will ingest both the embedded Test Architect prompt and this SKILL file before generating test cases.
                      </span>
                    </div>
                    <div>
                      <input 
                        type="file" 
                        id="skill-file-upload" 
                        accept=".md,.txt,.json,.yaml,.yml,.skill,text/*" 
                        onChange={handleSkillFileUpload} 
                        ref={skillFileInputRef} 
                        style={{ display: 'none' }} 
                      />
                      <label htmlFor="skill-file-upload" className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                        📁 Upload SKILL File
                      </label>
                    </div>
                  </div>

                  {skillFileName && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', backgroundColor: '#dcfce7', color: '#166534', padding: '0.35rem 0.75rem', borderRadius: '9999px', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.75rem' }}>
                      <span>📄 {skillFileName}</span>
                      <button onClick={handleRemoveSkillFile} className="remove-btn" style={{ color: '#15803d', marginLeft: '0.5rem', fontWeight: 'bold' }} aria-label={`Remove ${skillFileName}`}>&times;</button>
                    </div>
                  )}

                  <textarea
                    value={skillContent}
                    onChange={(e) => setSkillContent(e.target.value)}
                    placeholder="Paste or edit SKILL.md content here (e.g., POS terminal rules, payment gateway test patterns, tax rules, regulatory compliance)..."
                    aria-label="SKILL File Content"
                    style={{ minHeight: '120px', fontFamily: 'monospace', fontSize: '0.875rem', backgroundColor: '#ffffff' }}
                  />
                </div>

                {showPromptPreview && (
                  <div style={{ marginTop: '1rem', padding: '1.25rem', backgroundColor: '#0f172a', color: '#e2e8f0', borderRadius: '0.5rem', border: '1px solid #334155' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid #334155', paddingBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#38bdf8' }}>
                        🤖 LLM Ingestion Preview: Embedded System Prompt + SKILL File
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        Exact prompt sent to Gemini on &apos;Generate Test Cases&apos;
                      </span>
                    </div>
                    <pre style={{ margin: 0, maxHeight: '320px', overflowY: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: '1.5', color: '#cbd5e1' }}>
                      {getCombinedPromptPreview()}
                    </pre>
                  </div>
                )}
              </div>
              
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button onClick={generateAmbiguityReport} className="btn btn-primary" disabled={anyTaskRunning || (!requirements && uiImages.length === 0 && !pdfText)}>
                      <span className="btn-icon">
                          {isGeneratingAmbiguities ? <div className="spinner"></div> : '❓'}
                      </span>
                      1. Ambiguities & Questions
                  </button>
                  <button onClick={generateMindMap} className="btn btn-tertiary" disabled={anyTaskRunning || (!requirements && uiImages.length === 0 && !pdfText)}>
                      <span className="btn-icon">
                          {isGeneratingMindMap ? <div className="spinner"></div> : '🧠'}
                      </span>
                      2. Generate Mind Map for Xmind
                  </button>
                  <button onClick={generateTestCases} className="btn btn-primary" disabled={anyTaskRunning || (!requirements && uiImages.length === 0 && !pdfText)}>
                    <span className="btn-icon">
                      {isGeneratingTestCases ? <div className="spinner"></div> : '✨'}
                    </span>
                    3. Generate Test Cases
                  </button>
              </div>

              {generatorError && <p className="error-message">{generatorError}</p>}
              {mindMapError && <p className="error-message">{mindMapError}</p>}
              {ambiguityError && <p className="error-message">{ambiguityError}</p>}

              {ambiguityReport && (
                <div className="results-container">
                    <div className="markdown-content"
                        dangerouslySetInnerHTML={{ __html: ambiguityReport
                            .replace(/^# (.*$)/gm, '<h2>$1</h2>')
                            .replace(/^## (.*$)/gm, '<h3>$1</h3>')
                            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                            .replace(/\n/g, '<br />')
                        }}
                    ></div>
                </div>
              )}

              {mindMapText && !testCases && (
                  <div className="results-container">
                    <div className="mind-map-container">
                        <div className="mind-map-header">
                            <p>Copy the text below and paste it into Xmind to create a mind map.</p>
                            <div>
                                <button onClick={handleCopyMindMap} className="btn btn-secondary">
                                    Copy Text
                                </button>
                                {copySuccess && <span className="copy-success-msg">{copySuccess}</span>}
                            </div>
                        </div>
                        <pre className="mind-map-content"><code>{mindMapText}</code></pre>
                    </div>
                  </div>
              )}

              {testCases && (
                <div className="results-container">
                    <div className="results-header">
                        <h2>2. Generated Test Cases (Editable)</h2>
                        <div>
                            <button onClick={downloadCsv} className="btn btn-secondary">Download CSV</button>
                            <button 
                                onClick={generateCucumberScripts} 
                                className="btn btn-secondary" 
                                style={{ marginLeft: '0.5rem' }}
                                disabled={isGeneratingScript}
                            >
                                {isGeneratingScript ? <div className="spinner" style={{marginRight: '0.5rem'}}></div> : null}
                                Generate Cucumber scripts
                            </button>
                        </div>
                    </div>
                    {scriptError && <p className="error-message">{scriptError}</p>}
                    
                    {mindMapText && (
                        <div className="mind-map-container">
                            <div className="mind-map-header">
                                <p>Copy the text below and paste it into Xmind to create a mind map.</p>
                                <div>
                                    <button onClick={handleCopyMindMap} className="btn btn-secondary">
                                        Copy Text
                                    </button>
                                    {copySuccess && <span className="copy-success-msg">{copySuccess}</span>}
                                </div>
                            </div>
                            <pre className="mind-map-content"><code>{mindMapText}</code></pre>
                        </div>
                    )}

                  {categoryOrder.map(category => (
                    testCases[category] && testCases[category].length > 0 && (
                      <div key={category} className="category-container">
                        <h3 className="category-title">{formatCategoryName(category)}</h3>
                        <div className="table-wrapper">
                            <table className="test-case-table">
                                <colgroup>
                                    <col style={{minWidth: '100px', width: '6%'}} />
                                    <col style={{minWidth: '150px', width: '10%'}} />
                                    <col style={{minWidth: '200px', width: '13%'}} />
                                    <col style={{minWidth: '150px', width: '10%'}} />
                                    <col style={{minWidth: '150px', width: '8%'}} />
                                    <col style={{minWidth: '250px', width: '18%'}} />
                                    <col style={{minWidth: '200px', width: '13%'}} />
                                    <col style={{minWidth: '80px',  width: '4%'}} />
                                    <col style={{minWidth: '80px',  width: '4%'}} />
                                    <col style={{minWidth: '100px', width: '4%'}} />
                                    <col style={{minWidth: '100px', width: '4%'}} />
                                    <col style={{minWidth: '100px', width: '6%'}} />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th>Test Case ID</th>
                                        <th>Test Case Title</th>
                                        <th>Description</th>
                                        <th>Precondition</th>
                                        <th>Test Data</th>
                                        <th>Test Steps</th>
                                        <th>Expected Results</th>
                                        <th>Priority</th>
                                        <th>Status</th>
                                        <th>Automation Status</th>
                                        <th>Test Suite</th>
                                        <th>Bug Reference</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {testCases[category].map((testCase, index) => (
                                        <tr key={`${category}-${index}`}>
                                            <td><textarea value={testCase.testCaseId} onChange={(e) => handleTestCaseChange(category, index, 'testCaseId', e.target.value)} className="editable-textarea" data-autoresize="true" rows={1} /></td>
                                            <td><textarea value={testCase.testCaseTitle} onChange={(e) => handleTestCaseChange(category, index, 'testCaseTitle', e.target.value)} className="editable-textarea" data-autoresize="true" rows={1} /></td>
                                            <td><textarea value={testCase.description} onChange={(e) => handleTestCaseChange(category, index, 'description', e.target.value)} className="editable-textarea" data-autoresize="true" rows={1} /></td>
                                            <td><textarea value={testCase.precondition} onChange={(e) => handleTestCaseChange(category, index, 'precondition', e.target.value)} className="editable-textarea" data-autoresize="true" rows={1} /></td>
                                            <td><textarea value={testCase.testData} onChange={(e) => handleTestCaseChange(category, index, 'testData', e.target.value)} className="editable-textarea" data-autoresize="true" rows={1} /></td>
                                            <td><textarea value={testCase.testSteps} onChange={(e) => handleTestCaseChange(category, index, 'testSteps', e.target.value)} className="editable-textarea" data-autoresize="true" rows={1} /></td>
                                            <td><textarea value={testCase.expectedResults} onChange={(e) => handleTestCaseChange(category, index, 'expectedResults', e.target.value)} className="editable-textarea" data-autoresize="true" rows={1} /></td>
                                            <td><textarea value={testCase.priority} onChange={(e) => handleTestCaseChange(category, index, 'priority', e.target.value)} className="editable-textarea" data-autoresize="true" rows={1} /></td>
                                            <td><textarea value={testCase.status} onChange={(e) => handleTestCaseChange(category, index, 'status', e.target.value)} className="editable-textarea" data-autoresize="true" rows={1} /></td>
                                            <td><textarea value={testCase.automationStatus} onChange={(e) => handleTestCaseChange(category, index, 'automationStatus', e.target.value)} className="editable-textarea" data-autoresize="true" rows={1} /></td>
                                            <td><textarea value={testCase.testSuite} onChange={(e) => handleTestCaseChange(category, index, 'testSuite', e.target.value)} className="editable-textarea" data-autoresize="true" rows={1} /></td>
                                            <td><textarea value={testCase.bugReference} onChange={(e) => handleTestCaseChange(category, index, 'bugReference', e.target.value)} className="editable-textarea" data-autoresize="true" rows={1} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                      </div>
                    )
                  ))}
                </div>
              )}
            </div>
          )}
          {activeTab === 'visual' && (
             <div>
                <div className="grid-cols-2">
                    <div className="input-group">
                        <h2>1. Provide Design Image</h2>
                        <div className="upload-section">
                            <p>Upload the original design or mock-up.</p>
                             <input type="file" id="before-image-upload" accept="image/*" onChange={(e) => handleVisualImageUpload(e, 'before')} ref={beforeImageInputRef} style={{ display: 'none' }} />
                            <label htmlFor="before-image-upload" className="btn btn-secondary">Upload Before Image</label>
                            {beforeImage && (
                                <div className="image-preview-container">
                                    <img src={`data:${beforeImage.mimeType};base64,${beforeImage.data}`} alt="Figma Screen Preview" className="image-preview"/>
                                    <button onClick={() => setBeforeImage(null)} className="remove-image-btn" aria-label="Remove before image">&times;</button>
                                </div>
                            )}
                        </div>
                    </div>
                     <div className="input-group">
                        <h2>2. Provide Implemented Image</h2>
                        <div className="upload-section">
                            <p>Upload a screenshot of the live application.</p>
                            <input type="file" id="after-image-upload" accept="image/*" onChange={(e) => handleVisualImageUpload(e, 'after')} ref={afterImageInputRef} style={{ display: 'none' }} />
                            <label htmlFor="after-image-upload" className="btn btn-secondary">Upload After Image</label>
                            {afterImage && (
                                <div className="image-preview-container">
                                    <img src={`data:${afterImage.mimeType};base64,${afterImage.data}`} alt="Actual Screen Preview" className="image-preview"/>
                                    <button onClick={() => setAfterImage(null)} className="remove-image-btn" aria-label="Remove after image">&times;</button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="input-group">
                    <h3>3. (Optional) Provide Specific Instructions</h3>
                    <textarea
                        value={visualAnalysisPrompt}
                        onChange={(e) => setVisualAnalysisPrompt(e.target.value)}
                        placeholder="e.g., 'Focus only on the header section.' or 'Ignore the text content, just check the layout.'"
                        aria-label="Optional visual analysis instructions"
                        style={{ minHeight: '80px' }}
                    />
                </div>
                <div>
                    <button onClick={performVisualAnalysis} className="btn btn-primary" disabled={isAnalyzing || !beforeImage || !afterImage}>
                        <span className="btn-icon">
                            {isAnalyzing ? <div className="spinner"></div> : '🔍'}
                        </span>
                        Analyze for Discrepancies
                    </button>
                    {analysisError && <p className="error-message">{analysisError}</p>}
                </div>
                {analysisResult && (
                    <div className="analysis-container">
                        <h2>4. Analysis Result</h2>
                        <div 
                            className="markdown-content" 
                            dangerouslySetInnerHTML={{ 
                                __html: analysisResult
                                    .replace(/^## (.*$)/gm, '<h3>$1</h3>')
                                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                    .replace(/\n/g, '<br />')
                            }}
                        ></div>
                    </div>
                )}
             </div>
          )}
          {activeTab === 'log-analyser' && (
            <div>
              <div className="input-group">
                <h2>1. Provide Log File</h2>
                <div className="upload-section">
                  <p>Upload a log file for analysis (Max 5MB).</p>
                  <input 
                    type="file" 
                    id="log-upload" 
                    accept=".log,.txt,text/plain" 
                    onChange={handleLogUpload} 
                    ref={logFileInputRef} 
                    style={{ display: 'none' }} 
                  />
                  <label htmlFor="log-upload" className="btn btn-secondary">Upload Log File</label>
                  {logFile && (
                    <div style={{ marginTop: '1rem', padding: '0.875rem', backgroundColor: '#f1f5f9', borderRadius: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#334155' }}>📄 {logFile.name}</span>
                      <button onClick={() => setLogFile(null)} className="remove-btn" style={{ fontSize: '1.25rem' }} aria-label="Remove log file">&times;</button>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <button 
                  onClick={performLogAnalysis} 
                  className="btn btn-primary" 
                  disabled={isAnalyzingLog || !logFile}
                >
                  <span className="btn-icon">
                    {isAnalyzingLog ? <div className="spinner"></div> : '📋'}
                  </span>
                  Analyze Log
                </button>
                {logAnalysisError && <p className="error-message">{logAnalysisError}</p>}
              </div>
              {logAnalysisReport && (
                <div className="analysis-container">
                  <h2>2. Log Analysis Summary</h2>
                  <div 
                    className="markdown-content" 
                    dangerouslySetInnerHTML={{ 
                      __html: logAnalysisReport
                        .replace(/^# (.*$)/gm, '<h2>$1</h2>')
                        .replace(/^## (.*$)/gm, '<h3>$1</h3>')
                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                        .replace(/^\s*[\-\*]\s+(.*$)/gm, '• $1')
                        .replace(/\n/g, '<br />')
                    }}
                  ></div>
                </div>
              )}
            </div>
          )}
          {activeTab === 'accessibility' && (
              <div>
                <div className="input-group">
                    <h2>1. Provide UI Image</h2>
                    <div className="upload-section">
                        <p>Upload a single screenshot of the UI you want to analyze.</p>
                        <input type="file" id="accessibility-image-upload" accept="image/*" onChange={handleAccessibilityImageUpload} ref={accessibilityImageInputRef} style={{ display: 'none' }} />
                        <label htmlFor="accessibility-image-upload" className="btn btn-secondary">Upload UI Image</label>
                        {accessibilityImage && (
                            <div className="image-preview-container">
                                <img src={`data:${accessibilityImage.mimeType};base64,${accessibilityImage.data}`} alt="UI for accessibility check" className="image-preview"/>
                                <button onClick={() => setAccessibilityImage(null)} className="remove-image-btn" aria-label="Remove UI image">&times;</button>
                            </div>
                        )}
                    </div>
                </div>
                <div>
                    <button onClick={performAccessibilityCheck} className="btn btn-primary" disabled={isCheckingAccessibility || !accessibilityImage}>
                        <span className="btn-icon">
                            {isCheckingAccessibility ? <div className="spinner"></div> : '♿'}
                        </span>
                        Run Accessibility Analysis
                    </button>
                     {accessibilityError && <p className="error-message">{accessibilityError}</p>}
                </div>
                 {accessibilityReport && (
                    <div className="analysis-container">
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                            <h2>2. Accessibility Report</h2>
                            <button onClick={downloadAccessibilityReportAsPdf} className="btn btn-secondary">
                                Download as PDF
                            </button>
                        </div>
                        <div className="markdown-content" dangerouslySetInnerHTML={{ __html: accessibilityReport.replace(/---/g, '<hr/>').replace(/\|/g, '&vert;').replace(/\n/g, '<br />') }}></div>
                    </div>
                )}
              </div>
          )}
        </div>
      </main>
    </>
  );
};

const container = document.getElementById('root');
if (container) {
  // @ts-ignore
  if (!window.__reactRoot) {
    // @ts-ignore
    window.__reactRoot = ReactDOM.createRoot(container);
  }
  // @ts-ignore
  window.__reactRoot.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}