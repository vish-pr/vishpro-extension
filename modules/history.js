// History Management
import { elements } from './dom.js';
import { getExtractions, getAllExtractions, getActionHistory } from './storage.js';
import { renderExtractionItem, renderExtractionDetail, renderActionHistoryItem, renderNoData } from './renderer.js';

const TABS = {
  CURRENT: 'current',
  HISTORY: 'history',
  ACTIONS: 'actions'
};

export function switchToTab(tabName) {
  elements.extractionTabs.forEach(tab => {
    tab.classList.toggle('tab-active', tab.dataset.tab === tabName);
  });
}

function showTabContent(tabName) {
  elements.currentTabContent.classList.toggle('hidden', tabName !== TABS.CURRENT);
  elements.historyTabContent.classList.toggle('hidden', tabName !== TABS.HISTORY);
  elements.actionsTabContent.classList.toggle('hidden', tabName !== TABS.ACTIONS);
}

async function loadCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const extractions = await getExtractions();
  const pageExtractions = extractions[tab.url] || [];

  if (pageExtractions.length === 0) {
    elements.currentTabExtractionContent.innerHTML = renderNoData('No extractions yet for this page.<br>Click "Extract Content" to get started.');
    return;
  }

  elements.currentTabExtractionContent.innerHTML = renderExtractionDetail(pageExtractions[0]);
}

async function loadHistory() {
  const allExtractions = await getAllExtractions();

  if (allExtractions.length === 0) {
    elements.historyTabContent.innerHTML = renderNoData('No extraction history yet.');
    return;
  }

  elements.historyTabContent.innerHTML = allExtractions.map(renderExtractionItem).join('');
  attachHistoryItemListeners();
}

async function loadActions() {
  const history = await getActionHistory();

  if (history.length === 0) {
    elements.actionsTabContent.innerHTML = renderNoData('No actions logged yet.');
    return;
  }

  elements.actionsTabContent.innerHTML = history.map(renderActionHistoryItem).join('');
}

export async function loadTabContent(tabName) {
  showTabContent(tabName);

  switch (tabName) {
    case TABS.CURRENT:
      await loadCurrentPage();
      break;
    case TABS.HISTORY:
      await loadHistory();
      break;
    case TABS.ACTIONS:
      await loadActions();
      break;
  }
}

async function showExtractionDetail(url, timestamp) {
  const extractions = await getExtractions();
  const extraction = extractions[url]?.find(e => e.timestamp === timestamp);

  if (extraction) {
    switchToTab(TABS.CURRENT);
    elements.currentTabExtractionContent.innerHTML = renderExtractionDetail(extraction);
    showTabContent(TABS.CURRENT);
  }
}

function attachHistoryItemListeners() {
  elements.historyTabContent.querySelectorAll('.card').forEach(item => {
    item.addEventListener('click', () => {
      showExtractionDetail(item.dataset.url, item.dataset.timestamp);
    });
  });
}

function setupHistoryToggle() {
  elements.historyToggle.addEventListener('click', async () => {
    const isOpen = !elements.extractionPanel.classList.contains('hidden');
    elements.extractionPanel.classList.toggle('hidden', isOpen);
    elements.historyToggle.classList.toggle('btn-active', !isOpen);

    // Close settings panel when opening extraction panel
    if (!isOpen) {
      elements.settingsPanel.classList.add('hidden');
      elements.settingsToggle.classList.remove('btn-active');

      const activeTab = document.querySelector('[role="tablist"] .tab.tab-active')?.dataset.tab || 'current';
      await loadTabContent(activeTab);
    }
  });
}

function setupTabSwitching() {
  elements.extractionTabs.forEach(tab => {
    tab.addEventListener('click', async () => {
      switchToTab(tab.dataset.tab);
      await loadTabContent(tab.dataset.tab);
    });
  });
}

export function initHistory() {
  setupHistoryToggle();
  setupTabSwitching();
}
