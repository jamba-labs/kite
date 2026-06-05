# Records the same test twice and verifies the telemetry is byte-identical
# (excluding the meta line, which carries a timestamp). This is the recorder's
# conformance test — if it fails, every metric downstream is noise.
#
# Usage: .\tools\verify-determinism.ps1 [-Test tests/jump_test.inputs.json]
param(
    [string]$Test = "tests/jump_test.inputs.json",
    [string]$Project = (Join-Path $PSScriptRoot "..\fixture"),
    [string]$Godot = "godot",
    [int]$Seed = 12345
)
$ErrorActionPreference = "Stop"

foreach ($run in "a", "b") {
    & $Godot --headless --path $Project -- "--kite-test=$Test" "--kite-out=runs/det_$run.jsonl" "--kite-seed=$Seed"
    if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: recording run '$run' exited $LASTEXITCODE"; exit 1 }
}

$a = Get-Content (Join-Path $Project "runs/det_a.jsonl") | Select-Object -Skip 1
$b = Get-Content (Join-Path $Project "runs/det_b.jsonl") | Select-Object -Skip 1

if ($a.Count -ne $b.Count) {
    Write-Host "FAIL: frame counts differ ($($a.Count) vs $($b.Count))"
    exit 1
}
$diff = 0..($a.Count - 1) | Where-Object { $a[$_] -cne $b[$_] }
if ($diff) {
    Write-Host "FAIL: $($diff.Count) differing frame(s); first at line $($diff[0] + 2):"
    Write-Host "  a: $($a[$diff[0]])"
    Write-Host "  b: $($b[$diff[0]])"
    exit 1
}
Write-Host "PASS: $Test -> $($a.Count) frames, byte-identical across two runs"
