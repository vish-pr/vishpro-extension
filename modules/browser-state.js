/**
 * Browser State Manager
 * Manages browser tabs, URL history, and page content with versioning
 * Used to maintain conversation context for the chat application
 * Also handles all communication with content scripts
 */

import logger from './logger.js';
import { ContentAction } from './content-actions.js';

/**
 * Get tab URL safely with fallback
 */
async function getTabUrl(tabId, fallback = 'unknown') {
  if (!tabId) return fallback;
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url || fallback;
  } catch {
    return fallback;
  }
}

/**
 * BrowserState class manages the state of all tabs
 * Each tab tracks its URL history and page content snapshots
 */
export class BrowserState {
  constructor() {
    // Main state structure
    this.tabs = new Map();
    // Track which tab should show expanded content in formatForChat()
    this.expandedTabId = null;
    // Current active tab - tracked via Chrome events
    this.currentTabId = null;
    this.currentTabUrl = null;

    // Initialization promise - resolves when current tab is known
    this._readyPromise = null;
    this._isReady = false;

    // Initialize Chrome event listeners
    this._initTabListeners();
  }

  /**
   * Returns a promise that resolves when browser state is initialized
   * @returns {Promise<void>}
   */
  ready() {
    return this._readyPromise || Promise.resolve();
  }

  /**
   * Check if browser state is initialized
   * @returns {boolean}
   */
  isReady() {
    return this._isReady;
  }

  /**
   * Initialize Chrome tab event listeners to track current tab
   */
  _initTabListeners() {
    // Track when user switches tabs
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      this.currentTabId = activeInfo.tabId;
      try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        this.currentTabUrl = tab.url;
        this.registerTab(activeInfo.tabId, tab.url);
        logger.info('Tab activated', { tabId: activeInfo.tabId, url: tab.url });
      } catch (e) {
        logger.warn('Could not get tab info on activation', { tabId: activeInfo.tabId });
      }
    });

    // Track URL changes in current tab
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (tabId === this.currentTabId && changeInfo.url) {
        this.currentTabUrl = changeInfo.url;
        this.registerTab(tabId, changeInfo.url);
        logger.info('Current tab URL updated', { tabId, url: changeInfo.url });
      }
    });

    // Initialize with current active tab
    this._initCurrentTab();
  }

  /**
   * Initialize current tab on startup
   * Sets _readyPromise and _isReady when complete
   */
  _initCurrentTab() {
    this._readyPromise = (async () => {
      try {
        // Try current window first
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Fallback: any active tab if current window has none
        if (!tab) {
          [tab] = await chrome.tabs.query({ active: true });
          if (tab) {
            logger.info('Using fallback: active tab from any window');
          }
        }

        if (tab) {
          this.currentTabId = tab.id;
          this.currentTabUrl = tab.url;
          this.registerTab(tab.id, tab.url);
          logger.info('Initialized current tab', { tabId: tab.id, url: tab.url });
        } else {
          logger.warn('No active tab found during initialization');
        }
      } catch (e) {
        logger.warn('Could not initialize current tab', { error: e.message });
      } finally {
        this._isReady = true;
      }
    })();
  }

  /**
   * Get the current active tab ID
   * @returns {number|null}
   */
  getCurrentTabId() {
    return this.currentTabId;
  }

  /**
   * Get the current active tab URL
   * @returns {string|null}
   */
  getCurrentTabUrl() {
    return this.currentTabUrl;
  }

  /**
   * Set which tab should show expanded content in browser state output
   * @param {number|null} tabId - Tab ID to expand, or null to collapse all
   */
  setExpandedTab(tabId) {
    this.expandedTabId = tabId;
    logger.info('Set expanded tab', { tabId });
  }

  /**
   * Get the currently expanded tab ID
   * @returns {number|null}
   */
  getExpandedTab() {
    return this.expandedTabId;
  }

  /**
   * Register a new tab or update existing tab's current URL
   * @param {number} tabId - The tab ID
   * @param {string} url - Current URL of the tab
   */
  registerTab(tabId, url) {
    if (!this.tabs.has(tabId)) {
      this.tabs.set(tabId, {
        tabId,
        currentUrl: url,
        urlHistory: [{
          url,
          timestamp: new Date().toISOString()
        }],
        pageContents: []
      });
      logger.info('Registered new tab', { tabId, url });
    } else {
      const tab = this.tabs.get(tabId);

      // Only add to history if URL changed
      if (tab.currentUrl !== url) {
        tab.currentUrl = url;
        tab.urlHistory.push({
          url,
          timestamp: new Date().toISOString()
        });
        logger.info('Updated tab URL', { tabId, url });
      }
    }

    return this.tabs.get(tabId);
  }

  /**
   * Ensure a tab is registered, fetching URL if not provided
   * @param {number} tabId - The tab ID
   * @param {string} [providedUrl] - Optional URL to use (if not provided, will be fetched)
   * @returns {Promise<Object>} Tab state with page_url
   */
  async ensureTabRegistered(tabId, providedUrl) {
    // Get current tab URL if not provided
    const pageUrl = providedUrl || await getTabUrl(tabId);

    // Register the tab
    this.registerTab(tabId, pageUrl);

    return { page_url: pageUrl };
  }

  /**
   * Add page content from a readpage call
   * If the same URL already has content, mark the old one as updated
   * @param {number} tabId - The tab ID
   * @param {string} url - Page URL
   * @param {Object} content - Extracted content (text, buttons, links)
   */
  addPageContent(tabId, url, content) {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      logger.error('Tab not found when adding page content', { tabId });
      throw new Error(`Tab ${tabId} not registered`);
    }

    // Validate content object
    if (!content || typeof content !== 'object') {
      logger.error('Invalid content provided to addPageContent', { tabId, url, content });
      throw new Error('Content must be a valid object');
    }

    // Find existing content for this URL
    const existingContentIndex = tab.pageContents.findIndex(
      pc => pc.url === url && pc.status === 'current'
    );

    if (existingContentIndex !== -1) {
      // Mark old content as updated
      const oldContent = tab.pageContents[existingContentIndex];
      oldContent.status = 'updated';
      oldContent.updatedTo = new Date().toISOString();

      logger.info('Marked old page content as updated', { tabId, url });
    }

    // Add new content at the end
    const newContent = {
      url,
      timestamp: new Date().toISOString(),
      content: {
        title: content.title || '',
        text: content.text || '',
        buttons: content.buttons || [],
        links: content.links || [],
        inputs: content.inputs || []
      },
      status: 'current'
    };

    tab.pageContents.push(newContent);
    logger.info('Added new page content', { tabId, url, contentItems: tab.pageContents.length });

    return newContent;
  }

  /**
   * Get tab state
   * @param {number} tabId - The tab ID
   * @returns {Object|null} Tab state or null if not found
   */
  getTab(tabId) {
    return this.tabs.get(tabId) || null;
  }

  /**
   * Get current page content for a tab
   * @param {number} tabId - The tab ID
   * @returns {Object|null} Current page content or null
   */
  getCurrentPageContent(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;

    // Find the most recent 'current' content
    const currentContents = tab.pageContents.filter(pc => pc.status === 'current');
    return currentContents.length > 0 ? currentContents[currentContents.length - 1] : null;
  }

  /**
   * Get all page contents for a tab (including updated ones)
   * @param {number} tabId - The tab ID
   * @returns {Array} Array of page contents
   */
  getAllPageContents(tabId) {
    const tab = this.tabs.get(tabId);
    return tab ? tab.pageContents : [];
  }

  /**
   * Remove a tab from state
   * @param {number} tabId - The tab ID
   */
  removeTab(tabId) {
    const removed = this.tabs.delete(tabId);
    if (removed) {
      logger.info('Removed tab from state', { tabId });
    }
    return removed;
  }

  /**
   * Format browser state for chat context
   * Returns a formatted string representation suitable for LLM context
   * When a tab is expanded (via setExpandedTab), shows full page content for that tab
   * @returns {string} Formatted browser state
   */
  formatForChat() {
    const lines = [];
    lines.push('=== BROWSER STATE ===');
    lines.push(`Current Tab: ${this.currentTabId} (${this.currentTabUrl || 'unknown'})\n`);

    for (const [tabId, tab] of this.tabs) {
      const isExpanded = tabId === this.expandedTabId;
      const isCurrent = tabId === this.currentTabId ? ' [CURRENT]' : '';
      lines.push(`Tab ${tabId}${isCurrent}${isExpanded ? ' [EXPANDED]' : ''}:`);
      lines.push(`  Current URL: ${tab.currentUrl}`);

      if (tab.urlHistory.length > 1) {
        lines.push(`  URL History:`);
        tab.urlHistory.forEach((entry, idx) => {
          lines.push(`    ${idx + 1}. ${entry.url} (${entry.timestamp})`);
        });
      }

      if (tab.pageContents.length > 0) {
        lines.push(`  Page Contents:`);
        tab.pageContents.forEach((pc, idx) => {
          const statusStr = pc.status === 'updated'
            ? `[UPDATED to ${pc.updatedTo}]`
            : '[CURRENT]';

          lines.push(`    ${idx + 1}. ${statusStr} ${pc.url}`);
          lines.push(`       Title: ${pc.content.title || 'N/A'}`);

          // If this tab is expanded, show full content
          if (isExpanded && pc.status === 'current') {
            // Full text content
            if (pc.content.text) {
              lines.push(`       Text: ${pc.content.text}`);
            }

            // Full links with details
            if (pc.content.links && pc.content.links.length > 0) {
              lines.push(`       Links (${pc.content.links.length}):`);
              pc.content.links.forEach(link => {
                const linkText = link.text ? ` "${link.text}"` : '';
                lines.push(`         [${link.id}]${linkText} -> ${link.href || 'no href'}`);
              });
            }

            // Full buttons with details
            if (pc.content.buttons && pc.content.buttons.length > 0) {
              lines.push(`       Buttons (${pc.content.buttons.length}):`);
              pc.content.buttons.forEach(btn => {
                const btnText = btn.text ? ` "${btn.text}"` : '';
                const btnClass = btn.class ? ` class="${btn.class}"` : '';
                lines.push(`         [${btn.id}]${btnText}${btnClass}`);
              });
            }

            // Full inputs with details
            if (pc.content.inputs && pc.content.inputs.length > 0) {
              lines.push(`       Inputs (${pc.content.inputs.length}):`);
              pc.content.inputs.forEach(input => {
                const inputType = input.type ? ` type="${input.type}"` : '';
                const inputPlaceholder = input.placeholder ? ` placeholder="${input.placeholder}"` : '';
                lines.push(`         [${input.id}]${inputType}${inputPlaceholder}`);
              });
            }

            // Selects
            if (pc.content.selects && pc.content.selects.length > 0) {
              lines.push(`       Selects (${pc.content.selects.length}):`);
              pc.content.selects.forEach(sel => {
                lines.push(`         [${sel.id}] ${sel.name || 'unnamed'}`);
              });
            }

            // Textareas
            if (pc.content.textareas && pc.content.textareas.length > 0) {
              lines.push(`       Textareas (${pc.content.textareas.length}):`);
              pc.content.textareas.forEach(ta => {
                lines.push(`         [${ta.id}] ${ta.placeholder || 'no placeholder'}`);
              });
            }
          } else {
            // Collapsed view - show summary only
            if (pc.content.text) {
              const textPreview = pc.content.text.substring(0, 200);
              lines.push(`       Text: ${textPreview}${pc.content.text.length > 200 ? '...' : ''}`);
            }

            if (pc.content.buttons && pc.content.buttons.length > 0) {
              lines.push(`       Buttons: ${pc.content.buttons.length} buttons`);
            }

            if (pc.content.links && pc.content.links.length > 0) {
              lines.push(`       Links: ${pc.content.links.length} links`);
            }

            if (pc.content.inputs && pc.content.inputs.length > 0) {
              lines.push(`       Inputs: ${pc.content.inputs.length} form inputs`);
            }
          }
        });
      }

      lines.push(''); // Empty line between tabs
    }

    return lines.join('\n');
  }

  /**
   * Export browser state as JSON (for passing to chat application)
   * @returns {Object} Browser state as plain object
   */
  toJSON() {
    const json = {
      tabs: {},
      expandedTabId: this.expandedTabId
    };

    for (const [tabId, tab] of this.tabs) {
      json.tabs[tabId] = {
        tabId: tab.tabId,
        currentUrl: tab.currentUrl,
        urlHistory: tab.urlHistory,
        pageContents: tab.pageContents
      };
    }

    return json;
  }

  /**
   * Import browser state from JSON
   * @param {Object} json - Browser state JSON
   */
  fromJSON(json) {
    this.tabs.clear();
    this.expandedTabId = json.expandedTabId || null;

    if (json.tabs) {
      for (const [tabId, tab] of Object.entries(json.tabs)) {
        this.tabs.set(parseInt(tabId), tab);
      }
    }

    logger.info('Imported browser state', { tabCount: this.tabs.size, expandedTabId: this.expandedTabId });
  }

  /**
   * Clear all browser state
   */
  clear() {
    this.tabs.clear();
    this.expandedTabId = null;
    logger.info('Cleared all browser state');
  }

  /**
   * Get summary statistics
   * @returns {Object} Statistics about browser state
   */
  getStats() {
    let totalUrls = 0;
    let totalContents = 0;
    let currentContents = 0;
    let updatedContents = 0;

    for (const tab of this.tabs.values()) {
      totalUrls += tab.urlHistory.length;
      totalContents += tab.pageContents.length;
      currentContents += tab.pageContents.filter(pc => pc.status === 'current').length;
      updatedContents += tab.pageContents.filter(pc => pc.status === 'updated').length;
    }

    return {
      totalTabs: this.tabs.size,
      totalUrls,
      totalContents,
      currentContents,
      updatedContents
    };
  }

  /**
   * Execute a content script action
   * @param {number} tabId - Tab ID
   * @param {string} action - Action name
   * @param {Object} params - Action parameters
   * @returns {Promise<Object>} Action result
   */
  async executeContentScript(tabId, action, params = {}) {
    logger.info(`Content Script Call: ${action}`, { tabId, params });

    try {
      // Check if tab still exists
      try {
        await chrome.tabs.get(tabId);
      } catch {
        logger.error('Tab no longer exists', { tabId });
        throw new Error('Tab no longer exists');
      }

      // Send message to content script
      const result = await chrome.tabs.sendMessage(tabId, { action, ...params });
      logger.info(`Content Script Result: ${action}`, { result });
      return result;
    } catch (error) {
      // If content script not loaded, try to inject it
      if (error.message.includes('Could not establish connection') ||
          error.message.includes('Receiving end does not exist')) {
        try {
          logger.info('Injecting content script', { tabId });
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
          });

          // Retry after injection
          logger.info('Retrying after content script injection', { tabId, action });
          const result = await chrome.tabs.sendMessage(tabId, { action, ...params });
          logger.info(`Content Script Result (after injection): ${action}`, { result });
          return result;
        } catch (injectError) {
          logger.error('Failed to inject content script', {
            tabId,
            error: injectError.message
          });
          throw new Error(`Failed to inject content script: ${injectError.message}`);
        }
      }
      logger.error(`Content Script Error: ${action}`, {
        tabId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Extract page content from a tab and update browser state
   * Sets this tab as expanded so full content appears in formatForChat()
   * @param {number} tabId - Tab ID
   * @returns {Promise<Object>} Result with page_url and extraction status
   */
  async extractAndStoreContent(tabId) {
    // Get current tab URL
    const pageUrl = await getTabUrl(tabId);

    // Register tab with current URL
    this.registerTab(tabId, pageUrl);

    // Extract content
    const content = await this.executeContentScript(tabId, ContentAction.EXTRACT_CONTENT);

    logger.info('Content extracted from page', {
      tabId,
      pageUrl,
      hasContent: !!content,
      contentType: typeof content,
      keys: content ? Object.keys(content) : []
    });

    // Validate content before adding to browser state
    if (!content || typeof content !== 'object') {
      logger.error('Invalid content returned from extractContent', {
        tabId,
        content,
        contentType: typeof content
      });
      throw new Error('Failed to extract valid content from page');
    }

    // Add page content to browser state
    this.addPageContent(tabId, pageUrl, content);

    // Set this tab as expanded so content appears in browser state output
    this.setExpandedTab(tabId);

    // Return brief result - full content is now in browser state
    return {
      extracted: true,
      page_url: pageUrl,
      tabId,
      summary: {
        title: content.title || 'N/A',
        links: content.links?.length || 0,
        buttons: content.buttons?.length || 0,
        inputs: content.inputs?.length || 0
      },
      note: 'Full page content is available in the BROWSER STATE section above (tab marked as [EXPANDED])'
    };
  }

  /**
   * Click an element in a tab
   * @param {number} tabId - Tab ID
   * @param {number} elementId - Element ID from READ_PAGE
   * @param {Object} modifiers - Click modifiers
   * @returns {Promise<Object>} Click result
   */
  async clickElement(tabId, elementId, modifiers = {}) {
    return await this.executeContentScript(tabId, ContentAction.CLICK_ELEMENT, {
      elementId,
      modifiers
    });
  }

  /**
   * Fill form fields in a tab
   * @param {number} tabId - Tab ID
   * @param {Array} fields - Form fields to fill
   * @param {boolean} submit - Whether to submit the form
   * @param {number} submitElementId - Submit button element ID
   * @returns {Promise<Object>} Fill result
   */
  async fillForm(tabId, fields, submit = false, submitElementId) {
    return await this.executeContentScript(tabId, ContentAction.FILL_FORM, {
      fields,
      submit,
      submitElementId
    });
  }

  /**
   * Scroll and wait in a tab
   * @param {number} tabId - Tab ID
   * @param {string} direction - Scroll direction
   * @param {number} pixels - Pixels to scroll
   * @param {number} waitMs - Milliseconds to wait
   * @returns {Promise<Object>} Scroll result
   */
  async scrollAndWait(tabId, direction, pixels = 500, waitMs = 500) {
    return await this.executeContentScript(tabId, ContentAction.SCROLL_AND_WAIT, {
      direction,
      pixels,
      waitMs
    });
  }

  /**
   * Navigate to a URL
   * @param {number} tabId - Tab ID
   * @param {string} url - URL to navigate to
   * @returns {Promise<Object>} Navigation result
   */
  async navigateTo(tabId, url) {
    // Validate URL
    let validatedUrl = url;
    if (!validatedUrl.match(/^https?:\/\//)) {
      validatedUrl = 'https://' + validatedUrl;
    }

    // Update tab URL
    await chrome.tabs.update(tabId, { url: validatedUrl });

    // Wait for navigation to start
    await new Promise(resolve => setTimeout(resolve, 500));

    // Register the new URL
    this.registerTab(tabId, validatedUrl);

    return {
      navigated: true,
      new_url: validatedUrl
    };
  }

  /**
   * Navigate back in browser history
   * @param {number} tabId - Tab ID
   * @returns {Promise<Object>} Navigation result
   */
  async goBack(tabId) {
    await chrome.tabs.goBack(tabId);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get updated URL and register it
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url) {
      this.registerTab(tabId, tab.url);
    }

    return { navigated: true, direction: 'back' };
  }

  /**
   * Navigate forward in browser history
   * @param {number} tabId - Tab ID
   * @returns {Promise<Object>} Navigation result
   */
  async goForward(tabId) {
    await chrome.tabs.goForward(tabId);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get updated URL and register it
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url) {
      this.registerTab(tabId, tab.url);
    }

    return { navigated: true, direction: 'forward' };
  }
}

// Singleton instance
let browserStateInstance = null;

/**
 * Get the singleton browser state instance
 * @returns {BrowserState}
 */
export function getBrowserState() {
  if (!browserStateInstance) {
    browserStateInstance = new BrowserState();
  }
  return browserStateInstance;
}

/**
 * Get formatted browser state for LLM context
 * Waits for initialization to complete before returning
 * @returns {Promise<string>} Formatted browser state string
 */
export async function getBrowserStateBundle() {
  const state = getBrowserState();
  await state.ready();
  return state.formatForChat();
}

/**
 * Reset browser state (mainly for testing)
 */
export function resetBrowserState() {
  if (browserStateInstance) {
    browserStateInstance.clear();
  }
  browserStateInstance = new BrowserState();
  return browserStateInstance;
}
