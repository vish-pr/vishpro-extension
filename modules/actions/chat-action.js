/**
 * Chat action - the stop action that generates final responses
 * Uses LLM step so browser state is automatically injected by executor
 */

/**
 * Action name constant
 */
export const CHAT_RESPONSE = 'CHAT_RESPONSE';

/**
 * System prompt for response generation
 */
const CHAT_SYSTEM_PROMPT = `You are a helpful browser automation assistant. The user asked you to perform a task, and you've completed some actions.

Your job is to:
1. Summarize what you did
2. Present any relevant information you found from the browser state
3. Indicate if the task was completed successfully or if there were issues
4. Be concise but informative

If page content was extracted, include relevant excerpts in your response.
If you clicked something or filled a form, confirm what you did.
If navigation occurred, mention where you went.
Be natural and conversational.`;

/**
 * CHAT_RESPONSE action
 * Generates a natural language response to the user based on accumulated context
 * This is the "stop action" that ends the agentic loop
 */
export const chatAction = {
  name: CHAT_RESPONSE,
  description: 'Respond directly to the user with a natural language message. Use when: task is complete and you need to report results, the request is conversational or general knowledge, you need to ask the user for clarification, or no browser interaction is needed.',
  examples: [
    'How are you?',
    'What can you do?'
  ],
  input_schema: {
    type: 'object',
    properties: {
      user_message: {
        type: 'string',
        description: 'Original user message'
      },
      instructions: {
        type: 'string',
        description: 'Detailed instructions for generating the response (from LLM)'
      },
      justification: {
        type: 'string',
        description: 'Why responding now (e.g., task complete, need clarification, error occurred)'
      },
      notes: {
        type: 'string',
        description: 'Any additional notes or context'
      },
      conversation_history: {
        type: 'string',
        description: 'Complete history of actions taken in this conversation thread'
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
      // LLM step - browser state injected automatically by executor
      llm: {
        system_prompt: CHAT_SYSTEM_PROMPT,
        message: `Generate a response for the user.

Original request: "{{user_message}}"
{{#conversation_history}}

Complete conversation history (all actions taken):
{{conversation_history}}
{{/conversation_history}}
{{#instructions}}
Instructions: {{instructions}}
{{/instructions}}
{{#justification}}
Reason for responding: {{justification}}
{{/justification}}
{{#notes}}
Notes: {{notes}}
{{/notes}}`,
        intelligence: 'MEDIUM',
        schema: {
          type: 'object',
          properties: {
            response: {
              type: 'string',
              description: 'Natural language response to the user'
            },
            success: {
              type: 'boolean',
              description: 'Whether the task was completed successfully'
            }
          },
          required: ['response', 'success'],
          additionalProperties: false
        }
      }
    }
  ]
};
