// Chat Functionality
import { elements } from './dom.js';
import { logAction } from './storage.js';
import { renderMarkdown } from './markdown.js';

function clearEmptyState() {
  const emptyState = elements.chatContainer.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }
}

function setStatus(text, active = false) {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  if (statusDot) {
    statusDot.classList.toggle('active', active);
  }
  if (statusText) {
    statusText.textContent = text;
  }
}

export function addMessage(role, content) {
  clearEmptyState();

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;

  const bubbleDiv = document.createElement('div');
  bubbleDiv.className = 'message-bubble';
  bubbleDiv.innerHTML = renderMarkdown(content);

  messageDiv.appendChild(bubbleDiv);
  elements.chatContainer.appendChild(messageDiv);
  elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

function addTypingIndicator() {
  clearEmptyState();

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';
  messageDiv.id = 'typing-indicator';

  const bubbleDiv = document.createElement('div');
  bubbleDiv.className = 'message-bubble';
  bubbleDiv.innerHTML = `
    <div class="typing-indicator">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;

  messageDiv.appendChild(bubbleDiv);
  elements.chatContainer.appendChild(messageDiv);
  elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

function removeTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) {
    indicator.remove();
  }
}

async function sendMessageToBackground(message) {
  return chrome.runtime.sendMessage({
    action: 'processMessage',
    message
  });
}

async function sendMessage() {
  const message = elements.messageInput.value.trim();
  if (!message) return;

  addMessage('user', message);
  elements.messageInput.value = '';
  elements.messageInput.style.height = 'auto';
  elements.sendButton.disabled = true;

  setStatus('Processing', true);
  addTypingIndicator();

  await logAction('message', `Sent: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);

  try {
    const response = await sendMessageToBackground(message);
    removeTypingIndicator();

    if (response.error) {
      addMessage('system', `Error: ${response.error}`);
    } else {
      addMessage('assistant', response.result);
    }
  } catch (error) {
    removeTypingIndicator();
    addMessage('system', `Error: ${error.message}`);
  } finally {
    elements.sendButton.disabled = false;
    setStatus('Ready', false);
  }
}

function setupAutoResize() {
  elements.messageInput.addEventListener('input', () => {
    elements.messageInput.style.height = 'auto';
    elements.messageInput.style.height = elements.messageInput.scrollHeight + 'px';
  });
}

function setupKeyboardShortcuts() {
  elements.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'addMessage') {
      addMessage(message.role, message.content);
    }
  });
}

export function initChat(hasValidKey) {
  setupAutoResize();
  setupKeyboardShortcuts();
  setupMessageListener();
  elements.sendButton.addEventListener('click', sendMessage);

  // Set initial status
  if (hasValidKey) {
    setStatus('Ready', false);
  } else {
    setStatus('No API Key', false);
  }
}
