// History Management
import { elements } from './dom.js';
import { getExtractions, getAllExtractions, getActionHistory } from './storage.js';
import { createExtractionItem, createExtractionDetail, createActionItem } from './renderer.js';
import { renderModelStats } from './ui-settings.js';

const noData = msg => `<div class="h-full flex items-center justify-center text-center opacity-50 text-sm">${msg}</div>`;

const TABS = {
  CURRENT: 'current',
  HISTORY: 'history',
  ACTIONS: 'actions',
  STATS: 'stats'
};

export function switchToTab(tabName) {
  elements.extractionTabs.forEach(tab => {
    tab.classList.toggle('tab-active', tab.dataset.tab === tabName);
  });
}

function showTabContent(tabName) {
  elements.currentTabContent?.classList.toggle('hidden', tabName !== TABS.CURRENT);
  elements.historyTabContent?.classList.toggle('hidden', tabName !== TABS.HISTORY);
  elements.actionsTabContent?.classList.toggle('hidden', tabName !== TABS.ACTIONS);
  elements.statsTabContent?.classList.toggle('hidden', tabName !== TABS.STATS);
}

async function loadCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const extractions = await getExtractions();
  const pageExtractions = extractions[tab.url] || [];
  const container = elements.currentTabExtractionContent;

  if (!pageExtractions.length) {
    container.innerHTML = noData('No extractions yet.<br>Click "Extract" to get started.');
    return;
  }
  container.innerHTML = '';
  container.appendChild(createExtractionDetail(pageExtractions[0]));
}

async function loadHistory() {
  const allExtractions = await getAllExtractions();
  const container = elements.historyTabContent;

  if (!allExtractions.length) {
    container.innerHTML = noData('No extraction history yet.');
    return;
  }
  container.innerHTML = '';
  allExtractions.forEach(e => {
    const item = createExtractionItem(e);
    item.addEventListener('click', () => showExtractionDetail(e.url, e.timestamp));
    container.appendChild(item);
  });
}

async function loadActions() {
  const history = await getActionHistory();
  const container = elements.actionsTabContent;

  if (!history.length) {
    container.innerHTML = noData('No actions logged yet.');
    return;
  }
  container.innerHTML = '';
  history.forEach(a => container.appendChild(createActionItem(a)));
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
    case TABS.STATS:
      await renderModelStats();
      break;
  }
}

async function showExtractionDetail(url, timestamp) {
  const extractions = await getExtractions();
  const extraction = extractions[url]?.find(e => e.timestamp === timestamp);
  if (!extraction) return;

  switchToTab(TABS.CURRENT);
  const container = elements.currentTabExtractionContent;
  container.innerHTML = '';
  container.appendChild(createExtractionDetail(extraction));
  showTabContent(TABS.CURRENT);
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

      const activeTab = document.querySelector('#extractionPanel [role="tablist"] .tab.tab-active')?.dataset.tab || 'current';
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
