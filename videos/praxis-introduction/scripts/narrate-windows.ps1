# LEGACY V1 ONLY: rejected SAPI/slideshow path; see README.md for the current neural-voice film.
param([string]$Voice = 'Microsoft David Desktop')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
Add-Type -ReferencedAssemblies System.Speech,System.Collections -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Speech.Synthesis;
using System.Speech.AudioFormat;
public sealed class NarrationWord {
    public string text;
    public double start;
    public int character;
}
public static class RecordedNarration {
    public static NarrationWord[] Speak(string text, string path, string voice) {
        var words = new List<NarrationWord>();
        using (var speaker = new SpeechSynthesizer()) {
            speaker.SelectVoice(voice);
            speaker.Rate = 0;
            speaker.Volume = 100;
            speaker.SpeakProgress += (sender, e) => words.Add(new NarrationWord {
                text = e.Text, start = e.AudioPosition.TotalSeconds,
                character = e.CharacterPosition
            });
            // Set the output format explicitly; the default 22050-Hz sink caused
            // this installed voice's word events to use a different audio clock.
            speaker.SetOutputToWaveFile(path, new SpeechAudioFormatInfo(
                16000, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
            speaker.Speak(text);
        }
        return words.ToArray();
    }
}
'@
$projectDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$spoken = @(Get-Content -LiteralPath (Join-Path $projectDir 'SCRIPT.md') | Where-Object { $_ -match '^ {4}\S' })
if ($spoken.Count -ne 13) { throw 'Expected thirteen locked narration lines in SCRIPT.md.' }
$lines = @()
for ($lineNumber = 0; $lineNumber -lt $spoken.Count; $lineNumber++) {
    $lines += [pscustomobject]@{ id = ('{0:D2}' -f ($lineNumber + 1)); text = $spoken[$lineNumber].Substring(4).Trim() }
}
$voiceDir = Join-Path $projectDir 'assets/voice'
[IO.Directory]::CreateDirectory($voiceDir) | Out-Null
$voices = @()
$neutralVoices = @()
$totalDuration = 0.0
foreach ($line in $lines) {
    $relative = 'assets/voice/' + $line.id + '.wav'
    $absolute = Join-Path $projectDir $relative
    $events = @([RecordedNarration]::Speak($line.text, $absolute, $Voice))
    $duration = [double](& ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $absolute)
    if ($LASTEXITCODE -ne 0 -or $duration -le 0 -or $events.Count -eq 0) { throw "No real audio/timings for frame $($line.id)" }
    foreach ($event in $events) { if ($event.start -lt 0 -or $event.start -ge $duration) { throw "Speech-progress clock mismatch in frame $($line.id)" } }
    $words = @()
    for ($i = 0; $i -lt $events.Count; $i++) {
        $end = if ($i + 1 -lt $events.Count) { $events[$i + 1].start } else { $duration }
        $words += [ordered]@{ id = ('w' + ($i + 1)); text = $events[$i].text; start = [Math]::Round($events[$i].start, 3); end = [Math]::Round($end, 3) }
    }
    $duration = [Math]::Round($duration, 3)
    $totalDuration += $duration
    $voices += [ordered]@{ frame = [int]$line.id; path = $relative; duration_s = $duration; words = $words }
    $neutralVoices += [ordered]@{ id = $line.id; path = $relative; duration_s = $duration; words = $words }
    Write-Output "Frame $($line.id): $duration seconds; $($words.Count) real speech-progress events"
}
$productMeta = [ordered]@{ bgm = $null; bgm_pending = $false; voices = $voices; sfx = @(); narration_provider = 'windows-sapi'; voice_id = $Voice; timing_source = 'System.Speech SpeakProgress AudioPosition; word ends use next onset' }
$neutralMeta = [ordered]@{ tts_provider = 'windows-sapi'; voice_id = $Voice; bgm = $null; bgm_pending = $false; voices = $neutralVoices; sfx = @(); total_duration_s = [Math]::Round($totalDuration, 3) }
[IO.File]::WriteAllText((Join-Path $projectDir 'audio_meta.json'), ($productMeta | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $projectDir 'audio_engine_meta.json'), ($neutralMeta | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
Write-Output "Recorded local Windows narration: $($neutralMeta.total_duration_s) seconds; no project source or transcript sent to a provider."
