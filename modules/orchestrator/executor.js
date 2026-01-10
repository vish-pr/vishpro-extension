/**
 * Action executor
 *
 * Design:
 * - Params in, result out
 * - Everything needed passed in params
 * - Only final result returned to caller
 * - Internal conversation stays internal
 */

import { validateParams } from './context.js';
import { renderTemplate, resolveSystemPrompt } from './templates.js';
import logger from '../logger.js';
import { getBrowserStateBundle } from '../browser-state.js';
import { generate } from '../llm.js';
import { browserActions } from '../actions/browser-actions.js';
import { chatAction, CHAT_RESPONSE } from '../actions/chat-action.js';
import { routerAction } from '../actions/router-action.js';
import { browserActionRouter } from '../actions/browser-action-router.js';

const STEP_TIMEOUT_MS = 20000;
const LLM_TIMEOUT_MS = 40000;

// ============================================
// Actions Registry
// ============================================

function buildActionsRegistry() {
  const registry = {};
  const allActions = [...browserActions, chatAction, routerAction, browserActionRouter];

  for (const action of allActions) {
    registry[action.name] = action;
  }

  logger.info(`Loaded ${Object.keys(registry).length} actions`);
  return registry;
}

const actionsRegistry = buildActionsRegistry();

export function getAction(actionName) {
  return actionsRegistry[actionName];
}

// ============================================
// Execute Action
// ============================================

/**
 * Execute an action
 *
 * @param {Object} action - Action definition
 * @param {Object} params - All input parameters (flat object)
 * @returns {Promise<Object>} Result (flat object)
 */
export async function executeAction(action, params = {}) {
  logger.info(`Action: ${action.name}`, { params });

  // Validate input
  if (action.input_schema) {
    const validation = validateParams(params, action.input_schema);
    if (!validation.valid) {
      const errorMsg = `Validation failed for ${action.name}: ${validation.errors.join(', ')}`;
      logger.error(errorMsg, { errors: validation.errors });
      const error = new Error(errorMsg);
      error.isValidationError = true;
      error.validationErrors = validation.errors;
      throw error;
    }
  }

  let result = null;
  let prevResult = null;

  for (let i = 0; i < action.steps.length; i++) {
    const step = action.steps[i];

    try {
      result = await executeStep(step, params, prevResult);
      prevResult = result;
    } catch (error) {
      logger.error(`Step ${i + 1} failed: ${action.name}`, { error: error.message });
      throw new Error(`Step ${i + 1} failed: ${error.message}`);
    }
  }

  logger.info(`Action complete: ${action.name}`);
  return result;
}

// ============================================
// Step Execution
// ============================================

/**
 * Execute a single step
 *
 * @param {Function|Object} step - Step definition
 * @param {Object} params - Original input params
 * @param {Object} prevResult - Result from previous step (or null)
 */
async function executeStep(step, params, prevResult) {
  // Function step: (params, prevResult, browser) => result
  if (typeof step === 'function') {
    const browser = await getBrowserStateBundle();
    return await withTimeout(step(params, prevResult, browser), STEP_TIMEOUT_MS);
  }

  // Sub-action step: { action: 'name', mapParams: (params, prev) => newParams }
  if (step.action) {
    const subAction = actionsRegistry[step.action];
    if (!subAction) throw new Error(`Action not found: ${step.action}`);

    const subParams = step.mapParams
      ? step.mapParams(params, prevResult)
      : params;

    return await executeAction(subAction, subParams);
  }

  // LLM step: { llm: { message, system_prompt, schema } }
  // Multi-turn: { llm: {...}, choice: { available_actions, stop_action, max_iterations } }
  if (step.llm) {
    return await executeLLMStep(step, params);
  }

  throw new Error(`Invalid step type`);
}

// ============================================
// LLM Execution
// ============================================

async function executeLLMStep(step, params) {
  const { llm, choice } = step;
  const browser = await getBrowserStateBundle();

  // Determine which browser state format to use
  const useSummary = step.use_browser_summary === true;
  const browserStateText = useSummary ? browser.summary : browser.formatted;

  const templateCtx = {
    ...params,
    browser_state_formatted: browser.formatted,
    browser_state_summary: browser.summary,
    browser_state_json: browser.json
  };

  const systemPrompt = await resolveSystemPrompt(llm.system_prompt, templateCtx, generate);
  const message = renderTemplate(llm.message, templateCtx);

  // Single LLM call - insert browser state as second-to-last message
  if (!choice) {
    const baseMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ];
    const messagesWithBrowser = insertBrowserStateMessage(baseMessages, browserStateText);

    return await withTimeout(
      generate({
        messages: messagesWithBrowser,
        intelligence: llm.intelligence || 'MEDIUM',
        schema: llm.schema
      }),
      LLM_TIMEOUT_MS
    );
  }

  // Multi-turn loop (conversation stays internal)
  // Pass the flag for which browser state format to use
  return await executeMultiTurn(systemPrompt, message, choice, llm.intelligence, params, useSummary);
}

async function executeMultiTurn(systemPrompt, initialMessage, choice, intelligence, params, useSummary = false) {
  const { available_actions, stop_action = CHAT_RESPONSE, max_iterations = 5 } = choice;

  const conversation = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: initialMessage }
  ];

  // Keep complete history for summary (not pruned)
  const fullHistory = [];

  for (let i = 0; i < max_iterations; i++) {
    logger.info(`Turn ${i + 1}/${max_iterations}`);

    // Fresh browser state each turn - insert as second-to-last message
    // Use summary for tier-1, full for tier-2
    const browser = await getBrowserStateBundle();
    const browserStateText = useSummary ? browser.summary : browser.formatted;
    const messagesWithBrowser = insertBrowserStateMessage(conversation, browserStateText);

    // Get LLM choice
    const schema = buildChoiceSchema(available_actions, stop_action);
    const llmChoice = await withTimeout(
      generate({ messages: messagesWithBrowser, intelligence: intelligence || 'MEDIUM', schema }),
      LLM_TIMEOUT_MS
    );

    logger.info(`Chose: ${llmChoice.tool}`);
    conversation.push({ role: 'assistant', content: JSON.stringify(llmChoice, null, 2) });

    // Record in full history
    fullHistory.push({
      turn: i + 1,
      action: llmChoice.tool,
      params: llmChoice,
      timestamp: new Date().toISOString()
    });

    // Stop action -> execute and return final result
    if (llmChoice.tool === stop_action) {
      const stopAction = actionsRegistry[stop_action];
      if (!stopAction) throw new Error(`Stop action not found: ${stop_action}`);

      // Only use params from LLM choice - don't merge original params
      const stopParams = pickParams(llmChoice, stopAction);
      // Include complete conversation history for summary
      stopParams.conversation_history = formatConversationHistory(fullHistory);
      try {
        return await executeAction(stopAction, stopParams);
      } catch (error) {
        // If validation error, feed back to LLM to fix
        if (error.isValidationError) {
          logger.warn(`Stop action ${stop_action} validation failed, asking LLM to fix`, {
            errors: error.validationErrors
          });
          conversation.push({
            role: 'user',
            content: `Error: Your ${stop_action} call failed validation.\n` +
              `Errors: ${error.validationErrors.join(', ')}\n` +
              `Please fix the parameters and try again.`
          });
          continue; // Let LLM try again
        }
        throw error;
      }
    }

    // Execute chosen action
    const actionDef = actionsRegistry[llmChoice.tool];
    if (!actionDef) throw new Error(`Action not found: ${llmChoice.tool}`);

    const actionParams = pickParams(llmChoice, actionDef);

    let actionResult;
    try {
      actionResult = await executeAction(actionDef, actionParams);
    } catch (error) {
      // If validation error from LLM's choice, feed back to LLM to fix
      if (error.isValidationError) {
        logger.warn(`LLM chose ${llmChoice.tool} with invalid params, asking to fix`, {
          errors: error.validationErrors
        });
        // Record error in full history
        fullHistory[fullHistory.length - 1].error = error.validationErrors.join(', ');
        conversation.push({
          role: 'user',
          content: `Error: Your ${llmChoice.tool} call failed validation.\n` +
            `Errors: ${error.validationErrors.join(', ')}\n` +
            `Please fix the parameters and try again.`
        });
        continue; // Let LLM try again
      }
      // Other errors should propagate
      throw error;
    }

    // Record result in full history
    fullHistory[fullHistory.length - 1].result = actionResult;

    // Add result to internal conversation
    conversation.push({
      role: 'user',
      content: `Result:\n${JSON.stringify(actionResult, null, 2)}`
    });

    // Prune if too long
    if (conversation.length > 10) {
      conversation.splice(2, conversation.length - 8);
    }
  }

  // Max iterations reached
  logger.warn(`Max iterations reached`);
  const stopAction = actionsRegistry[stop_action];
  return await executeAction(stopAction, {
    response: 'Unable to complete within allowed iterations.'
  });
}

// ============================================
// Helpers
// ============================================

function pickParams(source, actionDef) {
  if (!actionDef.input_schema?.properties) return {};

  const picked = {};
  for (const key of Object.keys(actionDef.input_schema.properties)) {
    if (key in source) picked[key] = source[key];
  }
  return picked;
}

/**
 * Format complete conversation history for summary
 */
function formatConversationHistory(fullHistory) {
  if (!fullHistory || fullHistory.length === 0) {
    return 'No previous actions in this conversation.';
  }

  return fullHistory.map(entry => {
    let line = `Turn ${entry.turn}: ${entry.action}`;
    if (entry.params?.instructions) {
      line += `\n  Instructions: ${entry.params.instructions}`;
    }
    if (entry.result) {
      const resultStr = typeof entry.result === 'string'
        ? entry.result
        : JSON.stringify(entry.result, null, 2);
      // Truncate very long results
      const truncated = resultStr.length > 500
        ? resultStr.substring(0, 500) + '...'
        : resultStr;
      line += `\n  Result: ${truncated}`;
    }
    if (entry.error) {
      line += `\n  Error: ${entry.error}`;
    }
    return line;
  }).join('\n\n');
}

/**
 * Insert browser state as a separate message before the last user message
 * Pattern: [system, ...messages, BROWSER_STATE, last_user_message]
 */
function insertBrowserStateMessage(conversation, browserFormatted) {
  const copy = conversation.map(m => ({ ...m }));

  // Find the last user message index
  let lastUserIdx = -1;
  for (let i = copy.length - 1; i >= 0; i--) {
    if (copy[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  // Insert browser state as a user message right before the last user message
  const browserMessage = { role: 'user', content: `Current Browser State:\n${browserFormatted}` };

  if (lastUserIdx > 0) {
    copy.splice(lastUserIdx, 0, browserMessage);
  } else {
    // If no user message found or it's at index 0, append browser state
    copy.push(browserMessage);
  }

  return copy;
}

function buildChoiceSchema(availableActions, stopAction) {
  // Start with base properties
  const properties = {
    tool: {
      type: 'string',
      enum: availableActions,
      description: 'The tool to use for this request'
    },
    justification: {
      type: 'string',
      description: 'Brief explanation of why this tool is appropriate'
    },
    instructions: {
      type: 'string',
      description: 'Detailed instructions and input for the tool to execute'
    },
    notes: {
      type: 'string',
      description: 'Additional context or observations relevant to the task'
    }
  };

  // Collect properties from all available action input schemas
  for (const actionName of availableActions) {
    const action = actionsRegistry[actionName];
    if (action?.input_schema?.properties) {
      for (const [key, prop] of Object.entries(action.input_schema.properties)) {
        // Don't override base properties
        if (!properties[key]) {
          properties[key] = prop;
        }
      }
    }
  }

  return {
    type: 'object',
    properties,
    required: ['tool', 'justification', 'instructions', 'user_message'],
    additionalProperties: false
  };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms))
  ]);
}
