import axios from 'axios';

/**
 * Call the Gemini API to generate content.
 * @param {string} model - The model name (e.g. 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-thinking-exp')
 * @param {Array} contents - The conversation history or current prompt in Gemini format
 * @param {string} [systemInstruction] - Optional system instructions
 * @param {object} [generationConfig] - Optional generation configuration (e.g. responseMimeType)
 * @returns {Promise<object>} The API response data
 */
export async function callGemini(model, contents, systemInstruction = '', generationConfig = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error('Gemini API key is not configured in .env file.');
  }

  // Gemini models must map to the correct names
  // e.g. gemini-2.0-flash-thinking-exp or gemini-2.5-flash
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Filter out client-side specific settings (like speakingRate) to prevent Gemini API errors
  const { speakingRate, ...cleanGenerationConfig } = generationConfig;

  const requestBody = {
    contents,
    generationConfig: {
      temperature: 0.2, // low temperature for consistent reasoning/routing/coding
      ...cleanGenerationConfig
    }
  };

  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  try {
    const response = await axios.post(url, requestBody, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.candidates && response.data.candidates[0]) {
      const text = response.data.candidates[0].content.parts[0].text;
      return {
        text,
        usage: response.data.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
        raw: response.data
      };
    } else {
      throw new Error('Invalid response format from Gemini API');
    }
  } catch (error) {
    console.error('Gemini API Error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.message || error.message);
  }
}
