import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { topologicalSort } from '../src/lib/jobs/dag.js';
import { BM25Index } from '../src/lib/retrieval/bm25.js';


const ITERATIONS = 10;
const DAG_NODES = 1000;

console.log('--- PRAXIS STRESS TEST ---\n');

// 1. Load Latency
const startLoad = performance.now();
import('../src/cli.js').then(() => {
  const endLoad = performance.now();
  console.log(`[1] Module Load Time: ${(endLoad - startLoad).toFixed(2)}ms (Target: <10ms for core)`);

  runTests();
}).catch(console.error);

async function runTests() {
  // 2. DAG Execution Stress
  const startDag = performance.now();
  const steps = [];
  for (let i = 0; i < DAG_NODES; i++) {
    steps.push({
      id: `job_${i}`,
      task: 'echo "test"',
      dependsOn: i > 0 ? [`job_${Math.floor(Math.random() * i)}`] : []
    });
  }
  
  const sortStart = performance.now();
  const sorted = topologicalSort(steps);
  const sortEnd = performance.now();
  console.log(`[2] DAG generated and topological sort for ${DAG_NODES} nodes: ${(sortEnd - sortStart).toFixed(2)}ms.`);
  console.log(`[2] Tiers count: ${sorted.tiers.length}`);
  // Note: executeDag actually spawns jobs, so spawning 1000 processes might crash windows.
  // We will instead test BM25 scale.

  // 3. BM25 Retrieval Scale
  const index = new BM25Index();
  const startBm25 = performance.now();
  for (let i = 0; i < 5000; i++) {
    index.addDocument(`doc_${i}`, `This is a test document ${i} with some random keywords praxis AI orchestration ${Math.random()}`);
  }
  const endBm25Add = performance.now();
  
  const searchStart = performance.now();
  const results = index.search('praxis AI', 5);
  const searchEnd = performance.now();
  
  console.log(`[3] BM25 indexing 5000 docs: ${(endBm25Add - startBm25).toFixed(2)}ms`);
  console.log(`[3] BM25 search time: ${(searchEnd - searchStart).toFixed(2)}ms`);

  // 4. CLI Execution Overhead
  let cliTotal = 0;
  for(let i=0; i<ITERATIONS; i++) {
    const s = performance.now();
    spawnSync('node', ['src/cli.js', '--help']);
    cliTotal += (performance.now() - s);
  }
  console.log(`[4] CLI execution overhead (Node + PRAXIS): ${(cliTotal / ITERATIONS).toFixed(2)}ms avg over ${ITERATIONS} runs`);

  console.log('\n--- STRESS TEST COMPLETE ---');
}
