/**
 * Action executor - Params in, result out
 */
import Mustache from 'mustache';
import logger from './logger.js';
import { getBrowserStateBundle } from './browser-state.js';
import { generate } from './llm.js';
import { actionsRegistry } from './actions/index.js';

const STEP_TIMEOUT_MS = 20000;
const LLM_TIMEOUT_MS = 40000;

/**
 * Resolve system prompts - can be strings or LLMConfig objects that generate prompts dynamically
 */
async function resolveSystemPrompt(systemPrompt, context) {
  if (typeof systemPrompt === 'string') {
    return Mustache.render(systemPrompt, context);
  }

  if (systemPrompt && typeof systemPrompt === 'object') {
    const metaSystemPrompt = await resolveSystemPrompt(systemPrompt.system_prompt, context);
    const result = await generate({
      messages: [
        { role: 'system', content: metaSystemPrompt },
        { role: 'user', content: Mustache.render(systemPrompt.message, context) }
      ],
      intelligence: systemPrompt.intelligence || 'MEDIUM',
      schema: {
        type: 'object',
        properties: {
          system_description: { type: 'string', description: 'Generated system prompt' }
        },
        required: ['system_description'],
        additionalProperties: false
      }
    });
    return result.system_description;
  }

  return String(systemPrompt);
}

function validateParams(params, schema) {
  const errors = [];
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in params) || params[field] === undefined) errors.push(`Missing required field: ${field}`);
    }
  }
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (key in params && params[key] !== undefined) {
        const v = params[key], t = prop.type;
        if (t === 'string' && typeof v !== 'string') errors.push(`Field ${key} must be a string`);
        else if (t === 'number' && typeof v !== 'number') errors.push(`Field ${key} must be a number`);
        else if (t === 'boolean' && typeof v !== 'boolean') errors.push(`Field ${key} must be a boolean`);
        else if (t === 'array' && !Array.isArray(v)) errors.push(`Field ${key} must be an array`);
        else if (t === 'object' && (typeof v !== 'object' || Array.isArray(v))) errors.push(`Field ${key} must be an object`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export async function executeAction(action, params = {}) {
  logger.info(`Action: ${action.name}`, { params });

  if (action.input_schema) {
    const validation = validateParams(params, action.input_schema);
    if (!validation.valid) {
      const error = new Error(`Validation failed for ${action.name}: ${validation.errors.join(', ')}`);
      error.isValidationError = true;
      error.validationErrors = validation.errors;
      logger.error(error.message, { errors: validation.errors });
      throw error;
    }
  }

  let result = null;
  for (let i = 0; i < action.steps.length; i++) {
    try {
      result = await executeStep(action.steps[i], params, result);
    } catch (error) {
      logger.error(`Step ${i + 1} failed: ${action.name}`, { error: error.message });
      throw new Error(`Step ${i + 1} failed: ${error.message}`);
    }
  }
  logger.info(`Action complete: ${action.name}`);
  return result;
}

async function executeStep(step, params, prevResult) {
  if (typeof step === 'function') {
    return withTimeout(step(params, prevResult), STEP_TIMEOUT_MS);
  }
  if (step.type === 'llm') {
    return executeLLMStep(step, params, prevResult);
  }
  throw new Error(`Unknown step type: ${JSON.stringify(step)}`);
}

async function executeLLMStep(step, params, prevResult = {}) {
  const { system_prompt, message, intelligence, output_schema, tool_choice } = step;

  // Validate: must have either output_schema or tool_choice
  if (!output_schema && !tool_choice) {
    throw new Error('LLM step must have either output_schema or tool_choice');
  }

  // Merge previous step result into template context for chained LLM calls
  const templateCtx = { ...params, ...prevResult };

  // Inject available_tools and decision_guide for actions with tool_choice
  if (tool_choice?.available_actions) {
    templateCtx.available_tools = buildToolDescriptions(tool_choice.available_actions, tool_choice.stop_action);
    templateCtx.decision_guide = buildDecisionGuide(tool_choice.available_actions);
  }

  const resolvedSystemPrompt = await resolveSystemPrompt(system_prompt, templateCtx);
  const resolvedMessage = Mustache.render(message, templateCtx);

  if (!tool_choice) {
    // Single LLM call - use structured output schema
    const messages = await insertBrowserState([
      { role: 'system', content: resolvedSystemPrompt },
      { role: 'user', content: resolvedMessage }
    ]);

    return withTimeout(
      generate({ messages, intelligence: intelligence || 'MEDIUM', schema: output_schema }),
      LLM_TIMEOUT_MS
    );
  }
  return executeMultiTurn(resolvedSystemPrompt, resolvedMessage, tool_choice, intelligence);
}

async function executeMultiTurn(systemPrompt, initialMessage, choice, intelligence) {
  const { available_actions, stop_action, max_iterations = 5 } = choice;
  const conversation = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: initialMessage }
  ];
  const tools = buildTools(available_actions);

  for (let i = 0; i < max_iterations; i++) {
    logger.info(`Turn ${i + 1}/${max_iterations}`);
    const messagesWithBrowser = await insertBrowserState(conversation);

    const llmResponse = await withTimeout(
      generate({
        messages: messagesWithBrowser,
        intelligence: intelligence || 'MEDIUM',
        tools
      }),
      LLM_TIMEOUT_MS
    );

    if (!llmResponse.tool_calls?.length) {
      // LLM returned text instead of tool call - add to conversation and prompt again
      logger.warn('LLM returned text instead of tool call, prompting to use tools');
      conversation.push({
        role: 'assistant',
        content: llmResponse.content || 'I need to use a tool to help with this.'
      });
      conversation.push({
        role: 'user',
        content: 'Please call one of the available tools to proceed.'
      });
      continue;
    }

    const toolCall = llmResponse.tool_calls[0];
    const toolName = toolCall.function.name;
    let toolArgs;
    try {
      toolArgs = JSON.parse(toolCall.function.arguments || '{}');
    } catch (e) {
      logger.error('Invalid JSON in tool arguments', { raw: toolCall.function.arguments, error: e.message });
      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: 'Invalid JSON in tool arguments' })
      });
      continue;
    }

    logger.info(`Tool call: ${toolName}`, { id: toolCall.id });

    // Store assistant message with tool_calls
    conversation.push({
      role: 'assistant',
      content: null,
      tool_calls: llmResponse.tool_calls
    });

    const targetAction = actionsRegistry[toolName];
    if (!targetAction) {
      // Tool not found - send error as tool response
      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: `Action not found: ${toolName}` })
      });
      continue;
    }

    const actionParams = pickParams(toolArgs, targetAction);
    if (toolName === stop_action) {
      actionParams.messages = JSON.stringify(conversation, null, 2);
    }

    try {
      const result = await executeAction(targetAction, actionParams);
      if (toolName === stop_action) return unwrapStopResult(result);

      // Send result as tool response
      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result, null, 2)
      });
    } catch (error) {
      const errorContent = error.isValidationError
        ? { error: 'Validation failed', details: error.validationErrors }
        : { error: error.message };

      logger.warn(`${toolName} failed`, errorContent);

      // Send error as tool response
      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(errorContent)
      });
    }

    // Trim conversation if too long (keep system + first user + last 8 messages)
    if (conversation.length > 12) {
      conversation.splice(2, conversation.length - 10);
    }
  }

  logger.error('Max iterations reached, invoking stop action');

  const syntheticToolCallId = `max-iter-${Date.now()}`;
  const stopResponse = 'I was unable to complete the task within the allowed number of steps. Here is what I accomplished so far.';

  conversation.push({
    role: 'assistant',
    content: null,
    tool_calls: [{
      id: syntheticToolCallId,
      type: 'function',
      function: {
        name: stop_action,
        arguments: JSON.stringify({ response: stopResponse, justification: 'Maximum iterations reached' })
      }
    }]
  });

  const result = await executeAction(actionsRegistry[stop_action], {
    response: stopResponse,
    messages: JSON.stringify(conversation, null, 2)
  });
  return unwrapStopResult(result);
}

function pickParams(source, actionDef) {
  if (!actionDef.input_schema?.properties) return {};
  return Object.fromEntries(
    Object.keys(actionDef.input_schema.properties).filter(k => k in source).map(k => [k, source[k]])
  );
}

async function insertBrowserState(conversation) {
  const browserState = await getBrowserStateBundle();
  const copy = conversation.map(m => ({ ...m }));
  const lastUserIdx = copy.findLastIndex(m => m.role === 'user');
  const browserMsg = { role: 'user', content: `Current Browser State:\n${browserState}` };
  lastUserIdx > 0 ? copy.splice(lastUserIdx, 0, browserMsg) : copy.push(browserMsg);
  return copy;
}

/**
 * Convert action definitions to OpenRouter tools format
 * @param {string[]} availableActions - Action names to include
 * @returns {Array} Tools array for OpenRouter
 */
function buildTools(availableActions) {
  return availableActions.map(name => {
    const action = actionsRegistry[name];
    if (!action) return null;

    // Clone the input_schema and add common fields
    const parameters = {
      type: 'object',
      properties: {
        justification: { type: 'string', description: 'Why this tool is appropriate' },
        instructions: { type: 'string', description: 'Instructions for the tool' },
        ...(action.input_schema?.properties || {})
      },
      required: ['justification', 'instructions', ...(action.input_schema?.required || [])],
      additionalProperties: false
    };

    return {
      type: 'function',
      function: {
        name: action.name,
        description: action.description || `Execute ${action.name}`,
        parameters
      }
    };
  }).filter(Boolean);
}

/**
 * Build formatted tool descriptions from action names
 * Used for dynamic system prompt generation in actions with choice
 */
function buildToolDescriptions(actionNames, stopAction) {
  return actionNames.map((name, index) => {
    const action = actionsRegistry[name];
    const stopMarker = name === stopAction ? ' [STOP]' : '';
    const requiredFields = action?.input_schema?.required?.length
      ? `\n   Requires: ${action.input_schema.required.join(', ')}`
      : '';
    return `${index + 1}. **${name}**${stopMarker}: ${action?.description || 'No description'}${requiredFields}`;
  }).join('\n\n');
}

/**
 * Build decision guide from action examples
 * Maps example queries to their target actions
 */
function buildDecisionGuide(actionNames) {
  const lines = [];
  for (const name of actionNames) {
    const action = actionsRegistry[name];
    if (action?.examples) {
      for (const example of action.examples) {
        lines.push(`- "${example}" → ${name}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Unwrap stop action result to extract user-facing message
 * Convention: check for 'message' field first, then 'response', else stringify
 */
function unwrapStopResult(result) {
  if (typeof result === 'string') return result;
  return result?.message || result?.response || JSON.stringify(result);
}

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms))
]);
