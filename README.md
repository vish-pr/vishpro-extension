# VishPro Browser Agent

A browser extension that uses LLMs to automate web browsing through natural language.

## Architecture

```
User Request
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Tier-1: Router (router-action.js)                      │
│  ├─ Minimal prompt, browser state summary only          │
│  └─ Choice: BROWSER_ACTION or CHAT_RESPONSE             │
└─────────────────────────────────────────────────────────┘
    │                                    │
    ▼                                    ▼
┌─────────────────────────┐    ┌─────────────────────────┐
│  Tier-2: Browser Router │    │  CHAT_RESPONSE          │
│  (browser-actions.js)   │    │  Direct reply to user   │
│  ├─ Full action details │    └─────────────────────────┘
│  ├─ Full browser state  │
│  └─ Multi-turn loop     │
│      READ_PAGE          │
│      CLICK_ELEMENT      │
│      FILL_FORM          │
│      NAVIGATE_TO        │
│      SCROLL_TO          │
│      ...                │
└─────────────────────────┘
```

## Key Components

### Orchestrator (`modules/orchestrator/`)
- **executor.js** - Runs actions, handles multi-turn LLM loops
- **context.js** - Parameter validation
- **templates.js** - Prompt templating

### Actions (`modules/actions/`)
- **router-action.js** - Tier-1: High-level routing (BROWSER_ACTION vs CHAT_RESPONSE)
- **browser-actions.js** - Tier-2 router + 13 browser action definitions (READ_PAGE, CLICK, etc.)
- **chat-action.js** - Final response generation

### State Management
- **browser-state.js** - Tracks tabs, URLs, page content
  - `formatForChat()` - Formatted browser state for LLM context
  - `extractAndStoreContent()` - Runs content extraction
  - `clickElement()`, `fillForm()`, `navigateTo()` - Browser operations

### Content Script (`content.js`)
- Injected into web pages
- Extracts page content (text, links, buttons, inputs)
- Assigns element IDs (`data-vish-id`) for LLM reference
- Handles clicks, form fills, scrolling

### LLM System (`modules/`)
- **llm.js** - Unified LLM interface with failover
- **llm-config.js** - Model tiers (HIGH/MEDIUM/LOW)
- **llm-client.js** - OpenRouter & Gemini API clients

## Data Flow

```
1. User: "What is this page?"
2. Tier-1 Router sees: "Browser: Tab 123: https://example.com"
3. Tier-1 chooses: BROWSER_ACTION (needs to read page)
4. Tier-2 Router sees: Full browser state
5. Tier-2 chooses: READ_PAGE
6. content.js extracts page → stored in BrowserState
7. Tier-2 sees extracted content, chooses: CHAT_RESPONSE
8. Response generated and returned to user
```

## Quick Start

1. Load extension in `chrome://extensions/` (Developer mode)
2. Click extension → Settings → Add API key (Gemini or OpenRouter)
3. Chat: "Read this page", "Click the login button", etc.

## File Structure

```
extension/
├── modules/
│   ├── orchestrator/
│   │   └── executor.js       # Action execution engine
│   ├── actions/
│   │   ├── router-action.js  # Tier-1 routing
│   │   ├── browser-actions.js # Tier-2 router + 13 action definitions
│   │   └── chat-action.js    # Response generation
│   ├── browser-state.js      # Tab/page state management
│   ├── llm.js               # LLM interface
│   ├── llm-config.js        # Model configuration
│   └── logger.js            # Logging system
├── content.js               # Page interaction script
├── background.js            # Service worker
├── sidepanel.js/html        # Chat UI
└── manifest.json
```

## Browser Actions (Tier-2)

| Action | Description |
|--------|-------------|
| READ_PAGE | Extract page content with element IDs |
| CLICK_ELEMENT | Click by element ID (supports new tab, download) |
| FILL_FORM | Fill form fields by element ID |
| SELECT_OPTION | Select dropdown option |
| CHECK_CHECKBOX | Toggle checkbox |
| SUBMIT_FORM | Submit form |
| NAVIGATE_TO | Go to URL |
| SCROLL_TO | Scroll page (up/down/top/bottom) |
| WAIT_FOR_LOAD | Wait for page load |
| WAIT_FOR_ELEMENT | Wait for element to appear |
| GO_BACK/GO_FORWARD | Browser history navigation |

## LLM Providers

- **Gemini** (Google AI Studio) - Free tier available
- **OpenRouter** - Multiple models, pay-as-you-go

Intelligence levels: LOW (fast), MEDIUM (balanced), HIGH (quality)
