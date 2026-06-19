/**
 * Text-to-Speech utility using the backend edge-tts API proxy,
 * with fallback to the browser's Web Speech API (window.speechSynthesis).
 */

let currentUtterance = null;
let currentAudio = null;
let activeAbortController = null;
let speechListeners = [];

export function subscribeSpeechState(listener) {
  speechListeners.push(listener);
  // Initial state check
  listener(!!(currentAudio || (window.speechSynthesis && window.speechSynthesis.speaking)));
  return () => {
    speechListeners = speechListeners.filter(l => l !== listener);
  };
}

function notifySpeechState(isSpeaking) {
  speechListeners.forEach(l => {
    try {
      l(isSpeaking);
    } catch (err) {
      console.error('Error in speech listener:', err);
    }
  });
}

/**
 * Cleans markdown, LaTeX formulas, code snippets, and structural artifacts from text
 * to make it sound natural and readable when spoken.
 */
export function cleanTextForSpeech(text) {
  if (!text) return '';

  let cleaned = text;

  // 1. Remove code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, ' ');

  // 2. Remove LaTeX equation blocks ($$...$$ and $...$)
  cleaned = cleaned.replace(/\$\$[\s\S]*?\$\$/g, ' [mathematical formula] ');
  cleaned = cleaned.replace(/\$[^\$]+?\$/g, ' [formula] ');

  // 3. Remove inline code snippets
  cleaned = cleaned.replace(/`[^`]+?`/g, ' ');

  // 4. Resolve markdown links [text](url) -> text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

  // 5. Clean up markdown bold/italics (* and _)
  cleaned = cleaned.replace(/[\*_]/g, '');

  // 6. Clean up headers (#)
  cleaned = cleaned.replace(/^#+\s+/gm, '');

  // 7. Clean up list symbols/bullets (*, -, numbers) at start of lines
  cleaned = cleaned.replace(/^[\s\-\*\+]\s+/gm, '');
  cleaned = cleaned.replace(/^\d+\.\s+/gm, '');

  // 8. Clean up horizontal lines
  cleaned = cleaned.replace(/^-{3,}/gm, '');

  // 9. Standardize math character descriptions for voice
  cleaned = cleaned.replace(/\^2\b/g, ' squared');
  cleaned = cleaned.replace(/\^3\b/g, ' cubed');
  cleaned = cleaned.replace(/\bpi\b/i, 'pi');
  cleaned = cleaned.replace(/\bint\b/i, 'integral');

  // 10. Collapse multiple whitespaces and trim
  cleaned = cleaned.replace(/\s+/g, ' ');

  return cleaned.trim();
}

/**
 * Speaks the specified text with the backend edge-tts service.
 * Stops any current speech before beginning, and aborts any active generation request.
 * @param {string} text - Raw text/markdown to read
 * @param {number} rate - Speed/rate multiplier (default 1.0)
 */
export async function speakText(text, rate = 1.0) {
  try {
    // Stop any active speech/audio/active fetch requests
    stopSpeech();

    const voiceText = cleanTextForSpeech(text);
    if (!voiceText) return;

    // Create a new AbortController for this fetch
    activeAbortController = new AbortController();
    const { signal } = activeAbortController;

    // Try calling the backend edge-tts proxy first
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: voiceText
        }),
        signal
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        
        // If aborted in the meantime, do not play the audio
        if (signal.aborted) return;

        const audioUrl = URL.createObjectURL(audioBlob);
        currentAudio = new Audio(audioUrl);
        currentAudio.onended = () => {
          currentAudio = null;
          notifySpeechState(false);
        };
        currentAudio.onerror = () => {
          currentAudio = null;
          notifySpeechState(false);
        };
        currentAudio.play();
        notifySpeechState(true);
        return; // Complete success
      } else {
        const errData = await response.json().catch(() => ({}));
        console.warn(`TTS API not available: ${errData.error || response.statusText}. Falling back to browser voice synthesis.`);
      }
    } catch (apiError) {
      if (apiError.name === 'AbortError') {
        console.log('TTS fetch request aborted by user.');
        return; // Aborted cleanly
      }
      console.warn('Failed to reach TTS API. Falling back to browser voice synthesis:', apiError.message);
    }

    // Fallback: Web Speech API
    if (window.speechSynthesis) {
      const utterance = new SpeechSynthesisUtterance(voiceText);
      utterance.rate = rate;

      // Select ONLY the en-US-JennyNeural voice (or general Jenny voice)
      let voices = window.speechSynthesis.getVoices();
      let jennyVoice = voices.find(v => 
        v.name.toLowerCase().includes('jenny') || 
        v.id?.toLowerCase().includes('jenny')
      );

      if (!jennyVoice && voices.length === 0) {
        // Try waiting 100ms for async voices to load
        await new Promise(resolve => setTimeout(resolve, 100));
        voices = window.speechSynthesis.getVoices();
        jennyVoice = voices.find(v => 
          v.name.toLowerCase().includes('jenny') || 
          v.id?.toLowerCase().includes('jenny')
        );
      }

      if (jennyVoice) {
        utterance.voice = jennyVoice;
      } else {
        console.warn('en-US-JennyNeural voice not found in browser speech synthesis. Only en-US-JennyNeural is permitted.');
        return; // Do not use any other voice
      }

      utterance.onend = () => {
        currentUtterance = null;
        notifySpeechState(false);
      };
      utterance.onerror = () => {
        currentUtterance = null;
        notifySpeechState(false);
      };
      currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
      notifySpeechState(true);
    }
  } catch (error) {
    console.error('Speech synthesis execution failed:', error);
    notifySpeechState(false);
  }
}

/**
 * Halts all active speech (both HTML5 Audio, Web Speech Synthesis, and in-flight fetch requests).
 */
export function stopSpeech() {
  try {
    // Abort in-flight network request
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    currentUtterance = null;

    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    notifySpeechState(false);
  } catch (error) {
    console.error('Failed to cancel speech synthesis:', error);
    notifySpeechState(false);
  }
}
