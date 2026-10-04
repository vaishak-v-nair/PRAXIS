"""Export the compiled caption windows, without inventing different timing."""
import math


def timestamp(seconds):
    if not math.isfinite(seconds) or seconds < 0:
        raise ValueError('Invalid subtitle timestamp')
    millis = round(seconds * 1000)
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    seconds, millis = divmod(millis, 1000)
    return f'{hours:02}:{minutes:02}:{seconds:02}.{millis:03}'


def webvtt(captions, duration):
    if not math.isfinite(duration) or duration <= 0 or not captions:
        raise ValueError('A real caption track and duration are required')
    lines, previous_end = ['WEBVTT', ''], 0
    for index, caption in enumerate(captions, 1):
        start, end = caption['start'], caption['end']
        text = caption['text'].strip()
        if not text or not all(math.isfinite(value) for value in (start, end)):
            raise ValueError('Empty or invalid cue')
        if not previous_end <= start < end <= duration:
            raise ValueError('Overlapping, regressed or out-of-film cue')
        if timestamp(start) == timestamp(end):
            raise ValueError('Subtitle cue disappears at millisecond precision')
        # WebVTT interprets markup. Preserve literal source text safely.
        text = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        lines.extend([str(index), f'{timestamp(start)} --> {timestamp(end)}', text, ''])
        previous_end = end
    return '\n'.join(lines)
