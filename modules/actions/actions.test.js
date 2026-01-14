/**
 * Action validation tests
 * Run: node modules/actions/actions.test.js
 */
import { actionsRegistry, BROWSER_ROUTER } from './index.js';

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed++;
  }
}

/**
 * Extract mustache variable names from a template string
 * Handles: {{var}}, {{#var}}, {{^var}}, {{/var}}
 * Ignores: {{.}} (current context in loops)
 */
function extractMustacheVars(template) {
  if (!template || typeof template !== 'string') return new Set();
  const vars = new Set();
  // Match {{var}}, {{#var}}, {{^var}}, {{/var}} but not {{.}}
  const regex = /\{\{[#^/]?([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
  let match;
  while ((match = regex.exec(template)) !== null) {
    vars.add(match[1]);
  }
  return vars;
}

// BROWSER_ROUTER must exist (used as entry point in background.js)
assert(actionsRegistry[BROWSER_ROUTER], `BROWSER_ROUTER "${BROWSER_ROUTER}" not found in registry`);

// Validate all actions
for (const [name, action] of Object.entries(actionsRegistry)) {
  // Actions must have required fields
  assert(action.name === name, `${name}: action.name must match registry key`);
  assert(action.description, `${name}: action must have description`);
  assert(action.input_schema, `${name}: action must have input_schema`);
  assert(Array.isArray(action.steps) && action.steps.length > 0, `${name}: action must have steps array`);

  // Track available variables: start with action's input_schema properties
  const availableVars = new Set(Object.keys(action.input_schema?.properties || {}));

  for (const [i, step] of (action.steps || []).entries()) {
    const stepId = `${name}.steps[${i}]`;

    // Validate step type
    const isFunction = typeof step === 'function';
    const isLLM = step.type === 'llm';
    assert(
      isFunction || isLLM,
      `${stepId}: invalid step type (must be function or llm)`
    );

    // Validate LLM step has either output_schema or tool_choice, but not both
    if (isLLM) {
      const hasSchema = !!step.output_schema;
      const hasChoice = !!step.tool_choice;
      assert(
        hasSchema || hasChoice,
        `${stepId}: LLM step must have either output_schema or tool_choice`
      );
      assert(
        !(hasSchema && hasChoice),
        `${stepId}: LLM step cannot have both output_schema and tool_choice`
      );

      // Intelligence level must be explicitly specified
      assert(
        step.intelligence,
        `${stepId}: LLM step must explicitly specify intelligence level`
      );

      // Validate mustache variables are available
      const stepVars = new Set(availableVars);
      // Executor injects these globally
      stepVars.add('messages');
      // Executor injects these for tool_choice steps
      if (hasChoice) {
        stepVars.add('available_tools');
        stepVars.add('decision_guide');
      }

      const usedVars = new Set([
        ...extractMustacheVars(step.system_prompt),
        ...extractMustacheVars(step.message)
      ]);

      for (const v of usedVars) {
        assert(
          stepVars.has(v),
          `${stepId}: mustache variable "{{${v}}}" not available (available: ${[...stepVars].join(', ')})`
        );
      }

      // Add output_schema properties to available vars for next steps
      if (hasSchema && step.output_schema.properties) {
        for (const key of Object.keys(step.output_schema.properties)) {
          availableVars.add(key);
        }
      }
    }

    // Validate tool_choice config
    if (step.tool_choice) {
      const { available_actions, stop_action, max_iterations } = step.tool_choice;

      assert(stop_action, `${stepId}: tool_choice.stop_action is required`);
      assert(
        typeof max_iterations === 'number' && max_iterations > 0,
        `${stepId}: tool_choice.max_iterations must be explicitly specified`
      );

      assert(
        available_actions?.includes(stop_action),
        `${stepId}: stop_action "${stop_action}" must be in available_actions`
      );

      for (const actionName of available_actions || []) {
        assert(
          actionsRegistry[actionName],
          `${stepId}: available_action "${actionName}" not found in registry`
        );
      }
    }
  }
}

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log('All action validations passed');
}
