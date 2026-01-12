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
    this.expandedTabId = null;
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

  setExpandedTab(tabId) { this.expandedTabId = tabId; }

  registerTab(tabId, url) {
    if (!this.tabs.has(tabId)) {
      this.tabs.set(tabId, { tabId, currentUrl: url, urlHistory: [{ url, timestamp: new Date().toISOString() }], pageContents: [] });
    } else {
      const tab = this.tabs.get(tabId);
      if (tab.currentUrl !== url) {
        tab.currentUrl = url;
        tab.urlHistory.push({ url, timestamp: new Date().toISOString() });
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
    const lines = ['=== BROWSER STATE ===', `Current Tab: ${this.currentTabId} (${this.currentTabUrl || 'unknown'})\n`];
    for (const [tabId, tab] of this.tabs) {
      const isExpanded = tabId === this.expandedTabId;
      lines.push(`Tab ${tabId}${tabId === this.currentTabId ? ' [CURRENT]' : ''}${isExpanded ? ' [EXPANDED]' : ''}:`);
      lines.push(`  Current URL: ${tab.currentUrl}`);
      if (tab.urlHistory.length > 1) {
        lines.push('  URL History:');
        tab.urlHistory.forEach((e, i) => lines.push(`    ${i + 1}. ${e.url} (${e.timestamp})`));
      }
      if (tab.pageContents.length > 0) {
        lines.push('  Page Contents:');
        tab.pageContents.forEach((pc, i) => {
          lines.push(`    ${i + 1}. ${pc.status === 'updated' ? `[UPDATED to ${pc.updatedTo}]` : '[CURRENT]'} ${pc.url}`);
          lines.push(`       Title: ${pc.content.title || 'N/A'}`);
          if (isExpanded && pc.status === 'current') {
            if (pc.content.text) lines.push(`       Text: ${pc.content.text}`);
            if (pc.content.links?.length) {
              lines.push(`       Links (${pc.content.links.length}):`);
              pc.content.links.forEach(l => lines.push(`         [${l.id}]${l.text ? ` "${l.text}"` : ''} -> ${l.href || 'no href'}`));
            }
            if (pc.content.buttons?.length) {
              lines.push(`       Buttons (${pc.content.buttons.length}):`);
              pc.content.buttons.forEach(b => lines.push(`         [${b.id}]${b.text ? ` "${b.text}"` : ''}${b.class ? ` class="${b.class}"` : ''}`));
            }
            if (pc.content.inputs?.length) {
              lines.push(`       Inputs (${pc.content.inputs.length}):`);
              pc.content.inputs.forEach(inp => lines.push(`         [${inp.id}]${inp.type ? ` type="${inp.type}"` : ''}${inp.placeholder ? ` placeholder="${inp.placeholder}"` : ''}`));
            }
            if (pc.content.selects?.length) {
              lines.push(`       Selects (${pc.content.selects.length}):`);
              pc.content.selects.forEach(s => lines.push(`         [${s.id}] ${s.name || 'unnamed'}`));
            }
            if (pc.content.textareas?.length) {
              lines.push(`       Textareas (${pc.content.textareas.length}):`);
              pc.content.textareas.forEach(t => lines.push(`         [${t.id}] ${t.placeholder || 'no placeholder'}`));
            }
          } else {
            if (pc.content.text) lines.push(`       Text: ${pc.content.text.substring(0, 200)}${pc.content.text.length > 200 ? '...' : ''}`);
            if (pc.content.buttons?.length) lines.push(`       Buttons: ${pc.content.buttons.length} buttons`);
            if (pc.content.links?.length) lines.push(`       Links: ${pc.content.links.length} links`);
            if (pc.content.inputs?.length) lines.push(`       Inputs: ${pc.content.inputs.length} form inputs`);
          }
        });
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  toJSON() {
    const json = { tabs: {}, expandedTabId: this.expandedTabId };
    for (const [tabId, tab] of this.tabs) json.tabs[tabId] = tab;
    return json;
  }

  fromJSON(json) {
    this.tabs.clear();
    this.expandedTabId = json.expandedTabId || null;
    if (json.tabs) Object.entries(json.tabs).forEach(([id, tab]) => this.tabs.set(+id, tab));
  }

  clear() { this.tabs.clear(); this.expandedTabId = null; }

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
    this.setExpandedTab(tabId);
    return {
      extracted: true, page_url: pageUrl, tabId,
      summary: { title: content.title || 'N/A', links: content.links?.length || 0, buttons: content.buttons?.length || 0, inputs: content.inputs?.length || 0 },
      note: 'Full page content is available in the BROWSER STATE section above (tab marked as [EXPANDED])'
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
