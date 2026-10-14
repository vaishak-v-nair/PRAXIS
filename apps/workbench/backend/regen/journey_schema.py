"""Inspectable, bounded inputs for builder-approved local browser journeys.

The legacy one-click input remains supported. Structured actions carry no code,
selectors, headers, SQL, target origins, or authentication configuration. Fill
values are transient execution input and must not be saved in durable job options.
"""
from __future__ import annotations

import math
import re
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


MAX_STEPS = 12
MAX_STATE_ASSERTIONS = 4
MAX_STATE_BYTES = 64 * 1024
_CREDENTIAL = re.compile(r'password|passwd|passphrase|secret|(?:api|access|refresh|auth)[\s_-]*(?:key|token)|authorization|credential|private[\s_-]*key', re.I)
_SECRET_VALUE = re.compile(r'(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|-----BEGIN[^\n]*PRIVATE KEY-----|Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)', re.I)


def safe_path(value: str) -> str:
    """One literal app-relative path, without query credentials or decoding tricks."""
    if (not value.startswith('/') or value.startswith('//') or
            not re.fullmatch(r'/[A-Za-z0-9_./~-]*', value) or
            any(part in {'.', '..'} for part in value.split('/'))):
        raise ValueError('Use a literal local route without a host, query, or traversal.')
    return value


def plain_text(value: str) -> str:
    if not value.strip() or any(ord(char) < 32 for char in value):
        raise ValueError('Journey text must be nonempty and contain no control characters.')
    if _SECRET_VALUE.search(value):
        raise ValueError('Do not submit credentials in a journey specification.')
    return value.strip()


class _Input(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class NavigateStep(_Input):
    action: Literal['navigate']
    path: str = Field(min_length=1, max_length=200)
    _path = field_validator('path')(safe_path)


class ClickStep(_Input):
    action: Literal['click']
    role: Literal['button', 'link'] = 'button'
    control_name: str = Field(min_length=1, max_length=120)
    _name = field_validator('control_name')(plain_text)


class FillStep(_Input):
    action: Literal['fill']
    role: Literal['textbox', 'combobox'] = 'textbox'
    control_name: str = Field(min_length=1, max_length=120)
    value: str = Field(max_length=500)

    @field_validator('control_name')
    @classmethod
    def nonsensitive_name(cls, value):
        value = plain_text(value)
        if _CREDENTIAL.search(value):
            raise ValueError('Credential fields cannot be filled by a saved journey.')
        return value

    @field_validator('value')
    @classmethod
    def transient_value(cls, value):
        if any(ord(char) < 32 for char in value) or _SECRET_VALUE.search(value):
            raise ValueError('Do not submit credentials or control characters as form input.')
        return value


class TextStep(_Input):
    action: Literal['assert_text']
    text: str = Field(min_length=1, max_length=200)
    exact: bool = True
    _text = field_validator('text')(plain_text)


class URLStep(_Input):
    action: Literal['assert_url']
    path: str = Field(min_length=1, max_length=200)
    _path = field_validator('path')(safe_path)


StepInput = Annotated[Union[NavigateStep, ClickStep, FillStep, TextStep, URLStep], Field(discriminator='action')]


class StateAssertionInput(_Input):
    name: str = Field(min_length=1, max_length=80)
    path: str = Field(min_length=1, max_length=200)
    json_pointer: str = Field(max_length=200)
    expected: Any
    # Changing this to false is never enough to establish a full user journey.
    require_change: bool = True
    _name = field_validator('name')(plain_text)
    _path = field_validator('path')(safe_path)

    @field_validator('json_pointer')
    @classmethod
    def bounded_pointer(cls, value):
        if (value and not value.startswith('/')) or len(value.split('/')) > 13:
            raise ValueError('Use a bounded JSON pointer starting with a slash.')
        if re.search(r'~(?![01])', value) or any(ord(char) < 32 for char in value):
            raise ValueError('The JSON pointer contains an invalid escape or control character.')
        if _CREDENTIAL.search(value):
            raise ValueError('Credential values cannot be state evidence.')
        return value

    @field_validator('expected')
    @classmethod
    def scalar_without_credentials(cls, value):
        if type(value) not in {str, int, float, bool, type(None)}:
            raise ValueError('Expected state must be a JSON scalar, not a submitted object or code.')
        if type(value) is str:
            if len(value) > 300 or any(ord(char) < 32 for char in value) or _SECRET_VALUE.search(value):
                raise ValueError('Expected state is too large or contains credentials or control characters.')
        if type(value) is int and abs(value) > 2 ** 53 - 1:
            raise ValueError('Expected integer exceeds the exact JSON integer range.')
        if type(value) is float and not math.isfinite(value):
            raise ValueError('Expected state must be a finite JSON number.')
        return value


class JourneyInput(_Input):
    name: str = Field(min_length=1, max_length=80)
    path: str = Field(default='/', min_length=1, max_length=200)
    role: Literal['button', 'link'] = 'button'
    control_name: str | None = Field(default=None, min_length=1, max_length=120)
    expected_text: str | None = Field(default=None, min_length=1, max_length=200)
    steps: list[StepInput] = Field(default_factory=list, max_length=MAX_STEPS)
    state_assertions: list[StateAssertionInput] = Field(default_factory=list, max_length=MAX_STATE_ASSERTIONS)
    timeout_seconds: int = Field(default=30, ge=5, le=60)
    _path = field_validator('path')(safe_path)
    _name = field_validator('name')(plain_text)

    @field_validator('control_name', 'expected_text')
    @classmethod
    def optional_text(cls, value):
        return plain_text(value) if value is not None else value

    @model_validator(mode='after')
    def coherent_steps(self):
        if not self.steps:
            if self.control_name is None or self.expected_text is None or self.state_assertions:
                raise ValueError('A legacy interaction requires a control and expected text; state checks need structured steps.')
            return self
        if self.control_name is not None or self.expected_text is not None or self.path != '/' or self.role != 'button':
            raise ValueError('Use structured steps or the legacy one-click fields, not both.')
        if self.steps[0].action != 'navigate':
            raise ValueError('The first structured step must navigate to a local route.')
        interacted = False
        observed = False
        for step in self.steps:
            if step.action in {'click', 'fill'}:
                interacted = True
            if interacted and step.action in {'assert_text', 'assert_url'}:
                observed = True
        if not interacted or not observed or self.steps[-1].action not in {'assert_text', 'assert_url'}:
            raise ValueError('A journey needs an actual interaction and a final visible text or route assertion.')
        if self.state_assertions and not any(check.require_change for check in self.state_assertions):
            raise ValueError('At least one state assertion must require an observed change; static state is supporting evidence only.')
        return self
