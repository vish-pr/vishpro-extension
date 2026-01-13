/**
 * Actions registry - central export for all actions
 */
import { browserActions, browserActionRouter } from './browser-actions.js';
import { summaryAction, SUMMARY_TOOL } from './summary-action.js';
import { llmAction, LLM_TOOL } from './llm-action.js';
import { routerAction, BROWSER_ROUTER } from './router-action.js';
import logger from '../logger.js';

// Re-export constants
export { SUMMARY_TOOL } from './summary-action.js';
export { LLM_TOOL } from './llm-action.js';
export { BROWSER_ROUTER } from './router-action.js';
export { BROWSER_ACTION } from './browser-actions.js';

// Build registry from all actions
const allActions = [
  ...browserActions,
  summaryAction,
  llmAction,
  routerAction,
  browserActionRouter
];

export const actionsRegistry = Object.fromEntries(
  allActions.map(a => [a.name, a])
);

logger.info(`Loaded ${Object.keys(actionsRegistry).length} actions`);

export const getAction = name => actionsRegistry[name];
