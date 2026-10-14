"""Bounded builder-authored actions and independent state observations.

This is execution evidence, not a source inference or an agent's assertion.
Only accessible controls and visible text are used; no submitted script is run.
The authorized project itself runs normally. API observations are independent
HTTP GETs, never browser-intercepted responses or a model's report.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import math
import ssl
import threading
import time
from datetime import datetime, timezone
from functools import lru_cache
from urllib.parse import urlparse

import httpx

from .journey_schema import JourneyInput, MAX_STATE_BYTES, _CREDENTIAL


LOCAL_ORIGIN = 'http://127.0.0.1:4173'


def _on_local_origin(url):
    expected = urlparse(LOCAL_ORIGIN)
    actual = urlparse(url)
    return actual.scheme == expected.scheme and actual.netloc == expected.netloc


def _legacy_run(page, spec: dict, cancelled: threading.Event) -> dict:
    name = spec['name']
    result = {'name': name, 'kind': 'browser', 'evidence_scope': 'ui_interaction',
              'status': 'failed', 'observations': [], 'output': ''}
    try:
        if cancelled.is_set():
            result.update(status='cancelled', output='The journey was cancelled before it began.')
            return result
        path = spec['path']
        page.goto(LOCAL_ORIGIN + path, timeout=8000, wait_until='domcontentloaded')
        if not _on_local_origin(page.url):
            result.update(status='skipped', output='The requested route redirected outside the local review app.')
            return result
        result['observations'].append('local_route_loaded')
        control = page.get_by_role(spec['role'], name=spec['control_name'], exact=True)
        if control.count() != 1 or not control.is_visible():
            result['output'] = 'The named control was not uniquely visible on the requested route.'
            return result
        expected = page.get_by_text(spec['expected_text'], exact=False).filter(visible=True)
        if expected.count():
            result.update(status='skipped', output='The expected text was already visible before the action; this interaction cannot establish the claimed change.')
            return result
        if cancelled.is_set():
            result.update(status='cancelled', output='The journey was cancelled before the action.')
            return result
        control.click(timeout=5000)
        result['observations'].append('named_control_clicked')
        if not _on_local_origin(page.url):
            result['output'] = 'The action left the local review app; no local outcome was established.'
            return result
        expected.first.wait_for(state='visible', timeout=5000)
        if cancelled.is_set():
            result.update(status='cancelled', output='The journey was cancelled before the outcome was recorded.')
            return result
        result.update(status='passed', output=(f'On {path}, clicked {spec["role"]} "{spec["control_name"]}"; '
                                               f'text "{spec["expected_text"]}" became visible. '
                                               'Backend state and external side effects were not checked.'))
        result['observations'].append('expected_text_became_visible')
        return result
    except Exception as exc:
        if cancelled.is_set():
            result.update(status='cancelled', output='The journey was cancelled.')
        else:
            # Avoid retaining locator arguments or URLs from browser errors.
            result['output'] = f'The browser interaction did not complete ({type(exc).__name__}).'
        return result


class _Cancelled(Exception):
    pass


class _TimedOut(Exception):
    pass


class _Unavailable(Exception):
    pass


class _Failed(Exception):
    def __init__(self, reason, message):
        self.reason = reason
        super().__init__(message)


_MISSING = object()


def _remaining(deadline, cancelled):
    if cancelled.is_set():
        raise _Cancelled()
    seconds = deadline - time.monotonic()
    if seconds <= 0:
        raise _TimedOut()
    return seconds


def _timeout(deadline, cancelled, maximum=1500):
    return max(1, min(maximum, int(_remaining(deadline, cancelled) * 1000)))


def _local_origin():
    parsed = urlparse(LOCAL_ORIGIN)
    try:
        local = ipaddress.ip_address(parsed.hostname or '').is_loopback
    except ValueError:
        local = False
    if (not local or parsed.scheme != 'http' or parsed.username or parsed.password or
            parsed.path or parsed.query or parsed.fragment or not parsed.port):
        raise _Unavailable('The app origin is not an exact local HTTP service.')


def _visible(page, text, exact):
    return page.get_by_text(text, exact=exact).filter(visible=True)


def _wait_text(page, step, deadline, cancelled):
    target = _visible(page, step['text'], step.get('exact', True))
    while True:
        _remaining(deadline, cancelled)
        try:
            target.first.wait_for(state='visible', timeout=_timeout(deadline, cancelled, 250))
            return
        except Exception as error:
            if type(error).__name__ != 'TimeoutError':
                raise


def _control(page, step, deadline, cancelled):
    control = page.get_by_role(step.get('role', 'button' if step['action'] == 'click' else 'textbox'),
                               name=step['control_name'], exact=True)
    # Password controls intentionally have no implicit textbox role. Inspect a
    # matching label too, so a deceptive generic accessible name is still denied.
    if step['action'] == 'fill' and control.count() == 0:
        control = page.get_by_label(step['control_name'], exact=True)
    if control.count() > 1:
        raise _Failed('ambiguous_control', 'The named control is not unique on this route.')
    control.first.wait_for(state='visible', timeout=_timeout(deadline, cancelled, 1500))
    if control.count() != 1 or not control.is_visible():
        raise _Failed('missing_control', 'The named control is not uniquely visible on this route.')
    if step['action'] == 'fill':
        attributes = ' '.join(control.get_attribute(key) or '' for key in
                              ('type', 'autocomplete', 'name', 'id'))
        if _CREDENTIAL.search(attributes) or 'one-time-code' in attributes.lower():
            raise _Failed('sensitive_input', 'Credential or one-time-code fields are excluded from recorded journeys.')
    return control


def _json_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key')
        result[key] = value
    return result


def _json_constant(_):
    raise ValueError('Nonfinite JSON number')


@lru_cache(maxsize=1)
def _state_tls_context():
    # HTTPX builds a TLS context even for an HTTP loopback request. Loading the
    # Windows certificate store for every observation can exhaust a short
    # journey's deadline. Cache only certificate verification configuration;
    # each read still has a fresh client, with no shared cookies or credentials.
    return ssl.create_default_context()


def _read_state(path, deadline, cancelled):
    """Independent bounded GET without browser cookies, proxies or redirects."""
    timeout = min(1.5, _remaining(deadline, cancelled))
    try:
        _local_origin()
        with httpx.Client(verify=_state_tls_context(), trust_env=False, timeout=timeout, follow_redirects=False,
                          limits=httpx.Limits(max_connections=1, max_keepalive_connections=0)) as client:
            with client.stream('GET', LOCAL_ORIGIN + path, headers={
                    'Accept': 'application/json', 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'}) as response:
                _remaining(deadline, cancelled)
                media = response.headers.get('content-type', '').split(';', 1)[0].lower().strip()
                if not 200 <= response.status_code < 300:
                    raise _Unavailable('The independent state endpoint did not return a successful response; redirects and authentication are not followed.')
                if media != 'application/json' and not media.endswith('+json'):
                    raise _Unavailable('The independent state endpoint did not return JSON.')
                if response.headers.get('content-encoding', 'identity').lower().strip() != 'identity':
                    raise _Unavailable('Compressed state responses are excluded from bounded observations.')
                size = response.headers.get('content-length')
                if size and (not size.isdecimal() or int(size) > MAX_STATE_BYTES):
                    raise _Unavailable('The independent state response exceeds its size limit.')
                chunks = bytearray()
                for chunk in response.iter_raw(chunk_size=4096):
                    _remaining(deadline, cancelled)
                    chunks.extend(chunk)
                    if len(chunks) > MAX_STATE_BYTES:
                        raise _Unavailable('The independent state response exceeds its size limit.')
                content = bytes(chunks)
        _remaining(deadline, cancelled)
        body = json.loads(content, object_pairs_hook=_json_pairs, parse_constant=_json_constant)
        return {'body': body, 'response_sha256': hashlib.sha256(content).hexdigest(),
                'response_bytes': len(content), 'observed_at': datetime.now(timezone.utc).isoformat()}
    except (_Unavailable, _Cancelled, _TimedOut):
        raise
    except Exception:
        _remaining(deadline, cancelled)
        # Never retain response bodies, endpoint exception URLs or project data.
        raise _Unavailable('The independent state response could not be read as bounded unambiguous JSON.') from None


def _pointer(body, pointer):
    value = body
    for token in pointer.split('/')[1:] if pointer else []:
        token = token.replace('~1', '/').replace('~0', '~')
        if isinstance(value, dict):
            value = value.get(token, _MISSING)
        elif isinstance(value, list) and token.isdecimal() and (token == '0' or not token.startswith('0')):
            index = int(token)
            value = value[index] if index < len(value) else _MISSING
        else:
            value = _MISSING
        if value is _MISSING:
            break
    if value is not _MISSING and type(value) not in {str, int, float, bool, type(None)}:
        raise _Unavailable('The selected API state is not a scalar; choose a specific count, identifier or status.')
    if type(value) is float and not math.isfinite(value):
        raise _Unavailable('The selected API state is not a finite JSON number.')
    return value


def _same(left, right):
    # JSON has one number type. A serialization flip from 1 to 1.0 is not a
    # backend state change, while true must never compare equal to the number 1.
    if type(left) in {int, float} and type(right) in {int, float}:
        return left == right
    return type(left) is type(right) and left == right


def _snapshots(assertions, deadline, cancelled):
    return {path: _read_state(path, deadline, cancelled)
            for path in dict.fromkeys(check['path'] for check in assertions)}


def _state_rows(assertions, before, after=None, confirmed=None):
    rows = []
    for check in assertions:
        initial = _pointer(before[check['path']]['body'], check['json_pointer'])
        row = {'name': check['name'], 'source': 'independent_local_api_json',
               'path': check['path'], 'json_pointer': check['json_pointer'],
               'require_change': check['require_change'], 'before_present': initial is not _MISSING,
               'expected_matched_before': _same(initial, check['expected']),
               'before': {key: value for key, value in before[check['path']].items() if key != 'body'},
               'status': 'pending'}
        if after is not None:
            outcome = _pointer(after[check['path']]['body'], check['json_pointer'])
            changed = not _same(initial, outcome)
            matched = _same(outcome, check['expected'])
            repeatable = (confirmed is not None and
                          _same(_pointer(confirmed[check['path']]['body'], check['json_pointer']), check['expected']))
            row.update(after_present=outcome is not _MISSING, changed=changed,
                       expected_matched_after=matched, repeatable=repeatable,
                       after={key: value for key, value in after[check['path']].items() if key != 'body'},
                       status='passed' if matched and (changed or not check['require_change']) else 'failed')
            if confirmed is not None:
                row['confirmation'] = {key: value for key, value in confirmed[check['path']].items() if key != 'body'}
                if not repeatable:
                    row['status'] = 'failed'
        rows.append(row)
    return rows


def _structured_run(page, spec, cancelled):
    deadline = time.monotonic() + spec['timeout_seconds']
    result = {'name': spec['name'], 'kind': 'browser', 'evidence_scope': 'ui_interaction',
              'attempted_scope': 'user_journey' if spec['state_assertions'] else 'ui_interaction',
              'status': 'failed', 'ui_status': 'not_run', 'observations': [], 'steps': [],
              'state_evidence': [], 'false_success': False, 'output': '',
              'evidence_boundaries': ['API state evidence observes selected JSON fields; it does not prove database durability or external side effects.']}
    guard = None
    blocked = []
    context = None
    try:
        _remaining(deadline, cancelled)
        _local_origin()
        context = page.context

        def guard(route):
            if not _on_local_origin(route.request.url) or cancelled.is_set():
                blocked.append(True)
                route.abort()
            else:
                route.continue_()

        context.route('**/*', guard)
        steps = spec['steps']
        first = steps[0]
        page.goto(LOCAL_ORIGIN + first['path'], timeout=_timeout(deadline, cancelled, 8000),
                  wait_until='domcontentloaded')
        _remaining(deadline, cancelled)
        if not _on_local_origin(page.url) or blocked:
            raise _Failed('external_target', 'A browser request tried to leave the local review app and was blocked.')
        result['steps'].append({'index': 0, 'action': 'navigate', 'status': 'passed'})
        result['observations'].append('local_route_loaded')
        # Capture fresh baselines after loading the route, before any interaction.
        before_text = {index: bool(_visible(page, step['text'], step.get('exact', True)).count())
                       for index, step in enumerate(steps) if step['action'] == 'assert_text'}
        initial_path = urlparse(page.url).path
        before = _snapshots(spec['state_assertions'], deadline, cancelled)
        result['state_evidence'] = _state_rows(spec['state_assertions'], before)
        if any(row['require_change'] and row['expected_matched_before'] for row in result['state_evidence']):
            result.update(status='skipped', failure_reason='preexisting_state',
                          output='The expected API state already existed before any action. No new backend side effect was established.')
            return result
        if spec['state_assertions']:
            # Read-only endpoints and selected baseline fields must be stable
            # before the UI acts. Otherwise an automatic/background/GET-driven
            # change could be mistaken for an effect of the reviewed action.
            baseline_confirmation = _snapshots(spec['state_assertions'], deadline, cancelled)
            for check, row in zip(spec['state_assertions'], result['state_evidence']):
                stable = _same(_pointer(before[check['path']]['body'], check['json_pointer']),
                               _pointer(baseline_confirmation[check['path']]['body'], check['json_pointer']))
                row['baseline_repeatable'] = stable
                row['baseline_confirmation'] = {key: value for key, value in baseline_confirmation[check['path']].items() if key != 'body'}
                if not stable:
                    raise _Unavailable('The selected API state changed before any UI action. A stable baseline is required to attribute the claimed backend effect.')
        if any(before_text.values()) or any(step['action'] == 'assert_url' and step['path'] == initial_path for step in steps):
            result.update(status='skipped', failure_reason='preexisting_ui',
                          output='A requested visible outcome already existed before the action; the journey cannot establish that change.')
            return result
        result['ui_status'] = 'running'
        for index, step in enumerate(steps[1:], start=1):
            _remaining(deadline, cancelled)
            row = {'index': index, 'action': step['action'], 'status': 'running'}
            result['steps'].append(row)
            if step['action'] == 'navigate':
                page.goto(LOCAL_ORIGIN + step['path'], timeout=_timeout(deadline, cancelled, 8000),
                          wait_until='domcontentloaded')
            elif step['action'] == 'click':
                _control(page, step, deadline, cancelled).click(timeout=_timeout(deadline, cancelled, 1500))
                result['observations'].append('named_control_clicked')
            elif step['action'] == 'fill':
                _control(page, step, deadline, cancelled).fill(step['value'], timeout=_timeout(deadline, cancelled, 1500))
                result['observations'].append('nonsensitive_control_filled')
            elif step['action'] == 'assert_text':
                _wait_text(page, step, deadline, cancelled)
                result['observations'].append('expected_text_became_visible')
            elif step['action'] == 'assert_url':
                while urlparse(page.url).path != step['path']:
                    if not _on_local_origin(page.url) or blocked:
                        raise _Failed('external_target', 'The action tried to leave the local review app.')
                    # A sync Playwright API call pumps navigation/request events;
                    # sleeping while reading the cached page.url would starve
                    # the route handler and miss a real asynchronous redirect.
                    try:
                        page.wait_for_url(LOCAL_ORIGIN + step['path'], wait_until='domcontentloaded',
                                          timeout=_timeout(deadline, cancelled, 250))
                    except Exception as error:
                        if type(error).__name__ != 'TimeoutError':
                            raise
                result['observations'].append('expected_local_route_observed')
            _remaining(deadline, cancelled)
            if not _on_local_origin(page.url) or blocked:
                raise _Failed('external_target', 'A browser request tried to leave the local review app and was blocked.')
            row['status'] = 'passed'
        result['ui_status'] = 'passed'
        if not spec['state_assertions']:
            result.update(status='passed', output='The approved local actions produced the expected visible outcome. Backend state and external side effects were not checked.')
            return result
        # A bounded retry handles short asynchronous writes without assuming an
        # eventual side effect. Each sample is a real independent GET.
        after = None
        for attempt in range(3):
            after = _snapshots(spec['state_assertions'], deadline, cancelled)
            result['state_evidence'] = _state_rows(spec['state_assertions'], before, after)
            for check, row in zip(spec['state_assertions'], result['state_evidence']):
                row['baseline_repeatable'] = True
                row['baseline_confirmation'] = {key: value for key, value in baseline_confirmation[check['path']].items() if key != 'body'}
            if all(row['status'] == 'passed' for row in result['state_evidence']):
                break
            if attempt < 2:
                cancelled.wait(min(.1, _remaining(deadline, cancelled)))
        if any(row['status'] != 'passed' for row in result['state_evidence']):
            result['false_success'] = True
            unchanged = all(not row['changed'] for row in result['state_evidence'])
            raise _Failed('state_unchanged' if unchanged else 'state_mismatch',
                          'The interface reported the expected outcome, but independent API state did not demonstrate every required change. Static success or a partial side effect is insufficient.')
        cancelled.wait(min(.1, _remaining(deadline, cancelled)))
        confirmed = _snapshots(spec['state_assertions'], deadline, cancelled)
        result['state_evidence'] = _state_rows(spec['state_assertions'], before, after, confirmed)
        for check, row in zip(spec['state_assertions'], result['state_evidence']):
            row['baseline_repeatable'] = True
            row['baseline_confirmation'] = {key: value for key, value in baseline_confirmation[check['path']].items() if key != 'body'}
        if not all(row['status'] == 'passed' for row in result['state_evidence']):
            result['false_success'] = True
            raise _Failed('unstable_state', 'The expected API state did not hold on a second independent observation. The backend outcome is not repeatable.')
        _remaining(deadline, cancelled)
        result['observations'] += ['independent_local_api_state_changed', 'api_state_repeated']
        result.update(status='passed', evidence_scope='user_journey',
                      output='The approved local actions produced the expected visible outcome, and every selected API state assertion passed against before, after and repeat observations. At least one required backend state change was observed.')
    except _Cancelled:
        result.update(status='cancelled', failure_reason='cancelled', output='The journey was cancelled; incomplete observations are retained without a success verdict.')
    except _TimedOut:
        result.update(failure_reason='time_limit', output='The journey reached its total time limit before every required observation completed.')
    except _Unavailable as error:
        result.update(status='skipped', failure_reason='state_unavailable', output=str(error))
    except _Failed as error:
        result.update(failure_reason=error.reason, output=str(error))
    except Exception as error:
        if cancelled.is_set():
            result.update(status='cancelled', failure_reason='cancelled', output='The journey was cancelled.')
        elif time.monotonic() >= deadline:
            result.update(failure_reason='time_limit', output='The journey reached its total time limit before every required observation completed.')
        elif blocked:
            result.update(failure_reason='external_target', output='A browser request tried to leave the local review app and was blocked.')
        else:
            result.update(failure_reason='browser_check_failed', output=f'The browser journey did not complete ({type(error).__name__}).')
    finally:
        result['elapsed_ms'] = max(0, int((time.monotonic() - (deadline - spec['timeout_seconds'])) * 1000))
        for row in result['steps']:
            if row['status'] == 'running':
                row['status'] = result['status']
        if result['ui_status'] == 'running':
            result['ui_status'] = result['status']
        for row in result['state_evidence']:
            if row['status'] == 'pending':
                row['status'] = result['status']
        if context is not None and guard is not None:
            try:
                context.unroute('**/*', guard)
            except Exception:
                pass
    return result


def run(page, spec: dict, cancelled: threading.Event) -> dict:
    """Execute validated data-only steps; legacy one-click behavior is unchanged."""
    try:
        # Explicit JSON null is a valid expected scalar and must be retained.
        checked = JourneyInput.model_validate(spec).model_dump()
    except Exception:
        return {'name': 'Requested journey', 'kind': 'browser', 'evidence_scope': 'ui_interaction',
                'status': 'failed', 'failure_reason': 'invalid_spec', 'observations': [],
                'output': 'The journey specification is invalid or exceeds the supported action, target or data limits.'}
    if not checked['steps']:
        return _legacy_run(page, checked, cancelled)
    return _structured_run(page, checked, cancelled)
