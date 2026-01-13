/**
 * Summary action - stop action that summarizes conversation messages
 * Uses two-stage LLM: first generates a tailored system prompt, then extracts/summarizes
 */

/**
 * Action name constant
 */
export const SUMMARY_TOOL = 'SUMMARY_TOOL';

/**
 * System prompt for generating the extraction prompt
 */
const PROMPT_GENERATOR_SYSTEM = `You are an expert at creating system prompts that guide LLMs to extract and summarize relevant information from conversation data.

Your goal is to create a system prompt that:
1. Focuses on information that directly answers the user's intent
2. Eliminates redundancy and repetition
3. Preserves all relevant details and context
4. Retains information that may be useful for related follow-up questions

The system prompt you create will be used by another LLM to process the conversation messages and extract only what matters to the user.`;

/**
 * SUMMARY_TOOL action
 * Extracts and summarizes conversation messages when objective is achieved
 * This is a "stop action" that ends the agentic loop with summarized results
 */
export const summaryAction = {
  name: SUMMARY_TOOL,
  description: 'Extracts and summarizes conversation messages when objective is achieved and results need to be returned to user. Best for: formatting final results, condensing collected information into user-friendly output, removing intermediate steps and keeping only relevant data.',
  examples: [
    'Summarize what we found',
    'Give me the final results'
  ],
  input_schema: {
    type: 'object',
    properties: {
      justification: {
        type: 'string',
        description: 'The justification for summarization'
      },
      user_intent: {
        type: 'string',
        description: 'The original user intent/question to focus the summary on'
      }
    },
    required: ['justification'],
    additionalProperties: false
  },
  steps: [
    {
      // First LLM step - generate a tailored extraction prompt
      type: 'llm',
      system_prompt: PROMPT_GENERATOR_SYSTEM,
      message: `Create a system prompt for extracting relevant information from data present, remove irrelevant information. Avoid repetition, and keep all relevant information.
This system prompt will be given to LLM to extract information from data present. You do not need to extract information, but only create a system prompt which is relevant to this data.

{{#user_intent}}User intent: {{user_intent}}{{/user_intent}}

<messages>
{{messages}}
</messages>`,
      intelligence: 'LOW',
      output_schema: {
        type: 'object',
        properties: {
          extraction_prompt: {
            type: 'string',
            description: 'System prompt for extracting information'
          }
        },
        required: ['extraction_prompt'],
        additionalProperties: false
      }
    },
    {
      // Second LLM step - extract and summarize using the generated prompt
      type: 'llm',
      system_prompt: '{{extraction_prompt}}',
      message: `Extract and summarize the relevant information. Focus on data that directly addresses the user's intent.

<messages>
{{messages}}
</messages>

In your response:
1. 'message' field: Provide a clean, user-friendly summary of the relevant information with no redundancy
2. 'method' field: Briefly describe the steps taken to gather this data (2-3 lines for bookkeeping purposes)`,
      intelligence: 'MEDIUM',
      output_schema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Summary of the messages'
          },
          method: {
            type: 'string',
            description: 'Brief description of steps taken to gather this data'
          }
        },
        required: ['message', 'method'],
        additionalProperties: false
      }
    }
  ]
};
