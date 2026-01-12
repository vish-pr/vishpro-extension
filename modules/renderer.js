// UI Rendering Functions
import { formatTimestamp } from './utils.js';

export function renderExtractionItem(extraction) {
  const { text = '', links = [], buttons = [] } = extraction;

  return `
    <div class="card bg-base-300 border border-base-content/10 cursor-pointer hover:border-base-content/30 transition-colors mb-2" data-url="${extraction.url}" data-timestamp="${extraction.timestamp}">
      <div class="card-body p-3 gap-1">
        <div class="flex justify-between items-start">
          <h3 class="card-title text-sm truncate flex-1">${extraction.title || 'Untitled'}</h3>
          <span class="text-[11px] opacity-50 ml-2 shrink-0">${formatTimestamp(extraction.timestamp)}</span>
        </div>
        <p class="text-[11px] opacity-50 truncate">${extraction.url}</p>
        <div class="flex gap-3 text-[11px] opacity-70 mt-1">
          <span><span class="text-primary font-medium">${text.length}</span> chars</span>
          <span><span class="text-primary font-medium">${links.length}</span> links</span>
          <span><span class="text-primary font-medium">${buttons.length}</span> buttons</span>
        </div>
      </div>
    </div>
  `;
}

function renderSection(label, content) {
  return `
    <div class="mt-3">
      <div class="text-[11px] font-semibold uppercase tracking-wide opacity-50 mb-1.5">${label}</div>
      <div class="text-xs leading-relaxed opacity-70 whitespace-pre-wrap break-words bg-base-300 p-2.5 rounded max-h-24 overflow-y-auto">${content}</div>
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
    <div class="card bg-base-300 border border-base-content/10 max-h-64 overflow-y-auto">
      <div class="card-body p-3.5">
        <div class="border-b border-base-content/10 pb-2.5 mb-1">
          <h3 class="font-medium text-sm">${extraction.title || 'Untitled'}</h3>
          <p class="text-[11px] opacity-50 break-all mt-1">${extraction.url}</p>
          <p class="text-[11px] opacity-40 mt-1.5">Extracted: ${formatTimestamp(extraction.timestamp)}</p>
        </div>
        ${sections}
      </div>
    </div>
  `;
}

export function renderActionHistoryItem(action) {
  return `
    <div class="bg-base-300 border border-base-content/10 rounded-lg p-2.5 mb-1.5">
      <div class="text-[11px] opacity-50">${formatTimestamp(action.timestamp)}</div>
      <div class="text-xs opacity-70 leading-relaxed mt-0.5">${action.description}</div>
    </div>
  `;
}

export function renderNoData(message) {
  return `<div class="text-center opacity-50 text-sm py-6">${message}</div>`;
}
