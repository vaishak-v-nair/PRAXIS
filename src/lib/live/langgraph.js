import { END, START, StateGraph, StateSchema } from '@langchain/langgraph';
import * as z from 'zod';
import { createLiveExecution } from '../verify/live-demo.js';

const LiveState = new StateSchema({
  manifestObject: z.unknown().optional(),
  evidence: z.unknown().optional(),
  result: z.unknown().optional(),
  final: z.unknown().optional(),
});

export const LIVE_GRAPH = Object.freeze({
  engine: 'LangGraph.js',
  framework: '@langchain/langgraph',
  nodes: Object.freeze(['extractor', 'retriever', 'verifier', 'judge']),
  edges: Object.freeze([
    Object.freeze(['START', 'extractor']),
    Object.freeze(['extractor', 'retriever']),
    Object.freeze(['retriever', 'verifier']),
    Object.freeze(['verifier', 'judge']),
    Object.freeze(['judge', 'END']),
  ]),
});

export function compileLiveGraph(nodes) {
  return new StateGraph(LiveState)
    .addNode('extractor', nodes.extractor)
    .addNode('retriever', nodes.retriever)
    .addNode('verifier', nodes.verifier)
    .addNode('judge', nodes.judge)
    .addEdge(START, 'extractor')
    .addEdge('extractor', 'retriever')
    .addEdge('retriever', 'verifier')
    .addEdge('verifier', 'judge')
    .addEdge('judge', END)
    .compile();
}

export async function runLiveScenarioLangGraph(id, options = {}) {
  const execution = createLiveExecution(id, options);
  options.onEvent?.({ type: 'orchestration', mode: 'framework', ...LIVE_GRAPH });
  try {
    const state = await compileLiveGraph(execution.nodes).invoke({});
    return execution.finish(state);
  } finally {
    execution.cleanup();
  }
}
