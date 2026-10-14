"""Pressure-test source-only intake on the real PRAXIS checkout, without saved jobs.

No provider, network advisory, project command, or source apply is started.
Prints only bounded counts and evidence states; the temporary copy is removed.
"""
import json
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from regen import review, scanner


project = Path(__file__).resolve().parents[3]
cancelled = threading.Event()
started = time.monotonic()
with tempfile.TemporaryDirectory(prefix='praxis-self-review-') as directory:
    print('Preparing bounded isolated source copy...', flush=True)
    prepared = scanner.prepare_project(str(project), Path(directory) / 'job', lambda _: None, cancelled)
    source_copy = Path(prepared['path'])
    for required in ('src/cli.js', 'apps/workbench/backend/regen/app.py', 'test/ci-scripts.test.js'):
        if not (source_copy / required).is_file():
            raise AssertionError(f'Core project source missing from bounded snapshot: {required}')
    print('Inspecting source copy without commands or providers...', flush=True)
    scanned = scanner.scan_project(source_copy, lambda _: None, cancelled, external_checks=False,
                                   source_scope=prepared['source_scope'])
    print('Building deterministic assessment...', flush=True)
    plan = review.project_plan(source_copy, prepared.get('commands', []), prepared['praxis_memory_available'])
    findings = [*prepared.get('findings', []), *scanned.get('findings', [])]
    job = {**scanned, 'findings': findings, 'plan': plan, 'checks': [], 'status': 'complete'}
    assessment = review.assessment(job)
    local_source = next(item for item in scanned['coverage'] if item['name'] == 'Local source inspection')
    print(json.dumps({'eligible_files': scanned.get('files_scanned'), 'findings': len(findings),
                      'coverage_records': len(scanned.get('coverage', [])),
                      'source_inspection': local_source['status'],
                      'source_omitted_files': prepared['source_scope'].get('omitted_files', 0),
                      'nested_repositories_excluded': prepared['source_scope'].get('excluded_nested_repositories', 0),
                      'implementation': assessment['implementation']['status'],
                      'readiness': assessment['readiness']['status'],
                      'model_calls': 0, 'project_commands': 0,
                      'source_unchanged': scanner.fingerprint(project) == prepared['source_fingerprint'],
                      'elapsed_seconds': round(time.monotonic() - started, 2)}))
