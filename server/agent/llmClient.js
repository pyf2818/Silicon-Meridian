import { allowPrivateAiNetwork, safeExternalFetch } from '../security/urlSafety.js';

/** Shared non-streaming model transport for background work, including body-read timeout. */
export async function requestChatCompletion(llmConfig, payload, { timeoutMs = 90_000 } = {}) {
  if (typeof llmConfig?.baseUrl !== 'string' || !llmConfig.baseUrl.trim()
    || typeof llmConfig?.selectedModel !== 'string' || !llmConfig.selectedModel.trim()) {
    throw Object.assign(new Error('llmConfig.baseUrl and llmConfig.selectedModel are required'), { status: 400 });
  }
  const baseUrl = llmConfig.baseUrl.trim().replace(/\/+$/, '');
  const url = /\/v[1-4]$/.test(baseUrl) ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await safeExternalFetch(url, {
      allowPrivate: allowPrivateAiNetwork(),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(llmConfig.apiKey ? { Authorization: `Bearer ${llmConfig.apiKey}` } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify({ ...payload, model: llmConfig.selectedModel }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw Object.assign(new Error(`LLM API ${response.status}: ${detail.slice(0, 200)}`), {
        status: response.status === 429 ? 429 : 502, code: 'UPSTREAM_AI_ERROR',
      });
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
