/**
 * Router action (Tier-1) - High-level intent routing
 * Decides between browser actions vs direct chat response
 * Keeps prompt minimal - detailed browser info only shown if needed
 */

import { BROWSER_ACTION } from './browser-actions.js';
import { FINAL_RESPONSE } from './final-response-action.js';
import { LLM_TOOL } from './llm-action.js';

/**
 * Action name constant
 */
export const BROWSER_ROUTER = 'BROWSER_ROUTER';

/**
 * Tier-1 system prompt - uses {{available_tools}} injected by executor
 */
const TIER1_SYSTEM_PROMPT = `You are a browser automation assistant. Execute the user's request by calling the appropriate tool.

**Decision Guide:**
{{decision_guide}}

IMPORTANT: Always call a tool.`;

/**
 * BROWSER_ROUTER action (Tier-1)
 * Routes between browser actions and direct chat responses
 */
export const routerAction = {
  name: BROWSER_ROUTER,
  description: 'Top-level router that decides whether a user request needs browser interaction, general knowledge, or final response. Routes to BROWSER_ACTION for page interaction, LLM_TOOL for knowledge/reasoning questions, or FINAL_RESPONSE to return results to user.',
  input_schema: {
    type: 'object',
    properties: {
      user_message: {
        type: 'string',
        description: 'The user\'s natural language request'
      }
    },
    required: ['user_message'],
    additionalProperties: false
  },
  steps: [
    {
      // Tier-1 LLM choice: BROWSER_ACTION, LLM_TOOL, or FINAL_RESPONSE
      type: 'llm',
      system_prompt: TIER1_SYSTEM_PROMPT,
      message: `{{user_message}}`,
      intelligence: 'MEDIUM',
      tool_choice: {
        available_actions: [
          BROWSER_ACTION,
          LLM_TOOL,
          FINAL_RESPONSE
        ],
        stop_action: FINAL_RESPONSE,
        max_iterations: 5
      }
    }
  ]
};
