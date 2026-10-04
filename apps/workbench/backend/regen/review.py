"""Evidence-backed project understanding and final engineering assessment.

Every displayed state is derived from stored inventory, coverage, finding, or
execution records. Model prose may add a finding, but never proves behavior.
"""
from pathlib import Path
import hashlib
import re

from .context import related_source_paths
from .scanner import safe_files


PLANNING_NAMES = re.compile(
    r'(?i)(?:^|/)(?:readme|roadmap|todo|plan|planning|architecture|design|spec|requirements|contributing|agents|claude)(?:[._-]|$)'
)
ENTRYPOINT_NAMES = {
    'main.py', 'app.py', 'server.py', 'manage.py', 'index.js', 'index.ts',
    'server.js', 'server.ts', 'main.js', 'main.ts', 'main.go', 'main.rs',
    'dockerfile', 'compose.yaml', 'compose.yml', 'docker-compose.yml',
}
LANGUAGE_SUFFIXES = {
    '.py': 'Python', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript',
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.go': 'Go', '.rs': 'Rust',
    '.java': 'Java', '.cs': 'C#', '.php': 'PHP', '.rb': 'Ruby',
}
DEPLOYMENT_NAMES = {
    'dockerfile', 'compose.yaml', 'compose.yml', 'docker-compose.yml',
    'vercel.json', 'netlify.toml', 'fly.toml', 'render.yaml', 'render.yml',
    'railway.json', 'app.yaml', 'serverless.yml', 'serverless.yaml',
    'procfile', 'wrangler.toml',
}
CI_NAMES = {'.gitlab-ci.yml', 'azure-pipelines.yml', 'bitbucket-pipelines.yml', 'jenkinsfile'}
OBSERVABILITY_MARKERS = ('sentry', 'opentelemetry', 'otel', 'prometheus', 'grafana', 'datadog', 'newrelic')
SOURCE_COVERAGE = {'Local source inspection', 'Python syntax', 'Python behavioral AST patterns',
                   'Python behavioral AST limit', 'Python parser resource limit', 'Format coverage',
                   'AI authorship and production data'}
SECURITY_COVERAGE = {'Built-in secret patterns', 'Semgrep', 'Gitleaks', 'TruffleHog',
                     'OSV dependencies', 'OSV dependency audit'}
AI_COVERAGE = {'AI contextual review', 'AI ensemble review'}
FAILURE_STATUSES = {'failed', 'timeout', 'cancelled'}
SUCCESS_STATUSES = {'passed', 'complete'}


def _operation_signals(files):
    deployment, ci, observability = [], [], []
    for name in files:
        lower, base = name.lower(), Path(name).name.lower()
        if (base in DEPLOYMENT_NAMES or lower.startswith(('deploy/', 'deployment/', 'k8s/', 'kubernetes/',
                                                          'helm/', 'terraform/', 'infra/'))):
            deployment.append(name)
        if lower.startswith('.github/workflows/') or base in CI_NAMES:
            ci.append(name)
        if any(marker in lower for marker in OBSERVABILITY_MARKERS):
            observability.append(name)
    return {'deployment_files': deployment[:50], 'ci_files': ci[:50],
            'observability_files': observability[:50]}


def project_plan(root, commands, memory_available=None):
    root = Path(root)
    files = [file.relative_to(root).as_posix() for file in safe_files(root)]
    tests = [name for name in files if any(part in {'test', 'tests', '__tests__'} for part in name.split('/'))
             or Path(name).stem in {'test', 'tests'} or Path(name).name.startswith('test_')
             or any(marker in name for marker in ('.test.', '.spec.'))]
    manifests = [name for name in files if Path(name).name in {
        'package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml'
    }]
    planning = [name for name in files if PLANNING_NAMES.search(name)]
    entrypoints = [name for name in files if Path(name).name.lower() in ENTRYPOINT_NAMES]
    languages = sorted({LANGUAGE_SUFFIXES[Path(name).suffix.lower()] for name in files
                        if Path(name).suffix.lower() in LANGUAGE_SUFFIXES})
    memory_available = ((root / '.praxis' / 'memory.md').is_file()
                        if memory_available is None else bool(memory_available))
    graph = related_source_paths(root, [], max_nodes=150, include_graph=True)
    return {'version': 3, 'files': len(files), 'manifests': manifests[:50],
            'test_files': tests[:50], 'test_file_count': len(tests),
            'operations': _operation_signals(files),
            'understanding': {
                'languages': languages,
                'entrypoints': entrypoints[:50],
                'planning_files': planning[:50],
                'commands_discovered': len(commands),
                'continuity': {
                    'status': 'available' if memory_available else 'not_detected',
                    'detail': ('Local PRAXIS project memory was detected. Its contents remain private and are not copied into the review snapshot or model context.'
                               if memory_available else 'No local PRAXIS memory was detected in this review copy. Source documentation is used for project understanding.'),
                },
            },
            'graph': graph,
            'stages': [
                {'name': 'Understand', 'detail': f'Indexed {len(files)} reviewable files and {len(graph.get("edges", []))} resolved local import relationships.'},
                {'name': 'Inspect', 'detail': 'Run bounded local scanners, then record each configured model review independently.'},
                {'name': 'Execute', 'detail': f'{len(commands)} project command(s) discovered. Project execution requires explicit authorization.'},
                {'name': 'Decide', 'detail': 'Trace every conclusion to inventory, scanner, finding, or execution evidence.'},
            ]}


def _check_detail(check, limit=500):
    return str(check.get('output') or check.get('detail') or check.get('status') or '')[:limit]


def _behavior_failure(check):
    """Incomplete setup or execution cannot establish a behavioral contradiction."""
    return (check.get('status') == 'failed' and check.get('kind') not in {'setup', 'infrastructure'}
            and not re.search(r'(?:command not found|: not found|No module named|Cannot find module|OCI runtime exec failed|sh:\s*\d+:\s*[^:\n]+:\s*Permission denied)',
                              _check_detail(check, 24000), re.I))


def _evidence(kind, label, status='observed', detail='', source=None):
    item = {'kind': kind, 'label': str(label)[:240], 'status': str(status or 'observed')[:40]}
    if detail:
        item['detail'] = str(detail)[:600]
    if source:
        item['source'] = str(source)[:500]
    return item


def _dimension(identifier, label, status, detail, evidence=None, limits=None):
    evidence = evidence or []
    return {'id': identifier, 'label': label, 'status': status, 'detail': detail,
            'evidence_count': len(evidence), 'evidence': evidence[:30],
            'limits': [str(item)[:600] for item in (limits or [])[:10]]}


def _command_class(check):
    text = str(check.get('name', '')).lower()
    if re.search(r'(?:^|\s|:)(?:test|tests|pytest|unittest|jest|vitest|mocha|ava|rspec)(?:$|\s|:)', text) or 'go test' in text or 'cargo test' in text:
        return 'test'
    if re.search(r'(?:^|\s|:)(?:build|compile|tsc)(?:$|\s|:)', text):
        return 'build'
    if re.search(r'(?:^|\s|:)(?:lint|eslint|ruff|mypy|check)(?:$|\s|:)', text):
        return 'quality'
    return 'command'


def _coverage_evidence(item):
    return _evidence('coverage', item.get('name', 'Coverage record'), item.get('status', 'unknown'),
                     item.get('detail') or item.get('output') or '', item.get('name'))


def _check_evidence(item):
    return _evidence(item.get('kind', 'runtime'), item.get('name', 'Project check'),
                     item.get('status', 'unknown'), _check_detail(item), item.get('runtime'))


def _unique(values):
    output = []
    for value in values:
        if value and value not in output:
            output.append(value)
    return output


def _is_gap(item):
    """Return true only when a recorded result leaves an applicable evidence gap."""
    status = item.get('status')
    if status in SUCCESS_STATUSES:
        return False
    detail = str(item.get('detail') or item.get('output') or '').lower()
    if status == 'skipped' and (str(item.get('name', '')).startswith('Python ') or
                                '0 python files' in detail or
                                'no supported exact-version npm lockfile or python requirements found' in detail):
        return False
    return True


def _attention(area, title, summary, action, *, priority='medium', source='review'):
    identity = hashlib.sha256(f'{area}:{title}:{source}'.encode()).hexdigest()[:12]
    return {'id': identity, 'area': area, 'priority': priority, 'title': title,
            'summary': re.sub(r'\s+', ' ', str(summary)).strip()[:420],
            'action': re.sub(r'\s+', ' ', str(action)).strip()[:300], 'source': source}


def _attention_items(findings, coverage, checks, *, passed_tests, journey_passed, plan):
    """Translate evidence gaps into concise user decisions; raw logs stay in Execution."""
    items = []
    high_findings = [item for item in findings if str(item.get('severity', '')).lower() in {'critical', 'high'}]
    if findings:
        items.append(_attention(
            'findings', 'Review the evidenced project findings',
            f'{len(findings)} potential issue(s) have source references; {len(high_findings)} are high priority. Model opinions still require confirmation.',
            'Open Findings, confirm each issue in context, and draft a repair plan for the accepted items.',
            priority='high' if high_findings else 'medium', source='findings'))

    unavailable_security = [item.get('name') for item in coverage
                            if item.get('name') in {'Semgrep', 'Gitleaks', 'TruffleHog'}
                            and item.get('status') == 'skipped']
    if unavailable_security:
        names = ', '.join(unavailable_security)
        items.append(_attention(
            'security', 'Optional deep security scanners did not run',
            f'{names} did not produce a usable scan. Results from the available scanners remain separate evidence.',
            f'Check whether {names} are installed and working, then rerun to add their independent evidence.',
            source='security coverage'))

    for item in coverage:
        name, status = str(item.get('name', 'Coverage check')), item.get('status')
        detail = str(item.get('detail') or '')
        if status in SUCCESS_STATUSES or name in {'Semgrep', 'Gitleaks', 'TruffleHog',
                                                   'Python behavioral AST patterns', 'AI authorship and production data'}:
            continue
        if name == 'OSV dependencies' and 'No supported exact-version' in detail:
            continue
        if name == 'Format coverage':
            items.append(_attention(
                'source', 'Some file types received a basic scan only',
                'PRAXIS checked these files for exposed credentials, but no language-specific correctness analyzer was available.',
                'Inspect the formats listed under Source inspection or add a supported analyzer before release.',
                source=name))
            continue
        if name == 'Local source inspection' and status == 'limited':
            items.append(_attention(
                'source', 'The source review reached its safety limit', detail,
                'Exclude generated or vendored content, then rerun so application source receives full coverage.',
                priority='high', source=name))
            continue
        if name.startswith('AI ') or ' · ' in name:
            provider = name.split(' · ')[-1] if ' · ' in name else 'the selected model'
            if 'HTTP 402' in detail:
                title = f'{provider.title()} could not run because billing or access was declined'
                summary = 'No result from this model was counted as evidence.'
                action = 'Open Models, check provider access or balance, and retry this review.'
            elif 'HTTP 429' in detail or 'rate limit' in detail.lower():
                title = f'{provider.title()} reached its request limit'
                summary = 'Completed model results were preserved; this model contributed no new evidence.'
                action = 'Retry after the provider quota resets or select another configured model.'
            elif status == 'limited':
                match = re.search(r'(?:Reviewed|pressure-tested) (\d+) of (\d+)', detail, re.I)
                title = (f'{name.split(" · ")[0]} reviewed {match.group(1)} of {match.group(2)} eligible files'
                         if match else f'{name} completed with limited coverage')
                summary = 'The model result is a review hypothesis over a bounded context window, not proof of the omitted files.'
                action = 'Use the source map and findings to focus the next review on the most relevant files.'
            else:
                title = 'Model review was not requested' if status == 'skipped' and 'disabled' in detail.lower() else f'{name} did not run'
                summary = 'No result from this model was counted as evidence.'
                action = 'Enable model review on a new review if you want an additional source-based opinion.' if 'disabled' in detail.lower() else 'Open Models, test the configured provider, and retry.'
            items.append(_attention('models', title, summary, action, source=name))
            continue
        if _is_gap(item):
            items.append(_attention(
                'security' if name in SECURITY_COVERAGE else 'source', f'{name} needs additional evidence',
                'This check did not establish full coverage. Its precise limits remain in the evidence details.',
                'Inspect the coverage record and resolve its missing input or unavailable analyzer before relying on this check.',
                source=name))

    failed = [check for check in checks if check.get('status') in FAILURE_STATUSES]
    for check in failed[:4]:
        name, detail, kind = str(check.get('name', 'Project check')), _check_detail(check, 24000), check.get('kind')
        runtime = check.get('runtime')
        environment = ('the container' if runtime == 'docker' else 'the local review copy'
                       if runtime == 'host' else 'the recorded execution environment')
        missing = re.search(r'(?:sh:\s*\d+:\s*|command not found:\s*)([A-Za-z0-9_.-]+):?\s*not found', detail, re.I)
        if kind == 'setup' and 'no space left on device' in detail.lower():
            title = 'Dependency setup reached the container disk limit' if runtime == 'docker' else 'Dependency setup ran out of disk space'
            summary = f'Dependency installation in {environment} ran out of space. Application behavior was not checked by this setup step.'
            action = ('Inspect the dependency cache location and bounded workspace size, then retry in a fresh container.'
                      if runtime == 'docker' else 'Check available disk space and the project dependency cache, then rerun the authorized checks.')
        elif kind == 'setup' and ('read timed out' in detail.lower() or 'timeouterror' in detail.lower()):
            title = 'Dependencies could not finish downloading'
            summary = f'The package download in {environment} stopped before setup completed.'
            action = 'Check package-service access and rerun the authorized checks.'
        elif missing:
            title = f'The project check could not find {missing.group(1)}'
            summary = f'The command started in {environment}, but a required project tool was not installed there.'
            action = 'Review the detected setup commands, install the missing tool through the project manifest, and rerun checks.'
        elif re.search(r'OCI runtime exec failed|sh:\s*\d+:\s*[^:\n]+:\s*Permission denied', detail, re.I):
            title = 'The execution environment could not start a required tool'
            summary = f'Execution in {environment} rejected the tool before the project check could run. This is not a completed behavioral result.'
            action = 'Check the executable and permissions shown in Execution, then rerun the authorized checks.'
        elif check.get('status') == 'timeout':
            title = 'A project check exceeded its time limit'
            summary = f'PRAXIS stopped the command in {environment} when its time limit expired.'
            action = 'Open Execution, inspect the last output, and split or optimize the command before retrying.'
        elif kind == 'setup':
            title = f'Dependency setup failed in {environment}'
            summary = f'PRAXIS could not prepare project dependencies in {environment}. This does not establish that application behavior is broken.'
            action = 'Open Execution, resolve the dependency or environment error, and retry before assessing runtime behavior.'
        elif check.get('status') == 'cancelled':
            title = 'A project check stopped before completion'
            summary = 'The interrupted command provides no completed behavioral result.'
            action = 'Rerun the check when the project environment is ready.'
        else:
            title = f'A project command failed in {environment}'
            summary = 'The command returned a failing exit status. Its exact output remains available under Execution.'
            action = 'Open Execution, fix the first failing command, and rerun checks.'
            results = re.findall(r'(\d+) (failed|passed|skipped|errors?)\b', detail[-4000:])
            if _command_class(check) == 'test' and results:
                counts = dict((state, int(count)) for count, state in results)
                title = 'The project test suite reported failures'
                summary = ('The recorded test summary reports ' + ', '.join(f'{count} {state}' for state, count in counts.items()) + '. '
                           'Inspect the failing cases to distinguish implementation defects from missing test prerequisites.')
                action = 'Open Execution for the final test summary, resolve the recorded failures, and rerun the suite.'
        items.append(_attention('execution', title, summary, action, priority='high', source=name))

    dependent_skips = [check for check in checks if check.get('status') == 'skipped'
                       and 'required setup step failed' in _check_detail(check).lower()]
    if dependent_skips:
        items.append(_attention(
            'execution', f'{len(dependent_skips)} check(s) waited for failed setup',
            'PRAXIS did not run dependent commands after the required toolchain setup failed.',
            'Resolve the setup failure shown first in Execution, then rerun the complete check set.',
            priority='high', source='execution order'))
    for check in checks:
        if check.get('status') != 'skipped' or check in dependent_skips or check.get('kind') == 'browser':
            continue
        detail = _check_detail(check, 2000).lower()
        if 'docker engine unavailable' in detail or 'local unix socket' in detail:
            title = 'The local Docker environment is not ready'
            summary = 'PRAXIS inspected source, but did not execute project commands because the local isolated runtime was unavailable.'
            action = 'Start Docker Desktop with a local Linux engine, then select Run checks for this saved review.'
        elif 'image unavailable' in detail:
            title = 'An isolated runtime image is missing'
            summary = 'Project commands did not run because the required container image was not prepared.'
            action = 'Prepare the image listed in Execution, then select Run checks. PRAXIS does not silently pull images.'
        elif check.get('kind') == 'infrastructure':
            title = 'The isolated run could not complete its execution scope'
            summary = 'A runtime boundary or time budget prevented the remaining checks from completing.'
            action = 'Inspect the infrastructure record in Execution, resolve the environment limit, and retry.'
        else:
            title = 'A discovered project check could not run'
            summary = 'The required runtime or command was unavailable. No passing result was recorded for this check.'
            action = 'Inspect the skipped command in Execution and prepare a supported runtime before retrying.'
        items.append(_attention('execution', title, summary, action, priority='high', source=check.get('name', 'runtime')))
    if not passed_tests:
        items.append(_attention(
            'execution', 'No behavioral test completed successfully',
            'Production behavior remains unproven until at least one discovered test command passes on the current snapshot.',
            ('Select Run checks, inspect the commands, and choose local execution for a trusted project or optional Docker.'
             if not checks else 'Resolve setup or test failures, then rerun checks against the unchanged snapshot.'),
            priority='high', source='behavioral tests'))
    if not journey_passed:
        items.append(_attention(
            'experience', 'No complete user journey was observed',
            'A build or homepage response cannot prove that an important user workflow works from start to finish.',
            'Run a task-specific browser journey or connect Playwright evidence before treating the project as release-ready.',
            source='browser evidence'))
    operations = plan.get('operations') or {}
    if plan.get('understanding', {}).get('entrypoints') and not operations.get('deployment_files'):
        items.append(_attention(
            'operations', 'Deployment evidence is not present',
            'The repository has application entry points, but PRAXIS did not find a deployment definition in the reviewed source.',
            'Add or identify the deployment configuration and validate it in the intended environment.',
            source='repository inventory'))

    order = {'high': 0, 'medium': 1, 'low': 2}
    unique = {item['id']: item for item in items}
    return sorted(unique.values(), key=lambda item: (order.get(item['priority'], 9), item['area'], item['title']))[:12]


def assessment(job):
    findings = job.get('findings') or []
    raw_checks = job.get('checks') or []
    current_subject = job.get('fix_path') or job.get('snapshot')
    stale = bool(raw_checks and job.get('checks_for') and job['checks_for'] != current_subject)
    checks = [] if stale else raw_checks
    coverage = job.get('coverage') or []
    plan = job.get('plan') or {}

    failures = [check for check in checks if check.get('status') in FAILURE_STATUSES]
    behavioral_failures = [check for check in failures if _behavior_failure(check)]
    passed_commands = [check for check in checks if check.get('status') == 'passed' and check.get('kind') == 'command']
    passed_tests = [check for check in passed_commands if _command_class(check) == 'test']
    passed_builds = [check for check in passed_commands if _command_class(check) == 'build']
    browser = [check for check in checks if check.get('name') == 'Browser checks' or check.get('kind') == 'browser']
    browser_passed = [check for check in browser if check.get('status') == 'passed']
    browser_failed = [check for check in browser if check.get('status') in FAILURE_STATUSES]
    journey_passed = [check for check in browser_passed if check.get('evidence_scope') == 'user_journey']
    homepage_passed = [check for check in browser_passed if check.get('evidence_scope') != 'user_journey']

    high_findings = [item for item in findings if str(item.get('severity', '')).lower() in {'high', 'critical'}]
    security_findings = [item for item in findings if str(item.get('category', '')).lower() in {'security', 'secrets', 'dependencies'}]
    reality_findings = [item for item in findings if str(item.get('category', '')).lower() in {'mock-data', 'incomplete'}
                        or re.search(r'(?i)(?:constant success|hardcoded|mock fallback|placeholder|no (?:real )?side effect)', str(item.get('title', '')))]
    source_coverage = [item for item in coverage if item.get('name') in SOURCE_COVERAGE]
    local_source = next((item for item in source_coverage if item.get('name') == 'Local source inspection'), None)
    security_coverage = [item for item in coverage if item.get('name') in SECURITY_COVERAGE]
    ai_coverage = [item for item in coverage if item not in source_coverage and item not in security_coverage
                   and (item.get('name') in AI_COVERAGE or ' · ' in str(item.get('name', '')))]

    gaps = [f"{item.get('name', 'Check')}: {item.get('detail') or item.get('output') or item.get('status')}"
            for item in [*coverage, *checks] if _is_gap(item)]
    if stale:
        gaps.append('Execution evidence belongs to an earlier snapshot and cannot verify the current source.')
    if not passed_tests:
        gaps.append('No behavioral test command completed successfully for the current source snapshot.')
    if not browser_passed:
        gaps.append('No browser smoke or user journey passed against the current source snapshot.')
    elif not journey_passed:
        gaps.append('The homepage browser smoke passed, but no task-specific user journey was executed.')
    if not plan.get('test_file_count'):
        gaps.append('No conventional test files were found in the bounded source inventory.')
    operations = plan.get('operations') or {}
    if not operations.get('deployment_files'):
        gaps.append('No deployment artifact was identified in the bounded source inventory.')

    if behavioral_failures:
        implementation = {'status': 'contradicted', 'label': 'Executed behavior failed',
                          'detail': f'{len(behavioral_failures)} current project check(s) returned a completed failing result.',
                          'evidence': [check.get('name', 'Runtime check') for check in behavioral_failures[:8]]}
    elif reality_findings:
        implementation = {'status': 'placeholder_risk', 'label': 'A production path may be simulated',
                          'detail': f'{len(reality_findings)} source finding(s) indicate constant, incomplete, hardcoded, or mock-backed behavior.',
                          'evidence': [item.get('title', 'Reality finding') for item in reality_findings[:8]]}
    elif passed_tests and journey_passed:
        implementation = {'status': 'demonstrated', 'label': 'A tested user journey was demonstrated',
                          'detail': f'{len(passed_tests)} behavioral test command(s) and {len(journey_passed)} task-specific browser journey(s) passed on the current copy.',
                          'evidence': [check.get('name', 'Runtime check') for check in [*passed_tests, *journey_passed][:8]]}
    elif passed_commands and homepage_passed:
        implementation = {'status': 'partially_demonstrated', 'label': 'Commands and homepage startup passed',
                          'detail': f'{len(passed_commands)} project command(s) passed and the homepage browser smoke completed. No task-specific user journey was executed.',
                          'evidence': [check.get('name', 'Runtime check') for check in [*passed_commands, *homepage_passed][:8]]}
    elif passed_commands:
        implementation = {'status': 'runtime_observed', 'label': 'Project commands passed',
                          'detail': f'{len(passed_commands)} project command(s) passed, including {len(passed_tests)} classified behavioral test command(s). User-facing behavior was not demonstrated.',
                          'evidence': [check.get('name', 'Runtime check') for check in passed_commands[:8]]}
    else:
        implementation = {'status': 'not_established', 'label': 'Implementation behavior is not established',
                          'detail': 'No current behavioral test plus task-specific user journey evidence is available.',
                          'evidence': []}

    blockers = [f"{item.get('severity', 'high').upper()}: {item.get('title', 'Finding')}" for item in high_findings[:8]]
    blockers += [f"{item.get('name', 'Runtime check')}: {'environment setup did not complete' if item.get('kind') in {'setup', 'infrastructure'} else 'the check did not complete successfully'}. Open Execution for the recorded output."
                 for item in failures[:max(0, 8 - len(blockers))]]
    if implementation['status'] == 'placeholder_risk':
        blockers += [f"REALITY: {title}" for title in implementation['evidence'][:max(0, 8 - len(blockers))]]
    requirements = []
    if not (local_source and local_source.get('status') == 'passed'):
        requirements.append('Complete local source inspection without truncation.')
    if not passed_tests:
        requirements.append('Run at least one discovered behavioral test command successfully.')
    if not journey_passed:
        requirements.append('Execute a task-specific user journey; homepage reachability is only a smoke check.')
    if blockers:
        readiness = {'status': 'blocked', 'label': 'Production readiness is blocked',
                     'detail': f'{len(blockers)} evidenced blocker(s) must be resolved or explicitly dispositioned.',
                     'blockers': blockers[:8], 'requirements': requirements}
    elif not requirements:
        readiness = {'status': 'release_candidate', 'label': 'Evidence supports a release candidate',
                     'detail': 'Current source inspection, behavioral tests, and a task-specific user journey passed. Live production operations remain a separate evidence boundary.',
                     'blockers': [], 'requirements': []}
    else:
        readiness = {'status': 'not_established', 'label': 'Production readiness is not established',
                     'detail': f'{len(requirements)} required evidence gate(s) are still open.',
                     'blockers': [], 'requirements': requirements}

    inventory_evidence = []
    if plan:
        inventory_evidence.append(_evidence('inventory', 'Reviewable source inventory', 'observed',
                                            f'{plan.get("files", 0)} files indexed.', 'source snapshot'))
        if plan.get('manifests'):
            inventory_evidence.append(_evidence('manifest', 'Project manifests', 'observed',
                                                ', '.join(plan['manifests'][:12]), 'source snapshot'))
        understanding = plan.get('understanding') or {}
        if understanding.get('entrypoints'):
            inventory_evidence.append(_evidence('entrypoint', 'Detected entry points', 'observed',
                                                ', '.join(understanding['entrypoints'][:12]), 'source snapshot'))
        if plan.get('test_files'):
            inventory_evidence.append(_evidence('test_inventory', 'Conventional test files', 'observed',
                                                f'{plan.get("test_file_count", 0)} found; examples: {", ".join(plan["test_files"][:8])}', 'source snapshot'))
        graph = plan.get('graph') or {}
        inventory_evidence.append(_evidence('source_graph', 'Resolved local imports', 'observed',
                                            f'{len(graph.get("edges", []))} relationships across {graph.get("indexed_files", 0)} indexed files.', 'static import graph'))

    source_evidence = [_coverage_evidence(item) for item in source_coverage]
    security_evidence = [_coverage_evidence(item) for item in security_coverage]
    security_evidence += [_evidence('finding', item.get('title', 'Security finding'), item.get('severity', 'unknown'),
                                    item.get('description', ''), (item.get('location') or {}).get('file'))
                          for item in security_findings]
    ai_evidence = [_coverage_evidence(item) for item in ai_coverage]
    runtime_evidence = [_check_evidence(item) for item in checks if item.get('kind') != 'browser']
    browser_evidence = [_check_evidence(item) for item in browser]
    reality_evidence = [_evidence('finding', item.get('title', 'Reality finding'), item.get('severity', 'unknown'),
                                  item.get('description', ''), (item.get('location') or {}).get('file'))
                        for item in reality_findings]
    reality_evidence += [_check_evidence(item) for item in [*passed_commands, *journey_passed, *homepage_passed]]

    security_passed = [item for item in security_coverage if item.get('status') == 'passed']
    security_limited = [item for item in security_coverage if item.get('status') not in SUCCESS_STATUSES]
    if security_findings:
        security_status = 'blocked'
        security_detail = f'{len(security_findings)} security, secret, or dependency finding(s) require disposition.'
    elif security_passed and not security_limited:
        security_status = 'checked'
        security_detail = f'{len(security_passed)} available security evidence source(s) completed without a reported match.'
    elif security_passed:
        security_status = 'limited'
        security_detail = f'{len(security_passed)} security source(s) completed and {len(security_limited)} were limited or unavailable.'
    else:
        security_status = 'not_established'
        security_detail = 'No dedicated security evidence source completed successfully.'

    if failures:
        runtime_status = 'failed'
    elif passed_commands and any(item.get('status') not in SUCCESS_STATUSES for item in checks):
        runtime_status = 'limited'
    elif passed_commands:
        runtime_status = 'passed'
    else:
        runtime_status = 'not_run'
    runtime_detail = (f'{len(passed_tests)} test, {len(passed_builds)} build, and '
                      f'{len(passed_commands) - len(passed_tests) - len(passed_builds)} other command(s) passed; '
                      f'{len(failures)} check(s) failed.')

    operation_evidence = []
    for kind, key in [('deployment', 'deployment_files'), ('ci', 'ci_files'), ('observability', 'observability_files')]:
        operation_evidence += [_evidence(kind, path, 'present', 'Repository artifact detected; it was not executed against production.', path)
                               for path in operations.get(key, [])]
    operation_counts = {key: len(operations.get(key, [])) for key in
                        ('deployment_files', 'ci_files', 'observability_files')}
    operation_status = 'repository_evidence' if operation_evidence else 'not_established'
    operation_detail = (f'{operation_counts["deployment_files"]} deployment, {operation_counts["ci_files"]} CI, and '
                        f'{operation_counts["observability_files"]} observability artifact(s) found in the bounded inventory.')

    dimensions = [
        _dimension('understanding', 'Project understanding', 'observed' if plan else 'not_run',
                   f'{len(inventory_evidence)} inventory evidence record(s) were created from the current snapshot.' if plan else 'Project inventory has not completed.',
                   inventory_evidence, ['File and import inventories do not prove runtime behavior.'] if plan else []),
        _dimension('source', 'Source inspection',
                   local_source.get('status') if local_source else 'not_run',
                   local_source.get('detail', '') if local_source else 'Local source inspection has not completed.',
                   source_evidence, [item.get('detail') for item in source_coverage if _is_gap(item)]),
        _dimension('analysis', 'Model review coverage',
                   ('complete' if ai_evidence and all(item.get('status') == 'complete' for item in ai_coverage)
                    else 'limited' if ai_evidence else 'not_run'),
                   f'{len(ai_evidence)} model review coverage record(s) are attached to this snapshot.' if ai_evidence else 'No model review evidence was recorded.',
                   ai_evidence, ['Model findings are hypotheses until supported by source or execution evidence.'] if ai_evidence else []),
        _dimension('security', 'Security and leakage', security_status, security_detail,
                   security_evidence, [item.get('detail') for item in security_limited]),
        _dimension('runtime', 'Automated checks', runtime_status, runtime_detail, runtime_evidence,
                   ['A passing command proves only the command and source snapshot recorded here.'] if checks else []),
        _dimension('e2e', 'User-facing behavior',
                   'failed' if browser_failed else ('passed' if journey_passed else 'smoke_passed' if homepage_passed else 'not_run'),
                   (f'{len(journey_passed)} task-specific user journey(s) passed.' if journey_passed
                    else f'{len(homepage_passed)} homepage smoke check(s) passed; no task-specific journey ran.' if homepage_passed
                    else f'{len(browser_failed)} browser check(s) failed.' if browser_failed
                    else 'No browser evidence was recorded for the current snapshot.'),
                   browser_evidence, ['Homepage reachability does not prove controls, secondary routes, or external side effects.'] if homepage_passed and not journey_passed else []),
        _dimension('reality', 'Implementation reality', implementation['status'], implementation['detail'],
                   reality_evidence, [] if journey_passed else ['A complete user workflow has not been observed.']),
        _dimension('operations', 'Production operations', operation_status, operation_detail,
                   operation_evidence, ['Repository artifacts do not prove live deployment health, production data, rollback, monitoring, or incident response.']),
    ]

    gaps = _unique(gaps)
    attention_items = _attention_items(findings, coverage, checks, passed_tests=passed_tests,
                                       journey_passed=journey_passed, plan=plan)
    if stale:
        attention_items.insert(0, _attention('execution', 'Existing checks belong to an earlier source copy',
                                            'Previous passing commands cannot establish behavior for the current repair snapshot.',
                                            'Run checks against the current source before accepting the repair.',
                                            priority='high', source='snapshot binding'))
    if job.get('status') not in {'complete', 'error', 'cancelled', 'paused'}:
        status, title = 'in_progress', 'Review in progress'
    elif blockers:
        status, title = 'attention', f'{len(blockers)} evidenced blocker(s) require action'
    elif findings:
        status, title = 'attention', f'{len(findings)} finding(s) require review or disposition'
    elif readiness['status'] == 'release_candidate':
        status, title = 'checked', 'Required release-candidate evidence gates passed'
    elif passed_commands:
        status, title = 'checked', f'{len(passed_commands)} command(s) passed; {len(requirements)} evidence gate(s) remain'
    else:
        status, title = 'incomplete', f'{len(requirements)} required evidence gate(s) remain'
    return {'version': 2, 'status': status, 'title': title, 'findings': len(findings),
            'commands_passed': len(passed_commands), 'tests_passed': len(passed_tests),
            'checks_failed': len(failures), 'gaps': gaps, 'attention_items': attention_items,
            'implementation': implementation, 'readiness': readiness, 'dimensions': dimensions}
