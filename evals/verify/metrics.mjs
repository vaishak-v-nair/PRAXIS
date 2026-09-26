import fs from 'node:fs';
import { GOLDEN_CASES, runGoldenCase } from './cases.mjs';

const baseline = JSON.parse(fs.readFileSync(new URL('./baseline.json', import.meta.url), 'utf8'));
const results = [];
for (const item of GOLDEN_CASES) results.push(await runGoldenCase(item.id));

let truePositive = 0;
let falseNegative = 0;
let falsePositive = 0;
for (const result of results) {
  const actuallyContradicted = result.expected === 'CONTRADICTED';
  const predictedContradicted = result.predicted === 'CONTRADICTED';
  if (actuallyContradicted && predictedContradicted) truePositive++;
  else if (actuallyContradicted) falseNegative++;
  else if (predictedContradicted) falsePositive++;
}
const recall = truePositive / Math.max(1, truePositive + falseNegative);
const precision = truePositive / Math.max(1, truePositive + falsePositive);
console.log('CONTRADICTED recall: ' + recall.toFixed(4) + ' (baseline ' + baseline.contradictedRecall.toFixed(4) + ')');
console.log('CONTRADICTED precision: ' + precision.toFixed(4) + ' (baseline ' + baseline.contradictedPrecision.toFixed(4) + ')');
for (const result of results) console.log(result.caseId + ': ' + result.predicted + ' (expected ' + result.expected + ')');
if (recall < baseline.contradictedRecall) {
  console.error('Catastrophic gate failed: CONTRADICTED recall regressed.');
  process.exit(1);
}
if (precision < baseline.contradictedPrecision) {
  console.error('Trust-friction gate failed: CONTRADICTED precision regressed.');
  process.exit(1);
}