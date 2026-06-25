/**
 * Fetch active route configuration and API key provider status from Express backend.
 * @returns {Promise<object>} Route mappings and API status
 */
export async function fetchRoutes() {
  try {
    const response = await fetch('/api/routes');
    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || `Server returned ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch routes config:', error);
    throw error;
  }
}

/**
 * Send messages history to backend and receive routed reply + telemetry logs.
 * @param {Array} messages - Chat history in OpenAI format [{role: 'user'|'assistant', content: string}]
 * @returns {Promise<object>} Routed reply and telemetry
 */
export async function sendChatMessage(messages, researchMode = false, cognitiveMode = false, systemInstruction = undefined) {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messages, researchMode, cognitiveMode, systemInstruction })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || `Server error ${response.status}`);
    }
    
    return data;
  } catch (error) {
    console.error('Chat routing request failed:', error);
    throw error;
  }
}
