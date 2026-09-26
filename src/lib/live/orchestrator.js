import { runLiveScenario } from '../verify/live-demo.js';

const OPTIONAL_PACKAGES = ['@langchain/langgraph', '@langchain/core', 'zod'];

function missingOptionalFramework(error) {
  return error?.code === 'ERR_MODULE_NOT_FOUND'
    && OPTIONAL_PACKAGES.some((name) => String(error.message).includes(name));
}

export async function runLiveScenarioOrchestrated(id, options = {}) {
  try {
    const { runLiveScenarioLangGraph } = await import('./langgraph.js');
    return await runLiveScenarioLangGraph(id, options);
  } catch (error) {
    if (!missingOptionalFramework(error)) throw error;
    options.onEvent?.({
      type: 'orchestration',
      mode: 'fallback',
      engine: 'PRAXIS native',
      framework: null,
      nodes: ['extractor', 'retriever', 'verifier', 'judge'],
      reason: 'Optional LangGraph demo packages are not installed.',
    });
    return runLiveScenario(id, options);
  }
}
