// Settings Management
import { elements } from './dom.js';
import * as storage from './storage.js';
import { addMessage } from './chat.js';
import { setApiKey, getModels, setModels, getDefaultModels } from './llm.js';
import Sortable from 'sortablejs';

const STATUS = {
  VALID: { class: 'input-success', icon: '✓', color: 'oklch(0.7 0.2 145)' },
  INVALID: { class: 'input-error', icon: '✗', color: 'oklch(0.65 0.25 25)' },
  VERIFYING: { class: 'input-warning', icon: '⏳', color: 'oklch(0.75 0.18 85)' }
};

let currentModels = null;

function updateApiKeyStatus(status) {
  const input = elements.openrouterApiKey;
  const statusEl = elements.openrouterApiKeyStatus;

  input.classList.remove('input-success', 'input-error', 'input-warning');

  if (status === true) status = STATUS.VALID;
  else if (status === false) status = STATUS.INVALID;
  else if (status === 'verifying') status = STATUS.VERIFYING;
  else {
    statusEl.textContent = '';
    return;
  }

  input.classList.add(status.class);
  statusEl.textContent = status.icon;
  statusEl.style.color = status.color;
}

function updateHeaderTitle() {
  storage.get(['openrouterApiKeyValid']).then(({ openrouterApiKeyValid }) => {
    const isVerified = openrouterApiKeyValid;
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');

    if (statusDot) {
      statusDot.classList.toggle('active', isVerified);
    }
    if (statusText && !isVerified) {
      statusText.textContent = 'No API Key';
    } else if (statusText) {
      statusText.textContent = 'Ready';
    }
  });
}

function toggleSettings(show) {
  elements.settingsPanel.classList.toggle('hidden', !show);
  elements.settingsToggle.classList.toggle('btn-active', show);

  // Close extraction panel when opening settings
  if (show) {
    elements.extractionPanel.classList.add('hidden');
    elements.historyToggle.classList.remove('btn-active');
  }
}

async function verifyApiKey(apiKey) {
  updateApiKeyStatus('verifying');

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'verifyApiKey',
      apiKey,
      provider: 'openrouter'
    });

    const isValid = response.valid;

    await storage.set({
      openrouterApiKey: apiKey,
      openrouterApiKeyValid: isValid
    });

    await setApiKey(apiKey);

    updateApiKeyStatus(isValid);
    updateHeaderTitle();

    if (isValid) {
      addMessage('system', '✓ OpenRouter API Key verified and saved');
      setTimeout(() => toggleSettings(false), 1000);
    } else {
      addMessage('system', `✗ Invalid OpenRouter API Key: ${response.error || 'Verification failed'}`);
    }
  } catch (error) {
    updateApiKeyStatus(false);
    addMessage('system', `✗ Verification error: ${error.message}`);
  }
}

// ============================================
// Model Configuration
// ============================================

function renderModelItem(model, provider, tier, index) {
  const providerTags = provider.map(p => `<span class="badge badge-ghost badge-xs">${p}</span>`).join(' ');

  return `
    <li class="list-row items-center transition-all duration-200" data-tier="${tier}" data-index="${index}">
      <div class="drag-handle cursor-grab opacity-40 hover:opacity-100 transition-opacity">
        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
          <circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/>
          <circle cx="2" cy="7" r="1.5"/><circle cx="8" cy="7" r="1.5"/>
          <circle cx="2" cy="12" r="1.5"/><circle cx="8" cy="12" r="1.5"/>
        </svg>
      </div>
      <div class="list-col-grow min-w-0">
        <div class="text-xs font-mono truncate">${model}</div>
        <div class="flex gap-1 mt-0.5">${providerTags}</div>
      </div>
      <button class="btn btn-ghost btn-xs btn-square edit" title="Edit">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button class="btn btn-ghost btn-xs btn-square delete hover:btn-error" title="Remove">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </li>
  `;
}

function renderEditingModelItem(model, provider, tier, index) {
  const providerStr = provider.join(', ');

  return `
    <li class="list-row items-center bg-base-200" data-tier="${tier}" data-index="${index}">
      <div class="w-[10px]"></div>
      <div class="list-col-grow min-w-0 space-y-1">
        <input type="text" class="model-name-input input input-xs input-bordered w-full font-mono" value="${model}" placeholder="model/name">
        <div class="flex items-center gap-1">
          <span class="text-[10px] opacity-50">via</span>
          <input type="text" class="model-provider-input input input-xs input-bordered flex-1" value="${providerStr}" placeholder="provider">
        </div>
      </div>
      <button class="btn btn-ghost btn-xs btn-square save hover:btn-success" title="Save">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
      </button>
      <button class="btn btn-ghost btn-xs btn-square cancel" title="Cancel">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </li>
  `;
}

function renderTierModels(tier) {
  const listEl = elements[`modelList${tier.charAt(0) + tier.slice(1).toLowerCase()}`];
  const models = currentModels[tier] || [];

  if (models.length === 0) {
    listEl.innerHTML = '<li class="text-center text-xs opacity-50 py-4">No models configured</li>';
    return;
  }

  listEl.innerHTML = models
    .map(([model, provider], index) => renderModelItem(model, provider, tier, index))
    .join('');
}

function renderAllModels() {
  ['HIGH', 'MEDIUM', 'LOW'].forEach(tier => renderTierModels(tier));
}

async function saveModels() {
  await setModels(currentModels);
}

function handleModelEdit(tier, index) {
  const models = currentModels[tier];
  const [model, provider] = models[index];
  const listEl = elements[`modelList${tier.charAt(0) + tier.slice(1).toLowerCase()}`];
  const row = listEl.querySelector(`.list-row[data-index="${index}"]`);

  row.outerHTML = renderEditingModelItem(model, provider, tier, index);
  listEl.querySelector('.model-name-input').focus();
}

function handleModelSave(tier, index) {
  const listEl = elements[`modelList${tier.charAt(0) + tier.slice(1).toLowerCase()}`];
  const row = listEl.querySelector(`.list-row[data-index="${index}"]`);
  const nameInput = row.querySelector('.model-name-input');
  const providerInput = row.querySelector('.model-provider-input');

  const model = nameInput.value.trim();
  const providers = providerInput.value.split(',').map(p => p.trim()).filter(Boolean);

  if (!model) {
    addMessage('system', '✗ Model name is required');
    return;
  }

  currentModels[tier][index] = [model, providers.length ? providers : ['']];
  saveModels();
  renderTierModels(tier);
  addMessage('system', '✓ Model updated');
}

function handleModelCancel(tier) {
  renderTierModels(tier);
}

function handleModelDelete(tier, index) {
  currentModels[tier].splice(index, 1);
  saveModels();
  renderTierModels(tier);
  addMessage('system', '✓ Model removed');
}

function handleModelAdd(tier) {
  const listEl = elements[`modelList${tier.charAt(0) + tier.slice(1).toLowerCase()}`];

  // Remove empty state if present
  const emptyState = listEl.querySelector('.empty-tier');
  if (emptyState) emptyState.remove();

  // Add new model entry
  currentModels[tier].push(['', ['']]);
  const index = currentModels[tier].length - 1;

  listEl.insertAdjacentHTML('beforeend', renderEditingModelItem('', [''], tier, index));
  listEl.querySelector('.list-row:last-child .model-name-input').focus();
}

async function handleResetModels() {
  currentModels = getDefaultModels();
  await saveModels();
  renderAllModels();
  addMessage('system', '✓ Models reset to defaults');
}

// ============================================
// Drag and Drop with SortableJS
// ============================================

const sortableInstances = [];

function getTierFromListId(id) {
  return id.replace('modelList', '').toUpperCase();
}

function setupDragAndDrop() {
  // Destroy existing instances if any (for re-initialization)
  sortableInstances.forEach(s => s.destroy());
  sortableInstances.length = 0;

  ['High', 'Medium', 'Low'].forEach(tierName => {
    const listEl = elements[`modelList${tierName}`];
    const tier = tierName.toUpperCase();

    const sortable = Sortable.create(listEl, {
      group: 'models',
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'opacity-40',
      chosenClass: 'bg-base-200',
      dragClass: 'shadow-lg',
      filter: '.model-name-input, .model-provider-input', // Prevent drag on inputs
      preventOnFilter: false,

      onEnd: (evt) => {
        const fromTier = getTierFromListId(evt.from.id);
        const toTier = getTierFromListId(evt.to.id);
        const oldIndex = evt.oldIndex;
        const newIndex = evt.newIndex;

        // Skip if no actual move
        if (fromTier === toTier && oldIndex === newIndex) return;

        // Update data model
        const [movedModel] = currentModels[fromTier].splice(oldIndex, 1);
        currentModels[toTier].splice(newIndex, 0, movedModel);

        // Save and re-render to sync data-index attributes
        saveModels();
        renderAllModels();
      }
    });

    sortableInstances.push(sortable);
  });
}

function setupModelsSection() {
  // Setup drag and drop
  setupDragAndDrop();

  // Add model buttons
  document.querySelectorAll('.tier-add-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleModelAdd(btn.dataset.tier);
    });
  });

  // Reset button
  elements.resetModelsBtn.addEventListener('click', handleResetModels);

  // Delegate clicks for model items
  elements.modelsBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const row = btn.closest('.list-row');
    if (!row) return;

    const tier = row.dataset.tier;
    const index = parseInt(row.dataset.index, 10);

    if (btn.classList.contains('edit')) {
      handleModelEdit(tier, index);
    } else if (btn.classList.contains('delete')) {
      handleModelDelete(tier, index);
    } else if (btn.classList.contains('save')) {
      handleModelSave(tier, index);
    } else if (btn.classList.contains('cancel')) {
      handleModelCancel(tier);
    }
  });

  // Handle Enter key in inputs
  elements.modelsBody.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('model-name-input')) {
      const row = e.target.closest('.list-row');
      handleModelSave(row.dataset.tier, parseInt(row.dataset.index, 10));
    } else if (e.key === 'Escape') {
      const row = e.target.closest('.list-row');
      if (row) handleModelCancel(row.dataset.tier);
    }
  });
}

// ============================================
// Main Setup
// ============================================

function setupOpenRouterApiKeyInput() {
  elements.openrouterApiKey.addEventListener('change', async () => {
    const apiKey = elements.openrouterApiKey.value.trim();

    if (!apiKey) {
      await storage.remove(['openrouterApiKey', 'openrouterApiKeyValid']);
      updateApiKeyStatus(false);
      updateHeaderTitle();
      return;
    }

    await verifyApiKey(apiKey);
  });
}

function setupSettingsToggle() {
  elements.settingsToggle.addEventListener('click', () => {
    const isOpen = !elements.settingsPanel.classList.contains('hidden');
    toggleSettings(!isOpen);
  });
}

export async function initSettings() {
  const {
    openrouterApiKey,
    openrouterApiKeyValid
  } = await storage.get([
    'openrouterApiKey',
    'openrouterApiKeyValid'
  ]);

  // Set up OpenRouter API key
  if (openrouterApiKey) {
    elements.openrouterApiKey.value = openrouterApiKey;
    updateApiKeyStatus(openrouterApiKeyValid);
    await setApiKey(openrouterApiKey);
  }

  // Load and render models
  currentModels = await getModels();
  renderAllModels();

  // Show settings if no API key is configured
  if (!openrouterApiKeyValid) {
    toggleSettings(true);
  }

  updateHeaderTitle();

  // Setup event listeners
  setupSettingsToggle();
  setupOpenRouterApiKeyInput();
  setupModelsSection();

  return openrouterApiKeyValid;
}
