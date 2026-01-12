// Settings Management
import { elements } from './dom.js';
import * as storage from './storage.js';
import { addMessage } from './chat.js';
import { setApiKey, getModels, setModels, getDefaultModels, fetchAvailableModels, fetchAvailableProviders, verifyModel } from './llm.js';
import Sortable from 'sortablejs';

let availableModels = [], availableProviders = [], currentModels = null;
const verificationStatus = new Map();
const TIERS = ['HIGH', 'MEDIUM', 'LOW'];
const STATUS = {
  VALID: { inputClass: 'input-success', textClass: 'text-success', icon: '✓' },
  INVALID: { inputClass: 'input-error', textClass: 'text-error', icon: '✗' },
  VERIFYING: { inputClass: 'input-warning', textClass: 'text-warning', icon: '⏳' }
};
const ICONS = {
  drag: `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="7" r="1.5"/><circle cx="8" cy="7" r="1.5"/><circle cx="2" cy="12" r="1.5"/><circle cx="8" cy="12" r="1.5"/></svg>`,
  edit: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  delete: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
  check: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>`
};

async function verifyAllModels() {
  const tasks = [];
  for (const tier of TIERS) {
    for (let i = 0; i < (currentModels[tier]?.length || 0); i++) {
      const [model, providers] = currentModels[tier][i];
      const key = `${tier}:${i}`;
      if (!model || verificationStatus.has(key)) continue;
      tasks.push(verifyModel(model, providers || []).then(result => {
        verificationStatus.set(key, { verified: result.valid, error: result.error });
        renderTierModels(tier);
      }));
    }
  }
  await Promise.all(tasks);
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
function renderModelItem(model, provider, tier, index) {
  const providers = Array.isArray(provider) ? provider.filter(Boolean) : [];
  const providerDisplay = providers.length
    ? providers.map(p => `<span class="badge badge-ghost badge-xs">${p}</span>`).join(' ')
    : '<span class="text-[10px] opacity-40">auto routing</span>';
  const status = verificationStatus.get(`${tier}:${index}`);
  const statusIndicator = status?.verified === true
    ? `<div class="tooltip tooltip-right" data-tip="Verified"><div class="status status-success animate-pulse"></div></div>`
    : status?.verified === false
      ? `<div class="tooltip tooltip-right tooltip-error" data-tip="${(status.error || 'Unknown error').replace(/"/g, '&quot;')}"><div class="status status-error"></div></div>`
      : '';
  return `<li class="list-row items-center transition-all duration-200" data-tier="${tier}" data-index="${index}">
    <div class="drag-handle cursor-grab opacity-40 hover:opacity-100 transition-opacity">${ICONS.drag}</div>
    ${statusIndicator}
    <div class="list-col-grow min-w-0">
      <div class="text-xs font-mono truncate">${model}</div>
      <div class="flex gap-1 mt-0.5">${providerDisplay}</div>
    </div>
    <button class="btn btn-ghost btn-xs btn-square edit" title="Edit">${ICONS.edit}</button>
    <button class="btn btn-ghost btn-xs btn-square delete hover:btn-error" title="Remove">${ICONS.delete}</button>
  </li>`;
}

function renderEditingModelItem(model, provider, tier, index) {
  const providerStr = Array.isArray(provider) ? provider.filter(Boolean).join(', ') : '';
  const dropdownCls = 'dropdown-content flex flex-col bg-base-200 rounded-box z-50 w-full max-h-48 overflow-y-auto shadow-lg border border-base-content/10 p-1 hidden';
  return `<li class="list-row items-center bg-base-200" data-tier="${tier}" data-index="${index}">
    <div class="w-[10px]"></div>
    <div class="list-col-grow min-w-0 space-y-1">
      <div class="dropdown dropdown-bottom dropdown-open w-full">
        <input type="text" class="model-name-input input input-xs input-bordered w-full font-mono" value="${model}" placeholder="model/name" autocomplete="off">
        <ul class="model-autocomplete ${dropdownCls}"></ul>
      </div>
      <div class="flex items-center gap-1">
        <span class="text-[10px] opacity-50">via</span>
        <div class="dropdown dropdown-bottom dropdown-end dropdown-open flex-1">
          <input type="text" class="model-provider-input input input-xs input-bordered w-full" value="${providerStr}" placeholder="provider (optional)" autocomplete="off">
          <ul class="provider-autocomplete ${dropdownCls}"></ul>
        </div>
      </div>
    </div>
    <button class="btn btn-ghost btn-xs btn-square save hover:btn-success" title="Save">${ICONS.check}</button>
    <button class="btn btn-ghost btn-xs btn-square cancel" title="Cancel">${ICONS.delete}</button>
  </li>`;
}

function updateAutocomplete(input, el, items, key, dataAttr) {
  const q = input.value.toLowerCase().trim();
  const matches = q
    ? items.filter(m => m[key].toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    : [...items].sort((a, b) => a[key].localeCompare(b[key]));
  if (!matches.length) { el.classList.add('hidden'); return; }
  el.innerHTML = matches.map(m => `<li class="px-2 py-1.5 rounded cursor-pointer hover:bg-base-300 transition-colors text-xs" data-${dataAttr}="${m[key]}">
    <div class="font-mono truncate">${m[key]}</div><div class="opacity-50 text-[10px] truncate">${m.name}</div>
  </li>`).join('');
  el.classList.remove('hidden');
}

function updateModelAutocomplete(input, el) { updateAutocomplete(input, el, availableModels, 'id', 'model-id'); }

function updateProviderAutocomplete(input, el, modelInput) {
  const modelId = modelInput?.value.trim();
  if (!modelId || !availableModels.some(m => m.id === modelId)) { el.classList.add('hidden'); return; }
  updateAutocomplete(input, el, availableProviders, 'slug', 'provider');
}

const getListEl = tier => elements[`modelList${tier.charAt(0) + tier.slice(1).toLowerCase()}`];

function renderTierModels(tier) {
  const models = currentModels[tier] || [];
  getListEl(tier).innerHTML = models.length
    ? models.map(([m, p], i) => renderModelItem(m, p, tier, i)).join('')
    : '<li class="text-center text-xs opacity-50 py-4">No models configured</li>';
}

function renderAllModels() { TIERS.forEach(renderTierModels); }

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
  row.outerHTML = renderEditingModelItem(model, provider, tier, index);
  getListEl(tier).querySelector('.model-name-input').focus();
}

async function handleModelSave(tier, index) {
  const row = getListEl(tier).querySelector(`.list-row[data-index="${index}"]`);
  const saveBtn = row.querySelector('.save');
  const model = row.querySelector('.model-name-input').value.trim();
  const providers = row.querySelector('.model-provider-input').value.split(',').map(p => p.trim()).filter(Boolean);
  if (!model) { addMessage('system', '✗ Model name is required'); return; }
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span>';
  addMessage('system', `Verifying ${model}...`);
  const result = await verifyModel(model, providers);
  saveBtn.disabled = false;
  saveBtn.innerHTML = ICONS.check;
  verificationStatus.set(`${tier}:${index}`, { verified: result.valid, error: result.error });
  currentModels[tier][index] = [model, providers];
  saveModels();
  renderTierModels(tier);
  addMessage('system', result.valid ? '✓ Model verified and saved' : `✗ Model verification failed: ${result.error}`);
}

function handleModelDelete(tier, index) {
  shiftVerificationStatus(tier, index, -1);
  currentModels[tier].splice(index, 1);
  saveModels();
  renderTierModels(tier);
  addMessage('system', '✓ Model removed');
}

function handleModelAdd(tier) {
  const listEl = getListEl(tier);
  listEl.querySelector('.empty-tier')?.remove();
  currentModels[tier].push(['', ['']]);
  const index = currentModels[tier].length - 1;
  listEl.insertAdjacentHTML('beforeend', renderEditingModelItem('', [''], tier, index));
  listEl.querySelector('.list-row:last-child .model-name-input').focus();
}

async function handleResetModels() {
  currentModels = getDefaultModels();
  verificationStatus.clear();
  await saveModels();
  renderAllModels();
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
  renderAllModels();
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
