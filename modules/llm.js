// OpenRouter LLM Client with Cascading Model Support
import logger from './logger.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const SITE_NAME = 'VishPro Browser Agent';

// Default model tiers: [model, routing]
const DEFAULT_MODELS = {
  HIGH: [
    ['google/gemini-2.5-pro', ['google-ai-studio']],
    ['qwen/qwen3-235b-a22b-2507', ['Cerebras']]
  ],
  MEDIUM: [
    ['openai/gpt-oss-120b', ['Cerebras']],
    ['google/gemini-2.5-flash', ['google-ai-studio']],
    ['meta-llama/llama-3.3-70b-instruct', ['Cerebras']]
  ],
  LOW: [
    ['google/gemini-2.5-flash-lite', ['google-ai-studio']],
    ['qwen/qwen3-32b', ['Cerebras']]
  ]
};

let apiKey = null;
let models = null;
const modelFailures = new Map();

// Load models from storage or use defaults
async function loadModels() {
  if (models) return models;
  const result = await chrome.storage.local.get(['llmModels']);
  models = result.llmModels || DEFAULT_MODELS;
  return models;
}

// Get cascading models from requested level down
async function getCascadingModels(intelligence) {
  const m = await loadModels();
  const levels = ['HIGH', 'MEDIUM', 'LOW'];
  const startIdx = Math.max(0, levels.indexOf(intelligence));

  return levels.slice(startIdx).flatMap(level =>
    (m[level] || []).map(([model, only]) => ({ model, only }))
  );
}

// Fail-fast: skip models that failed recently
function shouldSkip(model) {
  const t = modelFailures.get(model);
  if (!t || t.failures === 0) return false;
  if (t.skips < t.failures) { t.skips++; return true; }
  return false;
}

function recordFailure(model) {
  const t = modelFailures.get(model);
  if (!t) modelFailures.set(model, { failures: 1, skips: 0 });
  else if (t.skips >= t.failures) { t.failures++; t.skips = 0; }
}

function recordSuccess(model) {
  modelFailures.delete(model);
}

// Core API call
async function callAPI(model, messages, tools, only) {
  const request = { model, messages, tools };
  if (only) request.provider = { only };

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': SITE_NAME
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error?.message || 'Unknown error';
    const details = err.error?.metadata?.raw || err.error?.metadata?.provider_name || '';
    throw new Error(details ? `${msg} - ${details}` : msg);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error('Empty response from API');
  return message;
}

// Main generate function with cascading failover
export async function generate({ messages, intelligence = 'MEDIUM', tools }) {
  if (!tools?.length) throw new Error('Tools array is required');
  if (!await isInitialized()) throw new Error('OpenRouter API key not configured');

  const cascadingModels = await getCascadingModels(intelligence);
  let lastError = null;

  for (const { model, only } of cascadingModels) {
    if (shouldSkip(model)) {
      logger.debug(`Skipping ${model} (fail-fast)`);
      continue;
    }

    try {
      logger.info(`LLM Call: ${model}`, { messageCount: messages.length, toolCount: tools.length });
      const result = await callAPI(model, messages, tools, only);

      if (result.tool_calls?.length && !result.tool_calls[0].function?.name) {
        throw new Error('Invalid tool call: missing function name');
      }

      logger.info(`LLM Success: ${model}`);
      recordSuccess(model);
      return result;
    } catch (error) {
      lastError = error;
      recordFailure(model);
      logger.warn(`LLM Failure: ${model}`, { error: error.message });
    }
  }

  throw new Error(`All models failed. Last error: ${lastError?.message || 'Unknown'}`);
}

export async function isInitialized() {
  if (apiKey) return true;
  const result = await chrome.storage.local.get(['openrouterApiKey']);
  if (result.openrouterApiKey) { apiKey = result.openrouterApiKey; return true; }
  return false;
}

export async function setApiKey(key) {
  apiKey = key;
  await chrome.storage.local.set({ openrouterApiKey: key });
}

export async function verifyApiKey(key) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    return response.ok;
  } catch { return false; }
}

// Model configuration exports
export async function getModels() {
  return await loadModels();
}

export async function setModels(newModels) {
  models = newModels;
  await chrome.storage.local.set({ llmModels: newModels });
  modelFailures.clear(); // Reset failure tracking
}

export function getDefaultModels() {
  return JSON.parse(JSON.stringify(DEFAULT_MODELS));
}

export const INTELLIGENCE_LEVEL = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' };
