import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import ResponseBubble from './components/ResponseBubble';
import ParticleBg from './components/ParticleBg';
import { fetchRoutes, sendChatMessage } from './services/api';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { speakText, stopSpeech, subscribeSpeechState } from './services/tts';

// Splits text into chunks appropriate for larger ATM-sized cards
function splitIntoAtmCards(text) {
  if (!text) return [];
  
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    
    const hasMathBlock = trimmed.includes('$$');
    
    if (trimmed.length > 500 && !hasMathBlock) {
      const sentences = trimmed.match(/[^.!?]+[.!?]+(\s|$)/g) || [trimmed];
      let currentChunk = '';
      
      for (const sentence of sentences) {
        if ((currentChunk + sentence).length > 500) {
          if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
          }
          currentChunk = sentence;
        } else {
          currentChunk += sentence;
        }
      }
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
    } else {
      chunks.push(trimmed);
    }
  }
  
  const finalChunks = [];
  for (const chunk of chunks) {
    if (chunk.length > 600 && !chunk.includes('$$') && !chunk.includes('$')) {
      let remaining = chunk;
      while (remaining.length > 500) {
        let sliceIndex = remaining.lastIndexOf(' ', 500);
        if (sliceIndex <= 0) sliceIndex = 500;
        finalChunks.push(remaining.substring(0, sliceIndex).trim());
        remaining = remaining.substring(sliceIndex).trim();
      }
      if (remaining) finalChunks.push(remaining);
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks.length > 0 ? finalChunks : [text];
}





function retrieveRelevantContext(prompt, books) {
  if (!books || books.length === 0) return '';

  let contextParts = [];

  for (const book of books) {
    // 1. Check if the user is asking to summarize the whole book
    const summarizeWholeBook = new RegExp(`summarize\\s+(?:the\\s+)?(?:book\\s+)?["']?${book.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}["']?`, 'i').test(prompt) ||
                               (books.length === 1 && /summarize\s+(?:the\\s+)?book/i.test(prompt));
    
    if (summarizeWholeBook) {
      let bookSummary = `[SYSTEM CONTEXT: The user wants a summary of the book "${book.name}". Here is a page-by-page index preview of the book's content:\n`;
      book.pages.forEach((pageText, idx) => {
        const preview = pageText.slice(0, 300).trim().replace(/\s+/g, ' ');
        bookSummary += `--- PAGE ${idx + 1} ---\n${preview}...\n`;
      });
      bookSummary += `\nPlease summarize the book based on this page-by-page index. Include the book name, total page count (${book.pages.length} pages), and describe the primary concepts discussed page by page.]`;
      contextParts.push(bookSummary);
      continue;
    }

    // 2. Check if the user is asking for a specific page number
    const pageMatch = prompt.match(/(?:page|p\.?)\s*(\d+)/i);
    if (pageMatch) {
      const targetPageNum = parseInt(pageMatch[1], 10);
      if (targetPageNum > 0 && targetPageNum <= book.pages.length) {
        const pageText = book.pages[targetPageNum - 1];
        contextParts.push(`[SYSTEM CONTEXT: The user is asking about PAGE ${targetPageNum} of the book "${book.name}". Here is the content of Page ${targetPageNum}:\n---\n${pageText}\n---\nPlease summarize or extract from this page as requested. Cite Page ${targetPageNum} in your response.]`);
        continue;
      }
    }

    // 3. Fallback: Keyword search for semantic relevance
    const stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'from', 'up', 'down', 'in', 'out', 'of', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'what', 'who', 'whom', 'this', 'that', 'these', 'those', 'which']);
    const keywords = prompt
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopwords.has(w));

    if (keywords.length > 0) {
      const scoredPages = book.pages.map((pageText, index) => {
        const textLower = pageText.toLowerCase();
        let score = 0;
        keywords.forEach(word => {
          const regex = new RegExp(`\\b${word}\\b`, 'g');
          const matches = textLower.match(regex);
          if (matches) {
            score += matches.length;
          }
        });
        return { pageNum: index + 1, content: pageText, score };
      });

      const matchedPages = scoredPages
        .filter(p => p.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      if (matchedPages.length > 0) {
        let keywordContext = `[SYSTEM CONTEXT: The user is asking a question about the book "${book.name}". Here are the most relevant pages of the book based on keyword search:\n`;
        matchedPages.forEach(p => {
          keywordContext += `--- PAGE ${p.pageNum} (Relevance Score: ${p.score}) ---\n${p.content}\n`;
        });
        keywordContext += `\nPlease answer the user's question using the matching pages above. Cite the source page numbers (e.g. Page X) whenever you refer to their content.]`;
        contextParts.push(keywordContext);
      }
    }
  }

  return contextParts.join('\n\n');
}

export default function App() {
  const [cognitiveMode, setCognitiveMode] = useState(() => {
    return localStorage.getItem('cognitive_mode') === 'true';
  });

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoPlaySpeech, setAutoPlaySpeech] = useState(false);

  useEffect(() => {
    localStorage.setItem('cognitive_mode', cognitiveMode);
    if (cognitiveMode) {
      document.body.classList.add('cognitive-theme');
    } else {
      document.body.classList.remove('cognitive-theme');
    }
  }, [cognitiveMode]);

  useEffect(() => {
    const unsubscribe = subscribeSpeechState((speaking) => {
      setIsSpeaking(speaking);
    });
    return () => unsubscribe();
  }, []);

  const handleToggleCognitiveMode = () => {
    setCognitiveMode(prev => !prev);
  };

  const handleUpdateMessageRevealedCount = (index, newCount) => {
    setMessages(prev => prev.map((msg, idx) => {
      if (idx === index) {
        return { ...msg, revealedChunksCount: newCount };
      }
      return msg;
    }));
    setSessions(prev => prev.map(s => {
      if (s.session_id === currentSessionId) {
        const updatedMessages = s.messages.map((msg, idx) => {
          if (idx === index) {
            return { ...msg, revealedChunksCount: newCount };
          }
          return msg;
        });
        return { ...s, messages: updatedMessages };
      }
      return s;
    }));
  };

  const [sessions, setSessions] = useState(() => {
    const stored = localStorage.getItem('neural_route_sessions');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (e) {
        console.error('Failed to parse sessions from localStorage:', e);
      }
    }
    const defaultId = String(Date.now());
    return [{
      session_id: defaultId,
      title: 'New Conversation',
      timestamp: Date.now(),
      isResearchModeActive: false,
      messages: []
    }];
  });

  const [currentSessionId, setCurrentSessionId] = useState(() => {
    return sessions[0]?.session_id || '';
  });

  const [messages, setMessages] = useState(() => {
    const active = sessions.find(s => s.session_id === (sessions[0]?.session_id || ''));
    return active ? active.messages : [];
  });

  const [isResearchModeActive, setIsResearchModeActive] = useState(() => {
    const active = sessions.find(s => s.session_id === (sessions[0]?.session_id || ''));
    return active ? !!active.isResearchModeActive : false;
  });

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const [routes, setRoutes] = useState({ pipeline: [], providers: { gemini: false, openrouter: false } });
  const [lastTelemetry, setLastTelemetry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);



  const activeSession = sessions.find(s => s.session_id === currentSessionId);
  const currentBooks = (activeSession && activeSession.books) || [];

  const saveBookToSession = (name, pages) => {
    setSessions(prev => prev.map(s => {
      if (s.session_id === currentSessionId) {
        const currentBooksList = s.books || [];
        const filtered = currentBooksList.filter(b => b.name !== name);
        const newBook = { name, pages };
        const updatedBooks = [...filtered, newBook];
        
        const updatedMessages = [...s.messages, {
          role: 'assistant',
          content: `### 📚 DATABASE SYNC SUCCESSFUL\n\nSuccessfully parsed and indexed **${name}** (${pages.length} pages).\n\nYou can now ask questions about this document or ask me to summarize specific page numbers.`
        }];

        if (s.session_id === currentSessionId) {
          setMessages(updatedMessages);
        }

        return { ...s, books: updatedBooks, messages: updatedMessages };
      }
      return s;
    }));
  };

  const handleDeleteBook = (bookName) => {
    setSessions(prev => prev.map(s => {
      if (s.session_id === currentSessionId) {
        const updatedBooks = (s.books || []).filter(b => b.name !== bookName);
        return { ...s, books: updatedBooks };
      }
      return s;
    }));
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      if (file.type === 'application/pdf') {
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const arrayBuffer = event.target.result;
            const pdfjsLib = window['pdfjs-dist/build/pdf'];
            if (!pdfjsLib) {
              throw new Error('PDF.js library is not loaded. Please verify your index.html configurations.');
            }
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            const pages = [];
            
            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              const textContent = await page.getTextContent();
              const pageText = textContent.items.map(item => item.str).join(' ');
              pages.push(pageText.trim() || `[Page ${i} is empty or contains non-extractable text]`);
            }
            
            if (pages.length === 0) {
              throw new Error('Could not extract any text pages from PDF.');
            }
            
            saveBookToSession(file.name, pages);
          } catch (err) {
            console.error('PDF extraction failed:', err);
            setError(`PDF_IMPORT_FAILED: ${err.message}`);
          } finally {
            setLoading(false);
          }
        };
        reader.onerror = () => {
          setError('File reading error occurred.');
          setLoading(false);
        };
        reader.readAsArrayBuffer(file);
      } else {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const text = event.target.result;
            if (!text || !text.trim()) {
              throw new Error('File is empty.');
            }
            let pages = [];
            if (text.includes('\f')) {
              pages = text.split('\f').map(p => p.trim()).filter(Boolean);
            } else {
              const chunkSize = 2000;
              let current = 0;
              while (current < text.length) {
                pages.push(text.substring(current, current + chunkSize).trim());
                current += chunkSize;
              }
            }
            saveBookToSession(file.name, pages);
          } catch (err) {
            setError(`FILE_IMPORT_FAILED: ${err.message}`);
          } finally {
            setLoading(false);
          }
        };
        reader.onerror = () => {
          setError('File reading error occurred.');
          setLoading(false);
        };
        reader.readAsText(file);
      }
    } catch (err) {
      setError(`IMPORT_FAILED: ${err.message}`);
      setLoading(false);
    }

    e.target.value = '';
  };

  // ATM Card state definitions
  const [activeAtmMessage, setActiveAtmMessage] = useState(null);
  const [atmCardIndex, setAtmCardIndex] = useState(0);
  const [atmCards, setAtmCards] = useState([]);

  // Research Mode state definitions
  const [showResearchModal, setShowResearchModal] = useState(false);
  const [researchTopic, setResearchTopic] = useState('');
  const [activeResearchMessage, setActiveResearchMessage] = useState(null);

  // Persist sessions to localStorage
  useEffect(() => {
    localStorage.setItem('neural_route_sessions', JSON.stringify(sessions));
  }, [sessions]);

  // Silence speech on session switch or textbook overlay change
  useEffect(() => {
    stopSpeech();
  }, [currentSessionId, activeResearchMessage]);

  const handleShowAtmAnswer = (message) => {
    const cards = splitIntoAtmCards(message.content);
    setAtmCards(cards);
    setAtmCardIndex(0);
    setActiveAtmMessage(message);
    
    if (cognitiveMode && cards.length > 0) {
      setAutoPlaySpeech(true);
      stopSpeech();
      let speakTextStr = cards[0];
      if (cards.length > 1) {
        speakTextStr += " ... Click next.";
      }
      speakText(speakTextStr, 0.9);
    } else {
      setAutoPlaySpeech(false);
    }
  };

  const handlePrintReport = () => {
    const sessionTitle = activeSession?.title || 'Janaki Research Report';
    const cleanTitle = sessionTitle.replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, "").trim();
    
    const printArea = document.querySelector('.textbook-print-area');
    if (!printArea) return;
    const printContent = printArea.innerHTML;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document || iframe.contentDocument;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${cleanTitle}</title>
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.css" crossOrigin="anonymous">
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Roboto:wght@300;400;500;700&display=swap');
            
            @page {
              size: A4;
              margin: 20mm;
            }
            
            body {
              font-family: 'Georgia', 'Times New Roman', serif;
              font-size: 11pt;
              line-height: 1.75;
              color: #2b2b2b;
              background: #ffffff;
              margin: 0;
              padding: 0;
            }

            .textbook-content {
              width: 100%;
            }

            p {
              margin: 0 0 1.5rem 0;
              text-align: justify;
            }

            h1 {
              font-family: 'Outfit', 'Roboto', sans-serif;
              font-size: 22pt;
              color: #111;
              border-bottom: 2px solid #333;
              padding-bottom: 0.5rem;
              margin-top: 0;
              margin-bottom: 1.5rem;
            }

            h2 {
              font-family: 'Outfit', 'Roboto', sans-serif;
              font-size: 16pt;
              color: #222;
              margin-top: 2rem;
              margin-bottom: 1rem;
            }

            h3 {
              font-family: 'Outfit', 'Roboto', sans-serif;
              font-size: 12.5pt;
              color: #333;
              margin-top: 1.5rem;
              margin-bottom: 0.8rem;
            }

            pre {
              background: #f8f8f8;
              border: 1px solid #e0e0e0;
              padding: 1rem;
              border-radius: 4px;
              overflow-x: auto;
              margin: 1.5rem 0;
              white-space: pre-wrap;
              word-break: break-all;
              page-break-inside: avoid;
            }

            code {
              font-family: "Courier New", Courier, monospace;
              font-size: 9pt;
              color: #333;
            }

            blockquote {
              border-left: 4px solid #888;
              margin: 1.5rem 0;
              padding-left: 1.2rem;
              color: #555;
              font-style: italic;
              page-break-inside: avoid;
            }

            .latex-block-textbook {
              margin: 1.5rem 0;
              padding: 1rem;
              background: #fcfcfc;
              border: 1px solid #eaeaea;
              border-radius: 4px;
              font-size: 11pt;
              display: flex;
              justify-content: center;
              page-break-inside: avoid;
            }

            h1, h2, h3 {
              page-break-after: avoid;
              page-break-inside: avoid;
            }

            pre, blockquote, tr, img, .latex-block-textbook {
              page-break-inside: avoid;
            }
          </style>
        </head>
        <body>
          <div class="textbook-content">
            ${printContent}
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.focus();
                window.print();
                setTimeout(function() {
                  window.parent.document.body.removeChild(window.frameElement);
                }, 1000);
              }, 500);
            };
          </script>
        </body>
      </html>
    `);
    doc.close();
  };


  const handleNewChat = () => {
    const newId = String(Date.now());
    const newSession = {
      session_id: newId,
      title: 'New Conversation',
      timestamp: Date.now(),
      isResearchModeActive: false,
      messages: []
    };
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newId);
    setMessages(newSession.messages);
    setIsResearchModeActive(false);
  };

  const handleSwitchSession = (id) => {
    const target = sessions.find(s => s.session_id === id);
    if (target) {
      setCurrentSessionId(id);
      setMessages(target.messages);
      setIsResearchModeActive(!!target.isResearchModeActive);
    }
  };

  const handleDeleteSession = (id, e) => {
    e.stopPropagation();
    const confirmDelete = window.confirm('Are you sure you want to delete this chat session?');
    if (!confirmDelete) return;

    const remainingSessions = sessions.filter(s => s.session_id !== id);
    setSessions(remainingSessions);

    if (currentSessionId === id) {
      if (remainingSessions.length > 0) {
        const nextSession = remainingSessions[0];
        setCurrentSessionId(nextSession.session_id);
        setMessages(nextSession.messages);
        setIsResearchModeActive(!!nextSession.isResearchModeActive);
      } else {
        const defaultId = String(Date.now());
        const blankSession = {
          session_id: defaultId,
          title: 'New Conversation',
          timestamp: Date.now(),
          isResearchModeActive: false,
          messages: []
        };
        setSessions([blankSession]);
        setCurrentSessionId(defaultId);
        setMessages(blankSession.messages);
        setIsResearchModeActive(false);
      }
    }
  };

  const handleResearchSubmit = async (e) => {
    e.preventDefault();
    if (!researchTopic.trim()) return;

    const topic = researchTopic.trim();
    setShowResearchModal(false);
    setResearchTopic('');
    setIsResearchModeActive(true);

    const userMessage = { role: 'user', content: `Research Topic: ${topic}` };
    const newMessages = [...messages, userMessage];
    
    setMessages(newMessages);
    setLoading(true);
    setError(null);

    // Update session title and active messages
    setSessions(prev => prev.map(s => {
      if (s.session_id === currentSessionId) {
        return { 
          ...s, 
          title: `🔬 ${topic}`, 
          messages: newMessages,
          isResearchModeActive: true
        };
      }
      return s;
    }));

    const apiMessages = newMessages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    if (currentBooks.length > 0) {
      const context = retrieveRelevantContext(topic, currentBooks);
      if (context) {
        const lastMsg = apiMessages[apiMessages.length - 1];
        lastMsg.content = `${context}\n\nUser Research Topic: ${lastMsg.content}`;
      }
    }

    try {
      const result = await sendChatMessage(apiMessages, true, cognitiveMode);
      
      const assistantMessage = {
        role: 'assistant',
        content: result.text,
        reasoning: result.reasoning,
        telemetry: result.telemetry,
        isResearch: true,
        revealedChunksCount: cognitiveMode ? 1 : undefined
      };

      const finalMessages = [...newMessages, assistantMessage];
      setMessages(finalMessages);
      setSessions(prev => prev.map(s => {
        if (s.session_id === currentSessionId) {
          return { ...s, messages: finalMessages };
        }
        return s;
      }));
      setLastTelemetry(result.telemetry);
    } catch (err) {
      setError(`TRANSMISSION_FAILED: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoutesConfig();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const loadRoutesConfig = async () => {
    try {
      setError(null);
      const data = await fetchRoutes();
      setRoutes(data);
    } catch (err) {
      setError(`CRITICAL_ERROR: Failed to connect to routing backend. ${err.message}`);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleTransmit = async (e) => {
    e.preventDefault();
    if (!inputValue.trim() || loading) return;

    const userContent = inputValue;
    const userMessage = { role: 'user', content: userContent };
    const newMessages = [...messages, userMessage];
    
    setMessages(newMessages);
    setInputValue('');
    setLoading(true);
    setError(null);

    // Update in sessions list
    setSessions(prev => prev.map(s => {
      if (s.session_id === currentSessionId) {
        const title = s.title === 'New Conversation' 
          ? (userContent.slice(0, 30) + (userContent.length > 30 ? '...' : '')) 
          : s.title;
        return { ...s, title, messages: newMessages };
      }
      return s;
    }));

    // Prepare message history to send to server
    // Strip out telemetry for API request compatibility
    const apiMessages = newMessages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    if (currentBooks.length > 0) {
      const context = retrieveRelevantContext(userContent, currentBooks);
      if (context) {
        const lastMsg = apiMessages[apiMessages.length - 1];
        lastMsg.content = `${context}\n\nUser Question: ${lastMsg.content}`;
      }
    }

    try {
      const result = await sendChatMessage(apiMessages, isResearchModeActive, cognitiveMode);
      
      const assistantMessage = {
        role: 'assistant',
        content: result.text,
        reasoning: result.reasoning,
        telemetry: result.telemetry,
        isResearch: isResearchModeActive,
        revealedChunksCount: cognitiveMode ? 1 : undefined
      };

      const finalMessages = [...newMessages, assistantMessage];
      setMessages(finalMessages);
      setSessions(prev => prev.map(s => {
        if (s.session_id === currentSessionId) {
          return { ...s, messages: finalMessages };
        }
        return s;
      }));
      setLastTelemetry(result.telemetry);
    } catch (err) {
      setError(`TRANSMISSION_FAILED: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={cognitiveMode ? 'cognitive-theme' : ''} style={{
      position: 'relative',
      height: '100vh',
      width: '100vw',
      display: 'flex',
      flexDirection: 'column',
      padding: '1rem',
      boxSizing: 'border-box',
      overflow: 'hidden'
    }}>
      {/* Visual background systems */}
      <div className="hud-background">
        <div className="hud-grid" />
        <div className="hud-scanlines" />
      </div>
      <ParticleBg />

      {/* Header */}
      <Header 
        providers={routes.providers} 
        cognitiveMode={cognitiveMode}
        onCognitiveToggle={handleToggleCognitiveMode}
        onResearchClick={() => {
          if (isResearchModeActive) {
            setIsResearchModeActive(false);
            const closedMessages = [...messages, {
              role: 'assistant',
              content: `### 🛰️ RESEARCH SESSION CLOSED\nReturning to standard Janaki interface.`,
              revealedChunksCount: cognitiveMode ? 1 : undefined
            }];
            setMessages(closedMessages);
            setSessions(prev => prev.map(s => {
              if (s.session_id === currentSessionId) {
                return { 
                  ...s, 
                  isResearchModeActive: false, 
                  messages: closedMessages 
                };
              }
              return s;
            }));
          } else {
            setShowResearchModal(true);
          }
        }} 
        isResearchActive={isResearchModeActive}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />

      {/* Main Workspace */}
      <div style={{
        flex: 1,
        display: 'flex',
        gap: '1rem',
        minHeight: 0, // critical for nested scrolling in flex layouts
        position: 'relative'
      }}>
        {/* Collapsible Sidebar */}
        <aside 
          className="sidebar-panel hud-corners"
          style={{
            width: sidebarOpen ? '250px' : '0px',
            opacity: sidebarOpen ? 1 : 0,
            pointerEvents: sidebarOpen ? 'auto' : 'none',
            borderRightWidth: sidebarOpen ? '1px' : '0px',
            marginRight: sidebarOpen ? '0px' : '-1rem'
          }}
        >
          <div className="sidebar-content">
            <button
              onClick={handleNewChat}
              className="neon-button hologram-effect"
              style={{
                width: '100%',
                padding: '0.8rem',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                marginBottom: '0.6rem'
              }}
            >
              <span>+ NEW CONVERSATION</span>
            </button>



            {/* System File Import Button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="neon-button hologram-effect"
              style={{
                width: '100%',
                padding: '0.6rem',
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                marginBottom: '1rem',
                borderColor: 'rgba(0, 242, 254, 0.4)',
                background: 'rgba(0, 242, 254, 0.04)'
              }}
            >
              <span>💻 IMPORT SYSTEM FILE</span>
            </button>

            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              style={{ display: 'none' }} 
            />

            {/* Synced Books Assets HUD */}
            {currentBooks.length > 0 && (
              <div style={{
                marginBottom: '1.2rem',
                borderTop: '1px solid rgba(0, 242, 254, 0.15)',
                paddingTop: '0.8rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem'
              }}>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.65rem',
                  color: 'var(--neon-cyan)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  marginBottom: '0.2rem'
                }}>
                  📚 SYNCED DOCUMENTS ({currentBooks.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {currentBooks.map((book, idx) => (
                    <div
                      key={idx}
                      className="glass-panel"
                      style={{
                        padding: '0.5rem',
                        fontSize: '0.75rem',
                        fontFamily: 'var(--font-mono)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: 'rgba(0, 242, 254, 0.02)',
                        border: '1px solid rgba(0, 242, 254, 0.1)',
                        borderRadius: '4px'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', gap: '0.1rem', flex: 1 }}>
                        <span 
                          style={{ 
                            color: '#e2f1f8', 
                            overflow: 'hidden', 
                            textOverflow: 'ellipsis', 
                            whiteSpace: 'nowrap',
                            maxWidth: '150px' 
                          }} 
                          title={book.name}
                        >
                          {book.name}
                        </span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.6rem' }}>
                          {book.pages.length} PAGES
                        </span>
                      </div>
                      <button
                        onClick={() => handleDeleteBook(book.name)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--neon-red)',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          padding: '0.2rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          outline: 'none'
                        }}
                        title="Remove Document"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="session-list">
              {sessions.map((s) => (
                <div
                  key={s.session_id}
                  className={`session-item ${s.session_id === currentSessionId ? 'active' : ''}`}
                  onClick={() => handleSwitchSession(s.session_id)}
                >
                  <div className="session-title-container">
                    <span className="session-title">{s.title || 'New Conversation'}</span>
                    <span className="session-meta">
                      <span>{new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {s.isResearchModeActive && <span style={{ color: 'var(--neon-cyan)', fontSize: '0.55rem' }}>🔬 RESEARCH</span>}
                    </span>
                  </div>
                  <button
                    className="session-delete-btn"
                    onClick={(e) => handleDeleteSession(s.session_id, e)}
                    title="Delete Conversation"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Left Area: Chat Console */}
        <main className="glass-panel hud-corners" style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          background: 'rgba(5, 15, 30, 0.4)'
        }}>

          {/* Error Banner */}
          {error && (
            <div style={{
              background: 'rgba(255, 51, 102, 0.15)',
              borderBottom: '1px solid var(--neon-red)',
              color: 'var(--neon-red)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8rem',
              padding: '0.6rem 1.2rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              zIndex: 10
            }}>
              <span>⚠️ ERROR: {error}</span>
              <button 
                onClick={loadRoutesConfig}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem'
                }}
              >
                RE-INITIALIZE
              </button>
            </div>
          )}

          {/* Chat Logs Window */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.2rem',
            scrollBehavior: 'smooth'
          }}>
            {messages.map((msg, index) => (
              <ResponseBubble 
                key={index} 
                message={msg} 
                index={index}
                fullHistory={messages}
                onShowAtmAnswer={handleShowAtmAnswer}
                onOpenResearchModal={setActiveResearchMessage}
                cognitiveMode={cognitiveMode}
                onUpdateMessageRevealedCount={handleUpdateMessageRevealedCount}
                autoPlaySpeech={autoPlaySpeech}
                onSetAutoPlaySpeech={setAutoPlaySpeech}
              />
            ))}

            {/* Typing Loader HUD */}
            {loading && (
              <div style={{
                alignSelf: 'flex-start',
                padding: '0.8rem 1.2rem',
                background: 'rgba(7, 22, 44, 0.3)',
                border: '1px solid rgba(0, 242, 254, 0.1)',
                borderRadius: '12px 12px 12px 2px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.8rem',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                color: 'var(--neon-cyan)'
              }} className="hologram-effect">
                <div className="hud-loader">
                  <div /><div /><div />
                </div>
                <span>EVALUATING PIPELINE SELECTION & FETCHING GENERATION...</span>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* User Input Console */}
          <form onSubmit={handleTransmit} style={{
            padding: '1rem',
            borderTop: '1px solid var(--glass-border)',
            background: 'rgba(3, 10, 22, 0.6)',
            display: 'flex',
            gap: '0.8rem',
            alignItems: 'center'
          }}>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={loading ? "EVALUATING FAILOVER PIPELINE..." : "INPUT RESEARCH QUERY OR EQUATION HERE..."}
              disabled={loading}
              style={{
                flex: 1,
                background: 'rgba(7, 22, 44, 0.4)',
                border: '1px solid var(--glass-border)',
                borderRadius: '4px',
                padding: '0.8rem 1rem',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.9rem',
                outline: 'none',
                transition: 'all 0.2s ease'
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--neon-cyan)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--glass-border)'}
            />
            
            <button 
              type="submit" 
              disabled={loading || !inputValue.trim()}
              className="neon-button"
              style={{
                padding: '0.8rem 1.8rem',
                opacity: (loading || !inputValue.trim()) ? 0.5 : 1,
                cursor: (loading || !inputValue.trim()) ? 'not-allowed' : 'pointer'
              }}
            >
              TRANSMIT
            </button>
          </form>
        </main>
      </div>

      {/* ATM Card Modal Overlay */}
      {activeAtmMessage && (
        <div className="atm-overlay">
          <div className="atm-modal-container">
            <div className="atm-card hologram-effect">
              
              <div className="atm-card-header">
                <span>PAGE {String(atmCardIndex + 1).padStart(2, '0')} / {String(atmCards.length).padStart(2, '0')}</span>
                <button 
                  className="atm-card-close"
                  onClick={() => {
                    stopSpeech();
                    setAutoPlaySpeech(false);
                    setActiveAtmMessage(null);
                  }}
                >
                  [ X ]
                </button>
              </div>

              <div className="atm-card-body">
                <div className="markdown-render" style={{ width: '100%' }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      p({ children }) {
                        return <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: '1.4' }}>{children}</p>;
                      },
                      code({ node, inline, className, children, ...props }) {
                        return (
                          <code style={{
                            background: 'rgba(0, 242, 254, 0.08)',
                            padding: '0.1rem 0.3rem',
                            borderRadius: '3px',
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--neon-cyan)',
                            fontSize: '0.8rem'
                          }} {...props}>
                            {children}
                          </code>
                        );
                      },
                      div({ node, className, children, ...props }) {
                        if (className && className.includes('math-display')) {
                          return <div className="latex-block" style={{ margin: '0.4rem 0', padding: '0.5rem', fontSize: '0.95rem' }} {...props}>{children}</div>;
                        }
                        return <div className={className} {...props}>{children}</div>;
                      },
                      span({ node, className, children, ...props }) {
                        if (className && className.includes('math-inline')) {
                          return <span className="latex-inline" {...props}>{children}</span>;
                        }
                        return <span className={className} {...props}>{children}</span>;
                      }
                    }}
                  >
                    {atmCards[atmCardIndex]}
                  </ReactMarkdown>
                </div>
              </div>
            </div>

            {/* Navigation Controls */}
            <div className="atm-controls">
              <button 
                className="atm-nav-button"
                disabled={atmCardIndex === 0}
                onClick={() => {
                  const prevIndex = Math.max(0, atmCardIndex - 1);
                  setAtmCardIndex(prevIndex);
                  if (cognitiveMode) {
                    if (autoPlaySpeech) {
                      stopSpeech();
                      let speakTextStr = atmCards[prevIndex];
                      if (prevIndex > 0) {
                        speakTextStr += " ... Click previous or next.";
                      } else {
                        speakTextStr += " ... Click next.";
                      }
                      speakText(speakTextStr, 0.9);
                    } else {
                      stopSpeech();
                    }
                  }
                }}
              >
                PREV
              </button>
              <button 
                className="atm-nav-button"
                disabled={atmCardIndex === atmCards.length - 1}
                onClick={() => {
                  const nextIndex = Math.min(atmCards.length - 1, atmCardIndex + 1);
                  setAtmCardIndex(nextIndex);
                  if (cognitiveMode) {
                    if (autoPlaySpeech) {
                      stopSpeech();
                      let speakTextStr = atmCards[nextIndex];
                      if (nextIndex < atmCards.length - 1) {
                        speakTextStr += " ... Click previous or next.";
                      } else {
                        speakTextStr += " ... Click previous.";
                      }
                      speakText(speakTextStr, 0.9);
                    } else {
                      stopSpeech();
                    }
                  }
                }}
              >
                NEXT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Research Topic Modal Overlay */}
      {showResearchModal && (
        <div className="atm-overlay" style={{ animation: 'fadeIn 0.2s ease' }}>
          <div className="glass-panel hud-corners hologram-effect" style={{
            width: '450px',
            background: 'rgba(5, 18, 38, 0.9)',
            border: '1px solid var(--neon-cyan)',
            boxShadow: '0 0 30px rgba(0, 242, 254, 0.25)',
            padding: '2rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            position: 'relative'
          }}>
            <button
              onClick={() => {
                setShowResearchModal(false);
                setResearchTopic('');
              }}
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                background: 'transparent',
                border: 'none',
                color: 'var(--neon-red)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              [ X ]
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <h2 className="glow-text-cyan" style={{
                fontFamily: 'var(--font-header)',
                fontSize: '1.2rem',
                letterSpacing: '2px',
                textTransform: 'uppercase',
                margin: 0
              }}>
                🔬 INITIALIZE RESEARCH MODE
              </h2>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.65rem',
                color: 'var(--text-secondary)'
              }}>
                ESTABLISHING NEURAL DEEP COUPLING WITH DIGITAL TWIN
              </span>
            </div>

            <form onSubmit={handleResearchSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  color: 'var(--neon-cyan)',
                  textTransform: 'uppercase'
                }}>
                  ENTER RESEARCH TOPIC / SCHOLARLY FIELD:
                </label>
                <input
                  type="text"
                  value={researchTopic}
                  onChange={(e) => setResearchTopic(e.target.value)}
                  placeholder="e.g. Quantum Computing, CRISPR/Cas9..."
                  autoFocus
                  style={{
                    background: 'rgba(7, 22, 44, 0.6)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '4px',
                    padding: '0.8rem 1rem',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.9rem',
                    outline: 'none',
                    transition: 'all 0.2s ease',
                    width: '100%'
                  }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--neon-cyan)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--glass-border)'}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button
                  type="submit"
                  disabled={!researchTopic.trim()}
                  className="neon-button"
                  style={{
                    flex: 1,
                    padding: '0.8rem',
                    fontSize: '0.8rem',
                    opacity: !researchTopic.trim() ? 0.5 : 1,
                    cursor: !researchTopic.trim() ? 'not-allowed' : 'pointer'
                  }}
                >
                  INITIALIZE COGNITIVE FLOW
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowResearchModal(false);
                    setResearchTopic('');
                  }}
                  className="neon-button"
                  style={{
                    padding: '0.8rem 1.5rem',
                    fontSize: '0.8rem',
                    borderColor: 'var(--text-muted)',
                    color: 'var(--text-secondary)',
                    boxShadow: 'none'
                  }}
                >
                  CANCEL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



      {/* Textbook Research Modal Overlay */}
      {activeResearchMessage && (
        <div className="atm-overlay" style={{ background: 'rgba(3, 10, 22, 0.8)' }}>
          <div className="glass-panel hud-corners hologram-effect" style={{
            width: '90%',
            maxWidth: '850px',
            height: '85vh',
            background: 'rgba(5, 18, 38, 0.95)',
            border: '1px solid var(--neon-cyan)',
            boxShadow: '0 0 30px rgba(0, 242, 254, 0.3)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* Modal Header/Toolbar */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1rem 2rem',
              borderBottom: '1px solid var(--glass-border)',
              background: 'rgba(7, 22, 44, 0.6)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8rem'
            }} className="no-print">
              <span style={{ color: 'var(--neon-cyan)', letterSpacing: '1px' }}>🔬 JANAKI RESEARCH REPORT</span>
              <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                <button
                  onClick={() => speakText(activeResearchMessage.content, 0.9)}
                  className="neon-button"
                  style={{
                    padding: '0.4rem 1rem',
                    fontSize: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}
                >
                  🔊 SPEAK
                </button>
                <button
                  onClick={stopSpeech}
                  className="neon-button"
                  style={{
                    padding: '0.4rem 1rem',
                    fontSize: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    borderColor: 'var(--neon-red)',
                    color: 'var(--neon-red)'
                  }}
                >
                  🔇 STOP
                </button>
                <button
                  onClick={handlePrintReport}
                  className="neon-button"
                  style={{
                    padding: '0.4rem 1rem',
                    fontSize: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}
                >
                  💾 SAVE PDF
                </button>
                <button
                  onClick={() => {
                    stopSpeech();
                    setActiveResearchMessage(null);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--neon-red)',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    outline: 'none',
                    fontWeight: 'bold',
                    padding: '0.2rem 0.5rem'
                  }}
                >
                  [ X ]
                </button>
              </div>
            </div>

            {/* Modal Textbook Content Body */}
            <div 
              className="textbook-print-area" 
              style={{
                flex: 1,
                overflowY: 'auto',
                background: '#fdfdfd',
                color: '#2b2b2b',
                fontFamily: "'Georgia', 'Times New Roman', serif",
                fontSize: '1.1rem',
                lineHeight: '1.75',
                padding: '3rem 4rem',
                boxSizing: 'border-box'
              }}
            >
              <div className="markdown-render textbook-content" style={{ width: '100%' }}>
                <ReactMarkdown
                  remarkPlugins={[remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={{
                    p({ children }) {
                      return <p style={{ margin: '0 0 1.5rem 0', textAlign: 'justify' }}>{children}</p>;
                    },
                    h1({ children }) {
                      return <h1 style={{ fontSize: '2.2rem', color: '#111', borderBottom: '2px solid #333', paddingBottom: '0.5rem', marginBottom: '1.5rem', marginTop: 0 }}>{children}</h1>;
                    },
                    h2({ children }) {
                      return <h2 style={{ fontSize: '1.6rem', color: '#222', marginTop: '2rem', marginBottom: '1rem' }}>{children}</h2>;
                    },
                    h3({ children }) {
                      return <h3 style={{ fontSize: '1.25rem', color: '#333', marginTop: '1.5rem', marginBottom: '0.8rem' }}>{children}</h3>;
                    },
                    code({ node, inline, className, children, ...props }) {
                      return !inline ? (
                        <pre style={{
                          background: '#f8f8f8',
                          border: '1px solid #e0e0e0',
                          padding: '1rem',
                          borderRadius: '4px',
                          overflowX: 'auto',
                          margin: '1.5rem 0'
                        }}>
                          <code style={{
                            fontFamily: "Courier New, Courier, monospace",
                            fontSize: '0.9rem',
                            color: '#333',
                            background: 'none',
                            padding: 0
                          }} {...props}>
                            {children}
                          </code>
                        </pre>
                      ) : (
                        <code style={{
                          background: '#f4f4f4',
                          color: '#c0392b',
                          padding: '0.1rem 0.3rem',
                          borderRadius: '3px',
                          fontFamily: "Courier New, Courier, monospace",
                          fontSize: '0.9rem'
                        }} {...props}>
                          {children}
                        </code>
                      );
                    },
                    blockquote({ children }) {
                      return (
                        <blockquote style={{
                          borderLeft: '4px solid #888',
                          margin: '1.5rem 0',
                          paddingLeft: '1.2rem',
                          color: '#555',
                          fontStyle: 'italic'
                        }}>
                          {children}
                        </blockquote>
                      );
                    },
                    div({ node, className, children, ...props }) {
                      if (className && className.includes('math-display')) {
                        return <div className="latex-block-textbook" style={{ margin: '1rem 0', padding: '1rem', background: '#fcfcfc', border: '1px solid #eaeaea', borderRadius: '4px', fontSize: '1.15rem', display: 'flex', justifyContent: 'center' }} {...props}>{children}</div>;
                      }
                      return <div className={className} {...props}>{children}</div>;
                    },
                    span({ node, className, children, ...props }) {
                      if (className && className.includes('math-inline')) {
                        return <span style={{ color: '#111', fontFamily: 'inherit' }} {...props}>{children}</span>;
                      }
                      return <span className={className} {...props}>{children}</span>;
                    }
                  }}
                >
                  {activeResearchMessage.content}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      )}

    {/* Floating Emergency Stop Audio Button */}
    {isSpeaking && (
      <button
        onClick={() => {
          stopSpeech();
          setAutoPlaySpeech(false);
        }}
        className="no-print"
        style={{
          position: 'fixed',
          bottom: '2.5rem',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10000,
          background: 'var(--neon-red)',
          color: '#ffffff',
          border: 'none',
          padding: '0.8rem 2.2rem',
          borderRadius: '30px',
          fontFamily: 'var(--font-header)',
          fontSize: '0.85rem',
          fontWeight: 'bold',
          letterSpacing: '1px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          boxShadow: '0 4px 20px rgba(195, 141, 125, 0.4)',
          animation: 'calmPulse 2s infinite',
          outline: 'none',
          transition: 'transform 0.2s ease'
        }}
        onMouseEnter={(e) => e.target.style.transform = 'translateX(-50%) scale(1.05)'}
        onMouseLeave={(e) => e.target.style.transform = 'translateX(-50%) scale(1.0)'}
      >
        <span>⏹ STOP AUDIO</span>
      </button>
    )}
    </div>
  );
}
