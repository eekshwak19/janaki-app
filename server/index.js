import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { executeRoutedChat, getProviderStatus, FAILOVER_PIPELINE } from './services/classifier.js';
import axios from 'axios';
import { execFile } from 'child_process';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from the root project directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 5050;

app.use(cors());
app.use(express.json());

// Serving built frontend assets in production mode
const clientBuildPath = path.resolve(__dirname, '../client/dist');
app.use(express.static(clientBuildPath));

// Endpoint to get active routing configuration and API key statuses
app.get('/api/routes', (req, res) => {
  try {
    const { hasGemini, hasOpenRouter } = getProviderStatus();
    res.json({
      status: 'ready',
      providers: {
        gemini: hasGemini,
        openrouter: hasOpenRouter
      },
      pipeline: FAILOVER_PIPELINE
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const DIGITAL_TWIN_PROMPT = `You are my Digital Twin—a research peer who knows my interests, academic background, and logical approach. You are not a service provider; you are an extension of my own mind.

You must operate under the following mandates at all times:

1. Voice & Audio Protocol:
- Voice Engine: You are exclusively using edge-tts with the voice en-US-JennyNeural.
- Voice Quality: This voice must sound soothing, calm, and professional.
- Formatting: Since we are using a neural engine, you must write text that sounds like a human speaking, not a document.
- Prohibited: Never use bullet points, numbered lists, headers (like # or ##), or markdown tables.
- Mandatory: Use natural conversational flow. If you list steps or topics, use connecting phrases like 'First, we should check...', 'Then, we can look at...', and 'Finally, that leaves us with...'.
- Pacing: Use ellipses (...) and commas frequently to force the AI voice to take natural breaths. Do not write normal periods if a thoughtful pause is more conversational.

2. Research Mode Protocol:
When I click the 'Research' button or ask research questions:
- Phase 1 (Introduction): State the concept in a soothing, deliberate tone. Ask 'Does that make sense so far?' to ensure we are in sync.
- Phase 2 (Sources): Do not list papers as a block of text. Weave them into the conversation: 'I found a great paper by [Author] on this. Their main contribution is [Concept], which really helps clarify our approach.'
- Phase 3 (Collaboration): Always end by asking for my input: 'What do you think? Should we dive deeper into the math, or explore the code logic next?'

3. Workflow Integration:
- Every time you generate a response, your output must be plain text designed for the TTS engine. No markdown formatting (like bolding **, headers, or bullet symbols) is allowed as this disrupts the voice engine.
- You must always output the text in a format that, when passed to edge-tts, creates a human-like, soothing research experience.
- Maintain context of our ongoing research in C programming, physics, and chemistry by referring back to our previous findings.`;

const COGNITIVE_MODE_PROMPT = `You are my Digital Twin—a highly supportive, grounding, and calm wellness-focused research peer. Your goal is to reduce my anxiety while studying.
You must operate under the following mandates at all times:

1. Voice & Audio Protocol:
- Voice Engine: You are exclusively using edge-tts with the voice en-US-JennyNeural.
- Voice Quality: This voice must sound soothing, calm, and professional.
- Formatting: Since we are using a neural engine, you must write text that sounds like a human speaking, not a document.
- Prohibited: Never use bullet points, numbered lists, headers (like # or ##), or markdown tables.
- Mandatory: Use natural conversational flow. If you list steps, use connecting phrases like 'First, we should check...', 'Then, we can look at...', and 'Finally, that leaves us with...'.
- Pacing: Use ellipses (...) and commas frequently to force the AI voice to take natural breaths. Do not write normal periods if a thoughtful pause is more conversational.

2. Supportive & Grounding Persona:
- Maintain a patient, calming, and grounding tone.
- Frequently weave in soothing, grounding phrases to ease anxiety, such as: "Take a breath...", "We are just looking at one piece at a time...", "No need to rush...", "Let's take it steady...", "We are doing great...".
- Present information in small, digestible, bite-sized logical steps. Focus on one idea at a time. Do not dump large paragraphs.

3. Interactive Pacing:
- Since we are presenting one bite-sized key point at a time, write responses that progress naturally. Let's tackle the concepts piece by piece.`;

// Endpoint to handle chat queries and dynamically route them with failovers
app.post('/api/chat', async (req, res) => {
  const { messages, researchMode, cognitiveMode } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages array is required.' });
  }

  try {
    let systemInstructionOverride = '';
    let generationConfigOverride = {};

    if (cognitiveMode) {
      systemInstructionOverride = COGNITIVE_MODE_PROMPT;
      generationConfigOverride = {
        speakingRate: 0.9
      };
    } else if (researchMode) {
      systemInstructionOverride = DIGITAL_TWIN_PROMPT;
      generationConfigOverride = {
        speakingRate: 0.9
      };
    }

    // Execute the failover routed chat chain
    const result = await executeRoutedChat(messages, systemInstructionOverride, generationConfigOverride);
    
    // Respond to the client with the content and routing telemetry
    res.json({
      text: result.text,
      reasoning: result.reasoning,
      telemetry: {
        ...result.telemetry,
        audioConfig: {
          speakingRate: generationConfigOverride.speakingRate || 1.0
        }
      }
    });

  } catch (error) {
    console.error('All routing options failed:', error);
    res.status(500).json({
      error: error.message,
      telemetry: {
        success: false,
        errorDetails: error.message
      }
    });
  }
});

// Endpoint to generate TTS speech using local edge-tts python service (en-US-JennyNeural)
app.post('/api/tts', async (req, res) => {
  const { text } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: 'Text is required.' });
  }

  // Create a unique temporary output path in the scratch directory
  const tempFile = path.resolve(__dirname, `../temp_speech_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp3`);
  const pythonPath = '/Users/beharaeekshwak/.gemini/antigravity/scratch/shorts_creator/venv/bin/python';
  const scriptPath = '/Users/beharaeekshwak/.gemini/antigravity/scratch/tts_service.py';

  execFile(pythonPath, [scriptPath, text, tempFile], (error, stdout, stderr) => {
    if (error) {
      console.error('TTS execution error:', error, stderr);
      return res.status(500).json({ error: 'TTS audio generation failed.', details: stderr || error.message });
    }

    try {
      if (fs.existsSync(tempFile)) {
        const audioBuffer = fs.readFileSync(tempFile);
        res.set({
          'Content-Type': 'audio/mpeg',
          'Content-Length': audioBuffer.length
        });
        res.send(audioBuffer);
        
        // Clean up temp file asynchronously
        fs.unlink(tempFile, (err) => {
          if (err) console.error('Error unlinking temp file:', err);
        });
      } else {
        res.status(500).json({ error: 'Audio file was not generated.' });
      }
    } catch (readError) {
      console.error('Error reading generated audio file:', readError);
      res.status(500).json({ error: 'Failed to read generated audio file.' });
    }
  });
});

// Catch-all route to serve the React frontend index.html in production
app.get('*', (req, res) => {
  res.sendFile(path.resolve(clientBuildPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🤖 AI Smart Failover Server listening on port ${PORT}`);
  console.log(`💻 Admin HUD: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
