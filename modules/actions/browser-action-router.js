/**
 * Browser Action Router (Tier-2)
 * Detailed browser action routing with full action schema
 * Called when BROWSER_ACTION is chosen from tier-1 router
 */

import {
  ACTION_READ_PAGE,
  ACTION_CLICK_ELEMENT,
  ACTION_FILL_FORM,
  ACTION_SELECT_OPTION,
  ACTION_CHECK_CHECKBOX,
  ACTION_SUBMIT_FORM,
  ACTION_NAVIGATE_TO,
  ACTION_SCROLL_TO,
  ACTION_WAIT_FOR_LOAD,
  ACTION_WAIT_FOR_ELEMENT,
  ACTION_GO_BACK,
  ACTION_GO_FORWARD
} from './browser-actions.js';
import { CHAT_RESPONSE } from './chat-action.js';

/**
 * Action name constant
 */
export const BROWSER_ACTION = 'BROWSER_ACTION';

/**
 * Detailed system prompt for browser actions (tier-2)
 * Only shown when user actually needs browser interaction
 */
const BROWSER_ACTION_SYSTEM_PROMPT = `You are a browser automation assistant executing actions on web pages.

**Available Actions:**

1. **READ_PAGE**: Extract page content (text, links, buttons, forms)
   - Use when: Need to see what's on the page or find elements
   - Returns: Page title, text, links (with IDs), buttons (with IDs), inputs (with IDs)

2. **CLICK_ELEMENT**: Click an element by its ID
   - Use when: Need to click a button, link, or interactive element
   - Requires: elementId (from READ_PAGE results)
   - Options: newTab (background), newTabActive (foreground), download

3. **FILL_FORM**: Fill form fields with values
   - Use when: Need to enter text in input fields
   - Requires: form_fields array with [{elementId, value}]
   - Options: submit (bool), submit_element_id

4. **SELECT_OPTION**: Select from dropdown
   - Requires: elementId, value (option text or value)

5. **CHECK_CHECKBOX**: Toggle checkbox state
   - Requires: elementId, checked (true/false)

6. **SUBMIT_FORM**: Submit a form
   - Requires: elementId (submit button or form)

7. **NAVIGATE_TO**: Go to a URL
   - Requires: url (include https://)

8. **SCROLL_TO**: Scroll the page
   - Requires: direction (up/down/top/bottom)
   - Options: pixels (default 500), wait_ms

9. **WAIT_FOR_LOAD**: Wait for page to load
   - Options: timeout_ms (default 10000)

10. **WAIT_FOR_ELEMENT**: Wait for element to appear
    - Requires: elementId, timeout_ms

11. **GO_BACK** / **GO_FORWARD**: Browser history navigation

12. **CHAT_RESPONSE**: Respond to user [STOP]
    - Use when: Task complete or need to communicate

**Workflow:**
1. Usually start with READ_PAGE to see the page
2. Use element IDs from READ_PAGE results for clicks/forms
3. Chain actions: READ_PAGE -> FILL_FORM -> CLICK_ELEMENT -> WAIT_FOR_LOAD
4. End with CHAT_RESPONSE when done

**Element IDs:**
- READ_PAGE assigns numeric IDs to all interactive elements
- Use these IDs (not CSS selectors) for CLICK_ELEMENT, FILL_FORM, etc.
- IDs appear in browser state as [id] next to each element`;

/**
 * BROWSER_ACTION action (Tier-2)
 * Handles detailed browser automation with full action choices
 */
export const browserActionRouter = {
  name: BROWSER_ACTION,
  description: 'Execute browser actions (read, click, fill, navigate, scroll). Use this when you need to interact with web pages.',
  input_schema: {
    type: 'object',
    properties: {
      user_message: {
        type: 'string',
        description: 'The user\'s natural language request'
      },
      instructions: {
        type: 'string',
        description: 'Detailed instructions from router about what to accomplish'
      }
    },
    required: ['user_message'],
    additionalProperties: false
  },
  output_schema: {
    type: 'object',
    properties: {
      response: { type: 'string' },
      success: { type: 'boolean' }
    },
    additionalProperties: false
  },
  steps: [
    {
      // LLM step with multi-turn browser action loop
      llm: {
        system_prompt: BROWSER_ACTION_SYSTEM_PROMPT,
        message: `User request: {{user_message}}
{{#instructions}}
Instructions: {{instructions}}
{{/instructions}}
Execute the appropriate browser actions. The browser state shows current page content if available.`,
        intelligence: 'MEDIUM'
      },
      choice: {
        available_actions: [
          ACTION_READ_PAGE,
          ACTION_CLICK_ELEMENT,
          ACTION_FILL_FORM,
          ACTION_SELECT_OPTION,
          ACTION_CHECK_CHECKBOX,
          ACTION_SUBMIT_FORM,
          ACTION_NAVIGATE_TO,
          ACTION_SCROLL_TO,
          ACTION_WAIT_FOR_LOAD,
          ACTION_WAIT_FOR_ELEMENT,
          ACTION_GO_BACK,
          ACTION_GO_FORWARD,
          CHAT_RESPONSE
        ],
        stop_action: CHAT_RESPONSE,
        max_iterations: 7
      },
      // Flag to use full browser state (not summary)
      use_full_browser_state: true
    }
  ]
};
