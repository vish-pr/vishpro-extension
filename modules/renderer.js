// UI Rendering Functions
import { formatTimestamp } from './utils.js';

export function renderExtractionItem(extraction) {
  const { text = '', links = [], buttons = [] } = extraction;

  return `
    <div class="data-card" data-url="${extraction.url}" data-timestamp="${extraction.timestamp}">
      <div class="data-card-header">
        <div class="data-card-title">${extraction.title || 'Untitled'}</div>
        <div class="data-card-time">${formatTimestamp(extraction.timestamp)}</div>
      </div>
      <div class="data-card-url">${extraction.url}</div>
      <div class="data-card-stats">
        <span class="stat"><span class="stat-value">${text.length}</span> chars</span>
        <span class="stat"><span class="stat-value">${links.length}</span> links</span>
        <span class="stat"><span class="stat-value">${buttons.length}</span> buttons</span>
      </div>
    </div>
  `;
}

function renderSection(label, content) {
  return `
    <div class="extraction-detail-section">
      <div class="extraction-detail-label">${label}</div>
      <div class="extraction-detail-content">${content}</div>
    </div>
  `;
}

export function renderExtractionDetail(extraction) {
  const text = extraction.text?.substring(0, 1000) || 'No text content';
  const links = extraction.links?.slice(0, 10) || [];
  const buttons = extraction.buttons?.slice(0, 10) || [];

  const sections = [
    renderSection('Text Content (first 1000 chars)', text),
    links.length > 0 ? renderSection(
      'Links (first 10)',
      links.map(l => `${l.text || 'No text'}: ${l.href}`).join('\n')
    ) : '',
    buttons.length > 0 ? renderSection(
      'Buttons (first 10)',
      buttons.map(b => `${b.text || 'No text'} (${b.id || b.class || 'no id/class'})`).join('\n')
    ) : ''
  ].filter(Boolean).join('');

  return `
    <div class="extraction-detail">
      <div class="extraction-detail-header">
        <div class="extraction-detail-title">${extraction.title || 'Untitled'}</div>
        <div class="extraction-detail-url">${extraction.url}</div>
        <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 6px;">
          Extracted: ${formatTimestamp(extraction.timestamp)}
        </div>
      </div>
      ${sections}
    </div>
  `;
}

export function renderActionHistoryItem(action) {
  return `
    <div class="action-log-item">
      <div class="action-log-time">${formatTimestamp(action.timestamp)}</div>
      <div class="action-log-text">${action.description}</div>
    </div>
  `;
}

export function renderNoData(message) {
  return `<div class="no-data">${message}</div>`;
}
