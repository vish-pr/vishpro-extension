import logger from './logger.js';
import { getModelStatsCounter } from './time-bucket-counter.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const SITE_NAME = 'VishPro Browser Agent';
const CACHE_TTL = 5 * 60 * 1000;
const DEFAULT_MODELS = {
  HIGH: [['google/gemini-2.5-pro', ['google-ai-studio']], ['qwen/qwen3-235b-a22b-2507', ['Cerebras']]],
  MEDIUM: [['openai/gpt-oss-120b', ['Cerebras']], ['google/gemini-2.5-flash', ['google-ai-studio']], ['meta-llama/llama-3.3-70b-instruct', ['Cerebras']]],
  LOW: [['google/gemini-2.5-flash-lite', ['google-ai-studio']], ['qwen/qwen3-32b', ['Cerebras']]]
};

let apiKey = null;
const modelFailures = new Map();
let cachedModels = null, modelsTime = 0, cachedProviders = null, providersTime = 0;

async function loadModels() {
  return (await chrome.storage.local.get(['llmModels'])).llmModels || DEFAULT_MODELS;
}

async function getCascadingModels(intelligence) {
  const m = await loadModels(), levels = ['HIGH', 'MEDIUM', 'LOW'];
  return levels.slice(Math.max(0, levels.indexOf(intelligence))).flatMap(l => (m[l] || []).map(([model, only, opts]) => ({ model, only, noToolChoice: opts?.noToolChoice })));
}

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

async function callAPI(model, messages, tools, only, noToolChoice) {
  const request = { model, messages, tools };
  if (!noToolChoice) request.tool_choice = 'required';
  if (only?.length) request.provider = { only };
  logger.debug(`LLM Request Details`, { request });
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': SITE_NAME },
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error?.message || 'Unknown error';
    const details = err.error?.metadata?.raw || err.error?.metadata?.provider_name || '';
    throw new Error(details ? `${msg} - ${details}` : msg);
  }
  const message = (await response.json()).choices?.[0]?.message;
  if (!message) throw new Error('Empty response from API');
  return message;
}

export async function generate({ messages, intelligence = 'MEDIUM', tools }) {
  if (!tools?.length) throw new Error('Tools array is required');
  if (!await isInitialized()) throw new Error('OpenRouter API key not configured');
  const cascadingModels = await getCascadingModels(intelligence);
  let lastError = null;
  for (const { model, only, noToolChoice } of cascadingModels) {
    if (shouldSkip(model)) continue;
    try {
      logger.info(`LLM Request: ${model}`, { messageCount: messages.length, intelligence, toolCount: tools.length });
      const result = await callAPI(model, messages, tools, only, noToolChoice);
      if (result.tool_calls?.length && !result.tool_calls[0].function?.name) throw new Error('Invalid tool call: missing function name');
      logger.info(`LLM Response: ${model}`);
      logger.debug(`LLM Response Details`, { model, response: result });
      modelFailures.delete(model);
      getModelStatsCounter().increment(model, 'success').catch(e => logger.warn('Stats increment failed', { error: e.message }));
      return result;
    } catch (error) {
      lastError = error;
      recordFailure(model);
      getModelStatsCounter().increment(model, 'error').catch(e => logger.warn('Stats increment failed', { error: e.message }));
      logger.warn(`LLM Failure: ${model}`, { model, error: error.message });
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

export async function setApiKey(key) { apiKey = key; await chrome.storage.local.set({ openrouterApiKey: key }); }

export async function verifyApiKey(key) {
  try { return (await fetch('https://openrouter.ai/api/v1/auth/key', { headers: { 'Authorization': `Bearer ${key}` } })).ok; }
  catch { return false; }
}

export async function getModels() { return loadModels(); }
export async function setModels(m) { await chrome.storage.local.set({ llmModels: m }); modelFailures.clear(); }
export function getDefaultModels() { return JSON.parse(JSON.stringify(DEFAULT_MODELS)); }

export async function fetchAvailableModels() {
  if (cachedModels && Date.now() - modelsTime < CACHE_TTL) return cachedModels;
  try {
    const data = await (await fetch('https://openrouter.ai/api/v1/models')).json();
    cachedModels = data.data.map(m => ({ id: m.id, name: m.name }));
    modelsTime = Date.now();
    return cachedModels;
  } catch { return cachedModels || []; }
}

export async function fetchAvailableProviders() {
  if (cachedProviders && Date.now() - providersTime < CACHE_TTL) return cachedProviders;
  if (!apiKey) {
    const result = await chrome.storage.local.get(['openrouterApiKey']);
    if (!result.openrouterApiKey) return cachedProviders || [];
    apiKey = result.openrouterApiKey;
  }
  try {
    const data = await (await fetch('https://openrouter.ai/api/v1/providers', { headers: { 'Authorization': `Bearer ${apiKey}` } })).json();
    cachedProviders = data.data.map(p => ({ name: p.name, slug: p.slug }));
    providersTime = Date.now();
    return cachedProviders;
  } catch { return cachedProviders || []; }
}

export async function getModelStats() {
  return getModelStatsCounter().getAllStats();
}

export async function resetModelStats(model = null) {
  return getModelStatsCounter().reset(model);
}

const VERIFY_TOOL = [{
  type: 'function',
  function: { name: 'test', description: 'Test function', parameters: { type: 'object', properties: {} } }
}];

export async function verifyModel(modelId, providers = []) {
  if (!await isInitialized()) return { valid: false, error: 'API key not configured' };
  const baseRequest = { model: modelId, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1, tools: VERIFY_TOOL };
  if (providers.length) baseRequest.provider = { only: providers };

  // First try with tool_choice
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': SITE_NAME },
      body: JSON.stringify({ ...baseRequest, tool_choice: 'required' })
    });
    if (response.ok) return { valid: true };
    const err = await response.json().catch(() => ({}));
    const errorMsg = err.error?.message || 'Model verification failed';

    // Check if it's a tool_choice error - retry without tool_choice
    // Match various provider error patterns (case-insensitive)
    const lowerMsg = errorMsg.toLowerCase();
    if (lowerMsg.includes('tool_choice') || lowerMsg.includes('tool choice') ||
        (lowerMsg.includes('tool') && lowerMsg.includes('not supported'))) {
      const retryResponse = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': SITE_NAME },
        body: JSON.stringify(baseRequest)
      });
      if (retryResponse.ok) return { valid: true, noToolChoice: true };
      return { valid: false, error: (await retryResponse.json().catch(() => ({}))).error?.message || 'Model verification failed' };
    }
    return { valid: false, error: errorMsg };
  } catch (e) { return { valid: false, error: e.message }; }
}
