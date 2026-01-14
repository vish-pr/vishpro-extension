import { ContentAction } from './content-actions.js';

async function getTabUrl(tabId, fallback = 'unknown') {
  if (!tabId) return fallback;
  try {
    return (await chrome.tabs.get(tabId)).url || fallback;
  } catch (e) {
    console.warn('Failed to get tab URL:', e.message);
    return fallback;
  }
}

class BrowserState {
  constructor() {
    this.tabs = new Map();
    this.currentTabId = null;
    this.currentTabUrl = null;
    this._readyPromise = null;
    this._initTabListeners();
  }

  ready() { return this._readyPromise || Promise.resolve(); }

  _initTabListeners() {
    chrome.tabs.onActivated.addListener(async ({ tabId }) => {
      this.currentTabId = tabId;
      try {
        const tab = await chrome.tabs.get(tabId);
        this.currentTabUrl = tab.url;
        this.registerTab(tabId, tab.url);
        const tabState = this.tabs.get(tabId);
        if (tabState) tabState.lastActivatedAt = new Date().toISOString();
      } catch (e) {
        console.warn('Failed to get tab info on activation:', e.message);
      }
    });
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (tabId === this.currentTabId && changeInfo.url) {
        this.currentTabUrl = changeInfo.url;
        this.registerTab(tabId, changeInfo.url);
      }
    });
    this._initCurrentTab();
  }

  _initCurrentTab() {
    this._readyPromise = (async () => {
      try {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) [tab] = await chrome.tabs.query({ active: true });
        if (tab) {
          this.currentTabId = tab.id;
          this.currentTabUrl = tab.url;
          this.registerTab(tab.id, tab.url);
        }
      } catch (e) {
        console.warn('Failed to initialize current tab:', e.message);
      }
    })();
  }

  registerTab(tabId, url) {
    const now = new Date().toISOString();
    if (!this.tabs.has(tabId)) {
      this.tabs.set(tabId, { tabId, currentUrl: url, urlHistory: [{ url, timestamp: now }], pageContents: [], lastActivatedAt: now });
    } else {
      const tab = this.tabs.get(tabId);
      if (tab.currentUrl !== url) {
        tab.currentUrl = url;
        tab.urlHistory.push({ url, timestamp: now });
      }
    }
    return this.tabs.get(tabId);
  }

  addPageContent(tabId, url, content) {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Tab ${tabId} not registered`);
    if (!content || typeof content !== 'object') throw new Error('Content must be a valid object');

    const existing = tab.pageContents.findIndex(pc => pc.url === url && pc.status === 'current');
    if (existing !== -1) {
      tab.pageContents[existing].status = 'updated';
      tab.pageContents[existing].updatedTo = new Date().toISOString();
    }

    const newContent = {
      url, timestamp: new Date().toISOString(), status: 'current',
      content: { title: content.title || '', text: content.text || '', buttons: content.buttons || [], links: content.links || [], inputs: content.inputs || [] }
    };
    tab.pageContents.push(newContent);
    return newContent;
  }

  removeTab(tabId) { return this.tabs.delete(tabId); }

  formatForChat() {
    const lines = ['=== BROWSER STATE ==='];
    const currentTab = this.tabs.get(this.currentTabId);

    // Current tab with last 2 history entries
    lines.push(`Current Tab: ${this.currentTabId} - ${this.currentTabUrl || 'unknown'}`);
    if (currentTab && currentTab.urlHistory.length > 1) {
      lines.push('History:');
      const history = currentTab.urlHistory.slice(-3, -1).reverse();
      history.forEach((e, i) => lines.push(`  ${i + 1}. ${e.url} (${e.timestamp})`));
    }

    // Other tabs sorted by lastActivatedAt, capped at 10
    const otherTabs = [...this.tabs.entries()]
      .filter(([tabId]) => tabId !== this.currentTabId)
      .sort((a, b) => (b[1].lastActivatedAt || '').localeCompare(a[1].lastActivatedAt || ''))
      .slice(0, 10);

    if (otherTabs.length > 0) {
      lines.push('');
      lines.push('Other Tabs (by recent activity):');
      otherTabs.forEach(([tabId, tab], i) => lines.push(`  ${i + 1}. ${tabId} - ${tab.currentUrl}`));
    }

    return lines.join('\n');
  }

  toJSON() {
    const json = { tabs: {} };
    for (const [tabId, tab] of this.tabs) json.tabs[tabId] = tab;
    return json;
  }

  fromJSON(json) {
    this.tabs.clear();
    if (json.tabs) Object.entries(json.tabs).forEach(([id, tab]) => this.tabs.set(+id, tab));
  }

  clear() { this.tabs.clear(); }

  async executeContentScript(tabId, action, params = {}) {
    try {
      await chrome.tabs.get(tabId);
    } catch { throw new Error('Tab no longer exists'); }
    try {
      return await chrome.tabs.sendMessage(tabId, { action, ...params });
    } catch (error) {
      if (error.message.includes('Could not establish connection') || error.message.includes('Receiving end does not exist')) {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        return await chrome.tabs.sendMessage(tabId, { action, ...params });
      }
      throw error;
    }
  }

  async extractAndStoreContent(tabId) {
    const pageUrl = await getTabUrl(tabId);
    this.registerTab(tabId, pageUrl);
    const content = await this.executeContentScript(tabId, ContentAction.EXTRACT_CONTENT);
    if (!content || typeof content !== 'object') throw new Error('Failed to extract valid content from page');
    this.addPageContent(tabId, pageUrl, content);
    return {
      extracted: true, page_url: pageUrl, tabId,
      title: content.title || 'N/A',
      text: content.text || '',
      links: content.links || [],
      buttons: content.buttons || [],
      inputs: content.inputs || []
    };
  }

  async clickElement(tabId, elementId, modifiers = {}) {
    return this.executeContentScript(tabId, ContentAction.CLICK_ELEMENT, { elementId, modifiers });
  }

  async fillForm(tabId, fields, submit = false, submitElementId) {
    return this.executeContentScript(tabId, ContentAction.FILL_FORM, { fields, submit, submitElementId });
  }

  async scrollAndWait(tabId, direction, pixels = 500, waitMs = 500) {
    return this.executeContentScript(tabId, ContentAction.SCROLL_AND_WAIT, { direction, pixels, waitMs });
  }

  async navigateTo(tabId, url) {
    const validatedUrl = url.match(/^https?:\/\//) ? url : 'https://' + url;
    await chrome.tabs.update(tabId, { url: validatedUrl });
    await new Promise(r => setTimeout(r, 500));
    this.registerTab(tabId, validatedUrl);
    return { navigated: true, new_url: validatedUrl };
  }

  async goBack(tabId) {
    await chrome.tabs.goBack(tabId);
    await new Promise(r => setTimeout(r, 500));
    const tab = await chrome.tabs.get(tabId);
    if (tab?.url) this.registerTab(tabId, tab.url);
    return { navigated: true, direction: 'back' };
  }

  async goForward(tabId) {
    await chrome.tabs.goForward(tabId);
    await new Promise(r => setTimeout(r, 500));
    const tab = await chrome.tabs.get(tabId);
    if (tab?.url) this.registerTab(tabId, tab.url);
    return { navigated: true, direction: 'forward' };
  }
}

let browserStateInstance = null;
export function getBrowserState() {
  if (!browserStateInstance) browserStateInstance = new BrowserState();
  return browserStateInstance;
}

export async function getBrowserStateBundle() {
  const state = getBrowserState();
  await state.ready();
  return state.formatForChat();
}
