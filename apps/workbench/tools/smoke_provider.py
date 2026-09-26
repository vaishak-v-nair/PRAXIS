"""Validate configured access with a tiny budgeted request; never print credentials."""
import json
import os
import sys
import threading
from pathlib import Path
if len(sys.argv) > 1:
    os.environ['REGEN_PROVIDER'] = sys.argv[1]
if len(sys.argv) > 2:
    os.environ['REGEN_MODEL'] = sys.argv[2]
if len(sys.argv) > 4:
    os.environ['REGEN_INPUT_PRICE'] = sys.argv[3]
    os.environ['REGEN_OUTPUT_PRICE'] = sys.argv[4]
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from regen.provider import Budget, Model, ProviderError
budget = Budget(min(0.20, float(os.getenv('REGEN_SMOKE_BUDGET', '0.20'))))
try:
    model = Model(budget, threading.Event())
    response = model.call([{'role': 'user', 'content': 'Return JSON only: {"status":"ok"}'}], max_tokens=128)
    print(json.dumps({'provider': model.provider, 'model': model.model, 'response': response.get('content'), 'cost': budget.spent}))
except ProviderError as error:
    print(json.dumps({'verified': False, 'error': str(error), 'cost': budget.spent}))
    sys.exit(1)
