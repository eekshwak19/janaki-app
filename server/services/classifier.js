import { callGemini } from './gemini.js';
import { callOpenRouter } from './openrouter.js';

// Define the sequential failover pipeline
export const FAILOVER_PIPELINE = [
  {
    id: 'gemini_primary',
    name: 'Gemini (Primary)',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    requiresKey: 'GEMINI_API_KEY'
  },
  {
    id: 'gemini_lite_fallback',
    name: 'Gemini Lite (Fallback)',
    provider: 'gemini',
    model: 'gemini-2.5-flash-lite',
    requiresKey: 'GEMINI_API_KEY'
  },
  {
    id: 'deepseek_fallback',
    name: 'DeepSeek R1 Free (Fallback 1)',
    provider: 'openrouter',
    model: 'deepseek/deepseek-r1:free',
    requiresKey: 'OPENROUTER_API_KEY'
  },
  {
    id: 'llama_fallback',
    name: 'Llama 3.3 70B Free (Fallback 2)',
    provider: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    requiresKey: 'OPENROUTER_API_KEY'
  }
];

/**
 * Check which API keys are configured in the environment.
 * @returns {object} Provider key availability statuses
 */
export function getProviderStatus() {
  const hasGemini = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE');
  const hasOpenRouter = !!(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY !== 'YOUR_OPENROUTER_API_KEY_HERE');
  return { hasGemini, hasOpenRouter };
}

/**
 * Convert OpenAI message history format to Gemini API contents format.
 */
function convertToGeminiHistory(messages) {
  return messages.map(msg => {
    let role = 'user';
    if (msg.role === 'assistant' || msg.role === 'model') {
      role = 'model';
    }
    return {
      role,
      parts: [{ text: msg.content }]
    };
  });
}

/**
 * Execute the sequential failover routing logic.
 * Attempts Gemini, falls back to DeepSeek, falls back to Llama.
 * @param {Array} messages - Chat history in OpenAI format
 * @returns {Promise<object>} Contains response text, reasoning, and routing telemetry
 */
/**
 * Execute the sequential failover routing logic.
 * Attempts Gemini, falls back to DeepSeek, falls back to Llama.
 * @param {Array} messages - Chat history in OpenAI format
 * @param {string} [systemInstructionOverride] - Custom system instruction to override default rules
 * @param {object} [generationConfigOverride] - Custom generation configuration parameters
 * @returns {Promise<object>} Contains response text, reasoning, and routing telemetry
 */
export async function executeRoutedChat(messages, systemInstructionOverride = '', generationConfigOverride = {}) {
  const routingHistory = [];
  const { hasGemini, hasOpenRouter } = getProviderStatus();

  // Detect card system queries to inject diagram constraints
  const lastUserMessage = [...messages].reverse().find(msg => msg.role === 'user');
  const isCardSystem = lastUserMessage && /\b(clearly|briefly)\b/i.test(lastUserMessage.content);

  const defaultSystemInstruction = isCardSystem 
    ? "You must provide your response in plain text and LaTeX formulas only. Strict rule: DO NOT include any diagrams, ASCII drawings, structural layouts, tables, or Mermaid flowcharts in your response." 
    : "";

  let systemInstruction = systemInstructionOverride || defaultSystemInstruction;
  if (isCardSystem && systemInstructionOverride) {
    systemInstruction += "\n\nYou must provide your response in plain text and LaTeX formulas only. Strict rule: DO NOT include any diagrams, ASCII drawings, structural layouts, tables, or Mermaid flowcharts in your response.";
  }

  for (const step of FAILOVER_PIPELINE) {
    const isGeminiStep = step.provider === 'gemini';
    const isKeyConfigured = isGeminiStep ? hasGemini : hasOpenRouter;

    if (!isKeyConfigured) {
      routingHistory.push({
        model: step.model,
        name: step.name,
        provider: step.provider,
        status: 'skipped',
        error: 'API Key not configured'
      });
      continue;
    }

    routingHistory.push({
      model: step.model,
      name: step.name,
      provider: step.provider,
      status: 'attempting'
    });

    const currentHistoryIndex = routingHistory.length - 1;
    const startTime = Date.now();

    try {
      let resultText = '';
      let apiUsage = null;
      let reasoning = null;

      if (isGeminiStep) {
        const geminiHistory = convertToGeminiHistory(messages);
        const response = await callGemini(step.model, geminiHistory, systemInstruction, generationConfigOverride);
        resultText = response.text;
        apiUsage = response.usage;
      } else {
        const openRouterMessages = systemInstruction 
          ? [{ role: 'system', content: systemInstruction }, ...messages]
          : messages;
        const response = await callOpenRouter(step.model, openRouterMessages);
        resultText = response.text;
        apiUsage = response.usage;
        reasoning = response.reasoning;
      }

      // Cleanup visual diagrams if any leak into the response
      if (isCardSystem) {
        resultText = resultText.replace(/```(mermaid|svg|ascii|diagram|flowchart|draw|drawio|plantuml|table)[\s\S]*?```/g, '');
      }

      const latencyMs = Date.now() - startTime;
      
      // Update historical attempt to success
      routingHistory[currentHistoryIndex] = {
        ...routingHistory[currentHistoryIndex],
        status: 'success',
        latencyMs,
        usage: apiUsage
      };

      return {
        text: resultText,
        reasoning,
        telemetry: {
          success: true,
          activeStep: step,
          latencyMs,
          usage: apiUsage,
          routingHistory
        }
      };

    } catch (error) {
      console.warn(`Routing failed for ${step.name}:`, error.message);
      
      // Update history step to failed
      routingHistory[currentHistoryIndex] = {
        ...routingHistory[currentHistoryIndex],
        status: 'failed',
        error: error.message,
        latencyMs: Date.now() - startTime
      };
      
      // Continue to next fallback in the loop
    }
  }

  // If all models failed or skipped
  throw new Error('All routing options in the failover chain failed or were skipped.');
}
