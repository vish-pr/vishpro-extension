// UI Rendering Functions

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

const tpl = id => document.getElementById(id).content.cloneNode(true).firstElementChild;

export function createExtractionItem(extraction) {
  const { text = '', links = [], buttons = [] } = extraction;
  const el = tpl('tpl-extraction-item');
  el.dataset.url = extraction.url;
  el.dataset.timestamp = extraction.timestamp;
  el.querySelector('.ext-title').textContent = extraction.title || 'Untitled';
  el.querySelector('.ext-time').textContent = formatTimestamp(extraction.timestamp);
  el.querySelector('.ext-url').textContent = extraction.url;
  el.querySelector('.ext-chars').textContent = text.length;
  el.querySelector('.ext-links').textContent = links.length;
  el.querySelector('.ext-buttons').textContent = buttons.length;
  return el;
}

function createSection(label, content) {
  const el = tpl('tpl-extraction-section');
  el.querySelector('.section-label').textContent = label;
  el.querySelector('.section-content').textContent = content;
  return el;
}

export function createExtractionDetail(extraction) {
  const el = tpl('tpl-extraction-detail');
  el.querySelector('.detail-title').textContent = extraction.title || 'Untitled';
  el.querySelector('.detail-url').textContent = extraction.url;
  el.querySelector('.detail-time').textContent = `Extracted: ${formatTimestamp(extraction.timestamp)}`;

  const sectionsEl = el.querySelector('.detail-sections');
  sectionsEl.appendChild(createSection('Text Content (first 1000 chars)', extraction.text?.substring(0, 1000) || 'No text content'));

  const links = extraction.links?.slice(0, 10) || [];
  if (links.length) {
    sectionsEl.appendChild(createSection('Links (first 10)', links.map(l => `${l.text || 'No text'}: ${l.href}`).join('\n')));
  }

  const buttons = extraction.buttons?.slice(0, 10) || [];
  if (buttons.length) {
    sectionsEl.appendChild(createSection('Buttons (first 10)', buttons.map(b => `${b.text || 'No text'} (${b.id || b.class || 'no id/class'})`).join('\n')));
  }
  return el;
}

export function createActionItem(action) {
  const el = tpl('tpl-action-item');
  el.querySelector('.action-time').textContent = formatTimestamp(action.timestamp);
  el.querySelector('.action-desc').textContent = action.description;
  return el;
}
