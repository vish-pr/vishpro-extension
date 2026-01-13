// Settings Management
import { elements } from './dom.js';
import * as storage from './storage.js';
import { addMessage } from './chat.js';
import { setApiKey, getModels, setModels, getDefaultModels, fetchAvailableModels, fetchAvailableProviders, verifyModel } from './llm.js';
import { getModelStatsCounter } from './time-bucket-counter.js';
import Sortable from 'sortablejs';

let availableModels = [], availableProviders = [], currentModels = null;
const verificationStatus = new Map();
const TIERS = ['HIGH', 'MEDIUM', 'LOW'];
const STATUS = {
  VALID: { inputClass: 'input-success', textClass: 'text-success', icon: '✓' },
  INVALID: { inputClass: 'input-error', textClass: 'text-error', icon: '✗' },
  VERIFYING: { inputClass: 'input-warning', textClass: 'text-warning', icon: '⏳' }
};

// Template helper
const tpl = id => document.getElementById(id).content.cloneNode(true).firstElementChild;

async function verifyAllModels() {
  const tasks = [];
  const counter = getModelStatsCounter();
  let needsSave = false;
  for (const tier of TIERS) {
    for (let i = 0; i < (currentModels[tier]?.length || 0); i++) {
      const [model, providers] = currentModels[tier][i];
      const key = `${tier}:${i}`;
      if (!model || verificationStatus.has(key)) continue;
      tasks.push(verifyModel(model, providers || []).then(async result => {
        verificationStatus.set(key, { verified: result.valid, error: result.error });
        // Update model config if noToolChoice discovered
        if (result.noToolChoice) {
          currentModels[tier][i] = [model, providers, { noToolChoice: true }];
          needsSave = true;
        }
        await counter.increment(model, result.valid ? 'success' : 'error');
        renderTierModels(tier);
      }));
    }
  }
  await Promise.all(tasks);
  if (needsSave) saveModels();
}

function updateApiKeyStatus(status) {
  const { openrouterApiKey: input, openrouterApiKeyStatus: el } = elements;
  input.classList.remove('input-success', 'input-error', 'input-warning');
  el.classList.remove('text-success', 'text-error', 'text-warning');
  const s = status === true ? STATUS.VALID : status === false ? STATUS.INVALID : status === 'verifying' ? STATUS.VERIFYING : null;
  if (!s) { el.textContent = ''; return; }
  input.classList.add(s.inputClass);
  el.classList.add(s.textClass);
  el.textContent = s.icon;
}

function updateHeaderTitle() {
  storage.get(['openrouterApiKeyValid']).then(({ openrouterApiKeyValid: valid }) => {
    document.getElementById('statusDot')?.classList.toggle('active', valid);
    const text = document.getElementById('statusText');
    if (text) text.textContent = valid ? 'Ready' : 'No API Key';
  });
}

function toggleSettings(show) {
  elements.settingsPanel.classList.toggle('hidden', !show);
  elements.settingsToggle.classList.toggle('btn-active', show);
  if (show) {
    elements.extractionPanel.classList.add('hidden');
    elements.historyToggle.classList.remove('btn-active');
  }
}

async function verifyApiKey(apiKey) {
  updateApiKeyStatus('verifying');
  try {
    const { valid, error } = await chrome.runtime.sendMessage({ action: 'verifyApiKey', apiKey, provider: 'openrouter' });
    await storage.set({ openrouterApiKey: apiKey, openrouterApiKeyValid: valid });
    await setApiKey(apiKey);
    updateApiKeyStatus(valid);
    updateHeaderTitle();
    if (valid) {
      addMessage('system', '✓ OpenRouter API Key verified and saved');
      setTimeout(() => toggleSettings(false), 1000);
      fetchAvailableProviders().then(p => availableProviders = p);
      verificationStatus.clear();
      verifyAllModels();
    } else {
      addMessage('system', `✗ Invalid OpenRouter API Key: ${error || 'Verification failed'}`);
    }
  } catch (e) {
    updateApiKeyStatus(false);
    addMessage('system', `✗ Verification error: ${e.message}`);
  }
}

// Model Configuration
function createModelItem(model, provider, opts, tier, index, stats) {
  const el = tpl('tpl-model-item');
  el.dataset.tier = tier;
  el.dataset.index = index;
  el.querySelector('.model-name').textContent = model;

  // Provider badges
  const badgesEl = el.querySelector('.provider-badges');
  const providers = Array.isArray(provider) ? provider.filter(Boolean) : [];
  if (providers.length) {
    providers.forEach(p => {
      const badge = document.createElement('span');
      badge.className = 'badge badge-ghost badge-xs';
      badge.textContent = p;
      badgesEl.appendChild(badge);
    });
  } else {
    badgesEl.innerHTML = '<span class="text-[10px] opacity-40">auto routing</span>';
  }

  // Status indicator (solid lights, no animation)
  const statusEl = el.querySelector('.status-indicator');
  const status = verificationStatus.get(`${tier}:${index}`);
  if (status?.verified === true) {
    statusEl.innerHTML = `<div class="tooltip tooltip-right" data-tip="Verified"><div class="status status-success"></div></div>`;
  } else if (status?.verified === false) {
    statusEl.innerHTML = `<div class="tooltip tooltip-right tooltip-error" data-tip="${(status.error || 'Unknown error').replace(/"/g, '&quot;')}"><div class="status status-error"></div></div>`;
  }

  // Warning indicator for noToolChoice
  if (opts?.noToolChoice) {
    const warningEl = el.querySelector('.warning-indicator');
    warningEl.classList.remove('hidden');
    warningEl.innerHTML = `<div class="tooltip tooltip-bottom tooltip-warning" data-tip="No tool_choice support"><svg class="w-3 h-3 text-warning" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 21h22L12 2zm0 4l7.5 13h-15L12 6zm-1 5v4h2v-4h-2zm0 6v2h2v-2h-2z"/></svg></div>`;
  }

  // Inline stats
  if (stats) {
    const statsEl = el.querySelector('.model-stats');
    const success = stats.success?.total || 0;
    const error = stats.error?.total || 0;
    const total = success + error;
    if (total > 0) {
      const rate = Math.round((success / total) * 100);
      const rateClass = rate >= 90 ? 'text-success' : rate >= 70 ? 'text-warning' : 'text-error';
      statsEl.innerHTML = `<span class="${rateClass} font-medium">${rate}%</span><span class="opacity-40">·</span><span>${total} calls</span>`;
    }
  }

  return el;
}

function createEditingModelItem(model, provider, tier, index) {
  const el = tpl('tpl-model-editing');
  el.dataset.tier = tier;
  el.dataset.index = index;
  el.querySelector('.model-name-input').value = model;
  el.querySelector('.model-provider-input').value = Array.isArray(provider) ? provider.filter(Boolean).join(', ') : '';
  return el;
}

function updateAutocomplete(input, listEl, items, key, dataAttr) {
  const q = input.value.toLowerCase().trim();
  const matches = q
    ? items.filter(m => m[key].toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    : [...items].sort((a, b) => a[key].localeCompare(b[key]));
  if (!matches.length) { listEl.classList.add('hidden'); return; }
  listEl.innerHTML = matches.map(m => `<li class="px-2 py-1.5 rounded cursor-pointer hover:bg-base-300 transition-colors text-xs" data-${dataAttr.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${m[key]}"><div class="font-mono truncate">${m[key]}</div><div class="opacity-50 text-[10px] truncate">${m.name}</div></li>`).join('');
  listEl.classList.remove('hidden');
}

function updateModelAutocomplete(input, el) { updateAutocomplete(input, el, availableModels, 'id', 'modelId'); }

function updateProviderAutocomplete(input, el, modelInput) {
  const modelId = modelInput?.value.trim();
  if (!modelId || !availableModels.some(m => m.id === modelId)) { el.classList.add('hidden'); return; }
  updateAutocomplete(input, el, availableProviders, 'slug', 'provider');
}

const getListEl = tier => elements[`modelList${tier.charAt(0) + tier.slice(1).toLowerCase()}`];

let cachedStats = null;

async function refreshStats() {
  const counter = getModelStatsCounter();
  cachedStats = await counter.getAllStats();
}

async function renderTierModels(tier) {
  const listEl = getListEl(tier);
  listEl.innerHTML = '';
  const models = currentModels[tier] || [];
  if (!models.length) {
    listEl.innerHTML = '<li class="text-center text-xs opacity-50 py-4">No models configured</li>';
    return;
  }
  if (!cachedStats) await refreshStats();
  models.forEach(([m, p, opts], i) => listEl.appendChild(createModelItem(m, p, opts, tier, i, cachedStats[m])));
}

async function renderAllModels() {
  await refreshStats();
  TIERS.forEach(renderTierModels);
}

const saveModels = () => setModels(currentModels);

function shiftVerificationStatus(tier, fromIdx, direction) {
  const len = currentModels[tier].length;
  if (direction < 0) { // removing
    for (let i = fromIdx; i < len; i++) {
      const next = verificationStatus.get(`${tier}:${i + 1}`);
      next ? verificationStatus.set(`${tier}:${i}`, next) : verificationStatus.delete(`${tier}:${i}`);
    }
    verificationStatus.delete(`${tier}:${len - 1}`);
  } else { // inserting at fromIdx
    for (let i = len - 1; i >= fromIdx; i--) {
      const s = verificationStatus.get(`${tier}:${i}`);
      s ? verificationStatus.set(`${tier}:${i + 1}`, s) : verificationStatus.delete(`${tier}:${i + 1}`);
    }
  }
}

function handleModelEdit(tier, index) {
  const [model, provider] = currentModels[tier][index];
  const row = getListEl(tier).querySelector(`.list-row[data-index="${index}"]`);
  row.replaceWith(createEditingModelItem(model, provider, tier, index));
  getListEl(tier).querySelector('.model-name-input').focus();
}

async function handleModelSave(tier, index) {
  const row = getListEl(tier).querySelector(`.list-row[data-index="${index}"]`);
  const saveBtn = row.querySelector('.save');
  const model = row.querySelector('.model-name-input').value.trim();
  const providers = row.querySelector('.model-provider-input').value.split(',').map(p => p.trim()).filter(Boolean);
  if (!model) { addMessage('system', '✗ Model name is required'); return; }
  const originalHtml = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span>';
  addMessage('system', `Verifying ${model}...`);
  const result = await verifyModel(model, providers);
  const counter = getModelStatsCounter();
  await counter.increment(model, result.valid ? 'success' : 'error');
  saveBtn.disabled = false;
  saveBtn.innerHTML = originalHtml;
  verificationStatus.set(`${tier}:${index}`, { verified: result.valid, error: result.error });
  const opts = result.noToolChoice ? { noToolChoice: true } : undefined;
  currentModels[tier][index] = [model, providers, opts];
  saveModels();
  renderTierModels(tier);
  const msg = result.valid
    ? (result.noToolChoice ? '✓ Model verified (no tool_choice support)' : '✓ Model verified and saved')
    : `✗ Model verification failed: ${result.error}`;
  addMessage('system', msg);
}

function handleModelDelete(tier, index) {
  shiftVerificationStatus(tier, index, -1);
  currentModels[tier].splice(index, 1);
  saveModels();
  renderTierModels(tier);
  addMessage('system', '✓ Model removed');
}

async function handleModelAdd(tier) {
  const listEl = getListEl(tier);
  listEl.innerHTML = '';
  currentModels[tier].push(['', ['']]);
  const index = currentModels[tier].length - 1;
  // Re-render existing models then add editing row
  if (!cachedStats) await refreshStats();
  currentModels[tier].slice(0, -1).forEach(([m, p, opts], i) => listEl.appendChild(createModelItem(m, p, opts, tier, i, cachedStats[m])));
  listEl.appendChild(createEditingModelItem('', [''], tier, index));
  listEl.querySelector('.list-row:last-child .model-name-input').focus();
}

async function handleResetModels() {
  currentModels = getDefaultModels();
  verificationStatus.clear();
  await saveModels();
  await renderAllModels();
  addMessage('system', '✓ Models reset to defaults');
  verifyAllModels();
}

// Drag and Drop
const sortableInstances = [];
const getTierFromListId = id => id.replace('modelList', '').toUpperCase();

function setupDragAndDrop() {
  sortableInstances.forEach(s => s.destroy());
  sortableInstances.length = 0;
  ['High', 'Medium', 'Low'].forEach(tierName => {
    const sortable = Sortable.create(elements[`modelList${tierName}`], {
      group: 'models', handle: '.drag-handle', animation: 150,
      ghostClass: 'opacity-40', chosenClass: 'bg-base-200', dragClass: 'shadow-lg',
      filter: '.model-name-input, .model-provider-input', preventOnFilter: false,
      onEnd: ({ from, to, oldIndex, newIndex }) => {
        const fromTier = getTierFromListId(from.id), toTier = getTierFromListId(to.id);
        if (fromTier === toTier && oldIndex === newIndex) return;
        const movedStatus = verificationStatus.get(`${fromTier}:${oldIndex}`);
        shiftVerificationStatus(fromTier, oldIndex, -1);
        shiftVerificationStatus(toTier, newIndex, 1);
        movedStatus ? verificationStatus.set(`${toTier}:${newIndex}`, movedStatus) : verificationStatus.delete(`${toTier}:${newIndex}`);
        const [movedModel] = currentModels[fromTier].splice(oldIndex, 1);
        currentModels[toTier].splice(newIndex, 0, movedModel);
        saveModels();
        renderAllModels();
      }
    });
    sortableInstances.push(sortable);
  });
}

function setupModelsSection() {
  setupDragAndDrop();
  document.querySelectorAll('.tier-add-btn').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); handleModelAdd(btn.dataset.tier); }));
  elements.resetModelsBtn.addEventListener('click', handleResetModels);

  elements.modelsBody.addEventListener('click', e => {
    const btn = e.target.closest('button'), row = btn?.closest('.list-row');
    if (row) {
      const { tier, index } = row.dataset;
      const handlers = { edit: handleModelEdit, delete: handleModelDelete, save: handleModelSave, cancel: () => renderTierModels(tier) };
      for (const [cls, fn] of Object.entries(handlers)) if (btn.classList.contains(cls)) { fn(tier, +index); return; }
    }
    // Autocomplete selection
    const modelItem = e.target.closest('.model-autocomplete li[data-model-id]');
    const providerItem = e.target.closest('.provider-autocomplete li[data-provider]');
    if (modelItem || providerItem) {
      e.preventDefault();
      const r = (modelItem || providerItem).closest('.list-row');
      const input = r.querySelector(modelItem ? '.model-name-input' : '.model-provider-input');
      input.value = modelItem?.dataset.modelId || providerItem.dataset.provider;
      r.querySelector(modelItem ? '.model-autocomplete' : '.provider-autocomplete').classList.add('hidden');
      input.focus();
    }
  });

  elements.modelsBody.addEventListener('keydown', e => {
    const isModel = e.target.classList.contains('model-name-input'), isProvider = e.target.classList.contains('model-provider-input');
    if (!isModel && !isProvider) return;
    const row = e.target.closest('.list-row'), ac = row?.querySelector(isModel ? '.model-autocomplete' : '.provider-autocomplete');
    if (e.key === 'Enter') {
      const sel = ac?.querySelector('li.bg-base-300');
      if (sel && !ac.classList.contains('hidden')) {
        e.preventDefault();
        e.target.value = isModel ? sel.dataset.modelId : sel.dataset.provider;
        ac.classList.add('hidden');
      } else {
        row.querySelectorAll('.model-autocomplete, .provider-autocomplete').forEach(el => el.classList.add('hidden'));
        handleModelSave(row.dataset.tier, +row.dataset.index);
      }
    } else if (e.key === 'Escape') {
      const open = [...row.querySelectorAll('.model-autocomplete, .provider-autocomplete')].find(el => !el.classList.contains('hidden'));
      open ? open.classList.add('hidden') : renderTierModels(row.dataset.tier);
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && ac && !ac.classList.contains('hidden')) {
      e.preventDefault();
      const items = [...ac.querySelectorAll('li')], idx = items.indexOf(ac.querySelector('li.bg-base-300'));
      const next = Math.max(0, Math.min(items.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
      items.forEach(i => i.classList.remove('bg-base-300'));
      items[next]?.classList.add('bg-base-300');
      items[next]?.scrollIntoView({ block: 'nearest' });
    }
  });

  elements.modelsBody.addEventListener('input', e => {
    const row = e.target.closest('.list-row');
    if (!row) return;
    if (e.target.classList.contains('model-name-input')) updateModelAutocomplete(e.target, row.querySelector('.model-autocomplete'));
    else if (e.target.classList.contains('model-provider-input')) updateProviderAutocomplete(e.target, row.querySelector('.provider-autocomplete'), row.querySelector('.model-name-input'));
  });

  elements.modelsBody.addEventListener('focusin', e => {
    const row = e.target.closest('.list-row');
    if (!row) return;
    if (e.target.classList.contains('model-name-input') && availableModels.length) updateModelAutocomplete(e.target, row.querySelector('.model-autocomplete'));
    else if (e.target.classList.contains('model-provider-input') && availableProviders.length) updateProviderAutocomplete(e.target, row.querySelector('.provider-autocomplete'), row.querySelector('.model-name-input'));
  });

  elements.modelsBody.addEventListener('focusout', e => {
    const isModel = e.target.classList.contains('model-name-input'), isProvider = e.target.classList.contains('model-provider-input');
    if (isModel || isProvider) setTimeout(() => e.target.closest('.list-row')?.querySelector(isModel ? '.model-autocomplete' : '.provider-autocomplete')?.classList.add('hidden'), 200);
  });
}

// Main Setup
export async function initSettings() {
  const { openrouterApiKey, openrouterApiKeyValid } = await storage.get(['openrouterApiKey', 'openrouterApiKeyValid']);
  if (openrouterApiKey) {
    elements.openrouterApiKey.value = openrouterApiKey;
    updateApiKeyStatus(openrouterApiKeyValid);
    await setApiKey(openrouterApiKey);
  }
  currentModels = await getModels();
  await renderAllModels();
  if (!openrouterApiKeyValid) toggleSettings(true);
  updateHeaderTitle();

  elements.settingsToggle.addEventListener('click', () => toggleSettings(elements.settingsPanel.classList.contains('hidden')));
  elements.openrouterApiKey.addEventListener('change', async () => {
    const key = elements.openrouterApiKey.value.trim();
    if (!key) { await storage.remove(['openrouterApiKey', 'openrouterApiKeyValid']); updateApiKeyStatus(false); updateHeaderTitle(); return; }
    await verifyApiKey(key);
  });
  setupModelsSection();

  fetchAvailableModels().then(m => availableModels = m);
  if (openrouterApiKeyValid) {
    fetchAvailableProviders().then(p => availableProviders = p);
    verifyAllModels();
  }
  return openrouterApiKeyValid;
}
