import axios from 'axios';

/**
 * Call the OpenRouter API.
 * @param {string} model - The model identifier (e.g. 'deepseek/deepseek-r1', 'meta-llama/llama-3.3-70b-instruct')
 * @param {Array} messages - The message history in OpenAI format: [{role: 'user'|'assistant'|'system', content: string}]
 * @returns {Promise<object>} The model's response text and usage metadata
 */
export async function callOpenRouter(model, messages) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'YOUR_OPENROUTER_API_KEY_HERE') {
    throw new Error('OpenRouter API key is not configured in .env file.');
  }

  const url = 'https://openrouter.ai/api/v1/chat/completions';

  try {
    const response = await axios.post(
      url,
      {
        model,
        messages,
        temperature: 0.2
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:5000',
          'X-Title': 'AI Smart Router'
        }
      }
    );

    if (response.data && response.data.choices && response.data.choices[0]) {
      const choice = response.data.choices[0];
      const text = choice.message.content;
      const usage = response.data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      
      // If there is reasoning token/content (like in DeepSeek-R1), try to extract it
      // OpenRouter sometimes puts reasoning in choices[0].message.reasoning or message.reasoning_content
      const reasoning = choice.message.reasoning || choice.message.reasoning_content || null;

      return {
        text,
        reasoning,
        usage: {
          promptTokenCount: usage.prompt_tokens,
          candidatesTokenCount: usage.completion_tokens,
          totalTokenCount: usage.total_tokens
        },
        raw: response.data
      };
    } else {
      throw new Error('Invalid response format from OpenRouter API');
    }
  } catch (error) {
    console.error('OpenRouter API Error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.message || error.message);
  }
}
