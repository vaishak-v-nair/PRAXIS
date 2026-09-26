"""Explicit, bounded live probe. Keys and project source never leave in logs.

Benchmarks tiny structured responses, not coding quality or remaining balances.
Run with --select to persist the fastest working candidate for the workbench.
"""
import argparse
import json
import os
import statistics
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env', override=False)
load_dotenv(ROOT.parents[1] / '.env', override=False)
# Conservative budgeting rates; they are estimates, not provider invoices.
CANDIDATES = [
    ('groq', 'openai/gpt-oss-20b', 'GROQ_API_KEY'),
    ('nvidia', 'openai/gpt-oss-20b', 'NVIDIA_NIM_KEY'),
    ('gemini', 'gemini-2.5-flash', 'GEMINI_API_KEY'),
    ('openrouter', 'google/gemini-2.5-flash', 'OPENROUTER_API_KEY'),
]


def probe(candidate):
    provider, model, key = candidate
    result = {'provider': provider, 'model': model, 'available': False}
    if not os.getenv(key):
        result['reason'] = 'key-missing'
        return result
    samples = []
    cost = 0
    for _ in range(2):
        started = time.perf_counter()
        env = dict(os.environ, REGEN_SMOKE_BUDGET='0.02')
        try:
            child = subprocess.run([sys.executable, '-B', str(ROOT / 'tools/smoke_provider.py'), provider, model, '0.000002', '0.000006'],
                                   env=env, capture_output=True, text=True, timeout=40)
            data = json.loads(child.stdout)
            cost += data.get('cost', 0)
            if child.returncode or json.loads(data.get('response') or '{}') != {'status': 'ok'}:
                result['reason'] = 'request-or-json-validation-failed'
                break
            samples.append(round(time.perf_counter() - started, 3))
        except subprocess.TimeoutExpired:
            result['reason'] = 'timeout-billing-unknown'
            break
        except (ValueError, OSError):
            result['reason'] = 'probe-failed'
            break
    result.update(samples_seconds=samples, accounted_cost=cost)
    if len(samples) == 2:
        result.update(available=True, median_seconds=statistics.median(samples))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--select', action='store_true')
    args = parser.parse_args()
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(probe, CANDIDATES))
    working = sorted((r for r in results if r['available']), key=lambda r: r['median_seconds'])
    report = {'results': results, 'winner': working[0] if working else None,
              'scope': 'Two tiny JSON calls per candidate; end-to-end latency includes catalog verification. Access confirmed, remaining credit not inferred.'}
    if args.select and working:
        winner = working[0]
        state = ROOT / '.regen'
        state.mkdir(exist_ok=True)
        (state / 'model-speed-report.json').write_text(json.dumps(report, indent=2), 'utf-8')
        (state / 'provider.json').write_text(json.dumps({'provider': winner['provider'], 'model': winner['model'], 'input_price': 0.000002, 'output_price': 0.000006}), 'utf-8')
        report['selected'] = True
    print(json.dumps(report, indent=2))
    sys.exit(0 if working else 1)
