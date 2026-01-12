// Settings Management
import { elements } from './dom.js';
import * as storage from './storage.js';
import { addMessage } from './chat.js';
import { setApiKey, getModels, setModels, getDefaultModels } from './llm.js';

const STATUS = {
  VALID: { class: 'valid', icon: '✓', color: '#34c759' },
  INVALID: { class: 'invalid', icon: '✗', color: '#ff453a' },
  VERIFYING: { class: 'verifying', icon: '⏳', color: '#ff9f0a' }
};

let currentModels = null;

function updateApiKeyStatus(status) {
  const input = elements.openrouterApiKey;
  const statusEl = elements.openrouterApiKeyStatus;

  input.classList.remove('valid', 'invalid', 'verifying');

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
  elements.settingsToggle.classList.toggle('active', show);
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
  const providerTags = provider.map(p => `<span class="provider-tag">${p}</span>`).join('');

  return `
    <div class="model-row" data-tier="${tier}" data-index="${index}">
      <div class="drag-handle" draggable="true">
        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
          <circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/>
          <circle cx="2" cy="7" r="1.5"/><circle cx="8" cy="7" r="1.5"/>
          <circle cx="2" cy="12" r="1.5"/><circle cx="8" cy="12" r="1.5"/>
        </svg>
      </div>
      <div class="model-item">
        <div class="model-info">
          <div class="model-name">${model}</div>
          <div class="model-provider">${providerTags}</div>
        </div>
        <div class="model-actions">
          <button class="model-btn edit" title="Edit">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="model-btn delete" title="Remove">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderEditingModelItem(model, provider, tier, index) {
  const providerStr = provider.join(', ');

  return `
    <div class="model-row" data-tier="${tier}" data-index="${index}">
      <div class="drag-handle-placeholder" style="width: 20px;"></div>
      <div class="model-item editing">
        <div class="model-info">
          <input type="text" class="model-name-input" value="${model}" placeholder="model/name">
          <div class="model-provider">
            <span style="color: var(--text-tertiary);">via</span>
            <input type="text" class="model-provider-input" value="${providerStr}" placeholder="provider">
          </div>
        </div>
        <div class="model-actions">
          <button class="model-btn save" title="Save">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </button>
          <button class="model-btn cancel" title="Cancel">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderTierModels(tier) {
  const listEl = elements[`modelList${tier.charAt(0) + tier.slice(1).toLowerCase()}`];
  const models = currentModels[tier] || [];

  if (models.length === 0) {
    listEl.innerHTML = '<div class="empty-tier">No models configured</div>';
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
  const row = listEl.querySelector(`.model-row[data-index="${index}"]`);

  row.outerHTML = renderEditingModelItem(model, provider, tier, index);
  listEl.querySelector('.model-name-input').focus();
}

function handleModelSave(tier, index) {
  const listEl = elements[`modelList${tier.charAt(0) + tier.slice(1).toLowerCase()}`];
  const row = listEl.querySelector(`.model-row[data-index="${index}"]`);
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
  listEl.querySelector('.model-row:last-child .model-name-input').focus();
}

async function handleResetModels() {
  currentModels = getDefaultModels();
  await saveModels();
  renderAllModels();
  addMessage('system', '✓ Models reset to defaults');
}

// ============================================
// Drag and Drop with Live Reordering
// ============================================

let dragState = null;

function getAllRows() {
  return Array.from(elements.modelsBody.querySelectorAll('.model-row'));
}

function getRowsInTier(tier) {
  const listEl = elements[`modelList${tier.charAt(0) + tier.slice(1).toLowerCase()}`];
  return Array.from(listEl.querySelectorAll('.model-row'));
}

function clearDragClasses() {
  getAllRows().forEach(row => {
    row.classList.remove('dragging', 'drag-above', 'drag-below');
  });
  document.querySelectorAll('.model-list').forEach(list => {
    list.classList.remove('drag-over-empty');
  });
}

function handleDragStart(e) {
  const handle = e.target.closest('.drag-handle');
  if (!handle) {
    e.preventDefault();
    return;
  }

  const row = handle.closest('.model-row');
  if (!row || row.querySelector('.model-item.editing')) {
    e.preventDefault();
    return;
  }

  dragState = {
    row,
    tier: row.dataset.tier,
    index: parseInt(row.dataset.index, 10),
    currentTier: row.dataset.tier,
    currentIndex: parseInt(row.dataset.index, 10)
  };

  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');

  // Create ghost image
  const ghost = row.cloneNode(true);
  ghost.style.position = 'absolute';
  ghost.style.top = '-1000px';
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 20, 20);
  setTimeout(() => ghost.remove(), 0);
}

function handleDragOver(e) {
  if (!dragState) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const targetRow = e.target.closest('.model-row');
  const targetList = e.target.closest('.model-list');

  if (!targetList) return;

  const targetTier = targetList.id.replace('modelList', '').toUpperCase();
  const rowsInTier = getRowsInTier(targetTier);
  const isEmpty = rowsInTier.length === 0 || (rowsInTier.length === 1 && rowsInTier[0] === dragState.row);

  // Clear all visual states first
  clearDragClasses();
  dragState.row.classList.add('dragging');

  if (isEmpty || !targetRow) {
    // Dropping into empty tier or at end
    targetList.classList.add('drag-over-empty');
    dragState.currentTier = targetTier;
    dragState.currentIndex = currentModels[targetTier].length;
    if (dragState.tier === targetTier) {
      dragState.currentIndex = currentModels[targetTier].length - 1;
    }
    return;
  }

  if (targetRow === dragState.row) return;

  const targetIndex = parseInt(targetRow.dataset.index, 10);
  const targetRect = targetRow.getBoundingClientRect();
  const midY = targetRect.top + targetRect.height / 2;
  const insertBefore = e.clientY < midY;

  // Calculate visual displacement for all items
  const sameTier = dragState.tier === targetTier;
  const dragIdx = dragState.index;

  rowsInTier.forEach(row => {
    if (row === dragState.row) return;

    const idx = parseInt(row.dataset.index, 10);

    if (sameTier) {
      // Same tier reordering
      if (insertBefore) {
        if (dragIdx < targetIndex) {
          // Dragging down, insert before target
          if (idx > dragIdx && idx < targetIndex) row.classList.add('drag-above');
          else if (idx === targetIndex) row.classList.add('drag-above');
        } else {
          // Dragging up
          if (idx >= targetIndex && idx < dragIdx) row.classList.add('drag-below');
        }
      } else {
        if (dragIdx < targetIndex) {
          // Dragging down, insert after target
          if (idx > dragIdx && idx <= targetIndex) row.classList.add('drag-above');
        } else {
          // Dragging up, insert after target
          if (idx > targetIndex && idx < dragIdx) row.classList.add('drag-below');
        }
      }
    } else {
      // Cross-tier: shift items down from insert point
      if (insertBefore && idx >= targetIndex) row.classList.add('drag-below');
      else if (!insertBefore && idx > targetIndex) row.classList.add('drag-below');
    }
  });

  // Also shift items in source tier if cross-tier
  if (!sameTier) {
    getRowsInTier(dragState.tier).forEach(row => {
      if (row === dragState.row) return;
      const idx = parseInt(row.dataset.index, 10);
      if (idx > dragIdx) row.classList.add('drag-above');
    });
  }

  dragState.currentTier = targetTier;
  dragState.currentIndex = insertBefore ? targetIndex : targetIndex + 1;
  if (sameTier && dragIdx < dragState.currentIndex) {
    dragState.currentIndex--;
  }
}

function handleDragEnd() {
  if (!dragState) return;

  // Commit the move if position changed
  const moved = dragState.tier !== dragState.currentTier ||
                dragState.index !== dragState.currentIndex;

  if (moved) {
    const [movedModel] = currentModels[dragState.tier].splice(dragState.index, 1);

    // Adjust index if moving within same tier
    let insertIdx = dragState.currentIndex;
    if (dragState.tier === dragState.currentTier && dragState.index < insertIdx) {
      // Already adjusted in dragover
    }

    currentModels[dragState.currentTier].splice(insertIdx, 0, movedModel);
    saveModels();
  }

  clearDragClasses();
  renderAllModels();
  dragState = null;
}

function handleDragLeave(e) {
  const list = e.target.closest('.model-list');
  if (list && !list.contains(e.relatedTarget)) {
    list.classList.remove('drag-over-empty');
  }
}

function setupDragAndDrop() {
  const modelsBody = elements.modelsBody;

  modelsBody.addEventListener('dragstart', handleDragStart);
  modelsBody.addEventListener('dragover', handleDragOver);
  modelsBody.addEventListener('dragleave', handleDragLeave);
  modelsBody.addEventListener('dragend', handleDragEnd);
  modelsBody.addEventListener('drop', (e) => {
    e.preventDefault();
    handleDragEnd();
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
    const btn = e.target.closest('.model-btn');
    if (!btn) return;

    const row = btn.closest('.model-row');
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
      const row = e.target.closest('.model-row');
      handleModelSave(row.dataset.tier, parseInt(row.dataset.index, 10));
    } else if (e.key === 'Escape') {
      const row = e.target.closest('.model-row');
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
    const isHidden = elements.settingsPanel.classList.contains('hidden');
    toggleSettings(isHidden);
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
