/**
 * Template rendering system for orchestrator
 * Provides Mustache-like template rendering for parameterized prompts and messages
 */

/**
 * Simple template renderer that replaces {{variable}} patterns with context values
 * Supports:
 * - {{variable}} - simple variable substitution
 * - {{#variable}}content{{/variable}} - conditional block (renders if variable is truthy)
 *
 * @param {string} template - Template string with {{variable}} placeholders
 * @param {Object} context - Context object with variable values
 * @returns {string} Rendered template
 */
export function renderTemplate(template, context) {
  if (typeof template !== 'string') {
    return template;
  }

  // First, handle conditional blocks {{#var}}...{{/var}}
  let result = template.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, key, content) => {
    const trimmedKey = key.trim();
    const value = getNestedProperty(context, trimmedKey);

    // Only render content if value exists and is truthy
    if (value) {
      return renderTemplate(content, context);
    }
    return '';
  });

  // Then replace {{variable}} with context values
  result = result.replace(/\{\{([^#/}][^}]*)\}\}/g, (match, key) => {
    const trimmedKey = key.trim();

    // Support nested properties like {{user.name}}
    const value = getNestedProperty(context, trimmedKey);

    return value !== undefined ? String(value) : match;
  });

  return result;
}

/**
 * Get nested property from object using dot notation
 * @param {Object} obj - Object to get property from
 * @param {string} path - Dot-separated path (e.g., "user.name")
 * @returns {*} Property value or undefined
 */
function getNestedProperty(obj, path) {
  return path.split('.').reduce((current, prop) => {
    return current?.[prop];
  }, obj);
}

/**
 * Recursively resolve system prompts
 * System prompts can be strings or LLMConfig objects that generate prompts
 * @param {string|Object} systemPrompt - System prompt template or LLMConfig
 * @param {Object} context - Current execution context
 * @param {Function} generator - LLM generator function
 * @returns {Promise<string>} Resolved system prompt
 */
export async function resolveSystemPrompt(systemPrompt, context, generator) {
  // Simple string template
  if (typeof systemPrompt === 'string') {
    return renderTemplate(systemPrompt, context);
  }

  // LLMConfig - generate system prompt dynamically
  if (systemPrompt && typeof systemPrompt === 'object') {
    // Recursively resolve the meta system prompt
    const metaSystemPrompt = await resolveSystemPrompt(
      systemPrompt.system_prompt,
      context,
      generator
    );

    // Generate the actual system prompt using LLM
    const result = await generator({
      messages: [
        { role: 'system', content: metaSystemPrompt },
        { role: 'user', content: renderTemplate(systemPrompt.message, context) }
      ],
      intelligence: systemPrompt.intelligence || 'MEDIUM',
      schema: {
        type: 'object',
        properties: {
          system_description: {
            type: 'string',
            description: 'Generated system prompt'
          }
        },
        required: ['system_description'],
        additionalProperties: false
      }
    });

    return result.system_description;
  }

  return String(systemPrompt);
}
