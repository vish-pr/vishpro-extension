/**
 * Final response action - terminates the task with a user-facing answer
 * Uses two-stage LLM: first generates a tailored system prompt, then extracts/summarizes
 */

/**
 * Action name constant
 */
export const FINAL_RESPONSE = 'FINAL_RESPONSE';

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
 * FINAL_RESPONSE action
 * Produces the final user-facing answer and terminates the task
 */
export const finalResponseAction = {
  name: FINAL_RESPONSE,
  description: `MANDATORY FINAL STEP.

This tool MUST be called once sufficient information has been obtained
from previous tool calls. It produces the final user-facing answer.

Rules:
- This tool TERMINATES the task.
- After calling FINAL_RESPONSE, no other tools may be called.
- Do NOT call this tool until the objective is fully achieved.
- If the answer can be given to the user, this tool MUST be used.

Purpose:
- Format and present the final result to the user
- Remove internal reasoning and intermediate steps
- Convert tool outputs into a clean, user-readable response`,
  examples: [
    'Give me the final answer',
    'Provide the result to the user',
    'Return the completed response',
    'Deliver the outcome',
    'The task is complete — show the result'
  ],
  input_schema: {
    type: 'object',
    properties: {
      justification: {
        type: 'string',
        description: 'Why the task objective is now complete and ready to be delivered'
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

<messages>
{{{messages}}}
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
      system_prompt: '{{{extraction_prompt}}}',
      message: `Extract and summarize the relevant information. Focus on data that directly addresses the user's intent.

<messages>
{{{messages}}}
</messages>

In your response:
1. 'final_answer' field: Provide a clean, user-friendly summary of the relevant information with no redundancy
2. 'method' field: Briefly describe the steps taken to gather this data (2-3 lines for bookkeeping purposes)`,
      intelligence: 'MEDIUM',
      output_schema: {
        type: 'object',
        properties: {
          final_answer: {
            type: 'string',
            description: 'The complete, polished answer to present to the user'
          },
          method: {
            type: 'string',
            description: 'Brief description of steps taken to gather this data'
          }
        },
        required: ['final_answer', 'method'],
        additionalProperties: false
      }
    }
  ]
};
