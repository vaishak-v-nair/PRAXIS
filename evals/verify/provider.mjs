import { runGoldenCase } from './cases.mjs';

export default class PraxisGoldenProvider {
  id() {
    return 'praxis-verify-golden';
  }

  async callApi(prompt, context) {
    const caseId = context?.vars?.caseId || String(prompt).trim();
    try {
      return { output: JSON.stringify(await runGoldenCase(caseId)) };
    } catch (error) {
      return { error: error.stack || error.message };
    }
  }
}