# Syncs the Godot addon from its dev location (fixture/addons/kite — where you
# edit it in the Godot editor) to the repo-root ship location (addons/kite —
# what the Asset Library archive installs from). They must be byte-identical.
#
#   .\tools\sync-addon.ps1          # copy fixture -> root
#   .\tools\sync-addon.ps1 -Check   # verify in sync (CI); exit 1 if not
param([switch]$Check)
$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot ".."
$src  = Join-Path $root "fixture/addons/kite"   # canonical (edited in-editor)
$dst  = Join-Path $root "addons/kite"           # generated (ships)

$srcFiles = Get-ChildItem $src -File | Sort-Object Name
if ($Check) {
    $dstFiles = Get-ChildItem $dst -File | Sort-Object Name
    $sn = ($srcFiles.Name -join ",")
    $dn = ($dstFiles.Name -join ",")
    if ($sn -ne $dn) {
        Write-Host "FAIL: addon file lists differ.`n  fixture: $sn`n  root:    $dn"
        Write-Host "Run: .\tools\sync-addon.ps1"
        exit 1
    }
    foreach ($f in $srcFiles) {
        $a = Get-Content (Join-Path $src $f.Name) -Raw
        $b = Get-Content (Join-Path $dst $f.Name) -Raw
        if ($a -cne $b) {
            Write-Host "FAIL: addons/kite/$($f.Name) is out of sync with fixture/addons/kite/$($f.Name)."
            Write-Host "Run: .\tools\sync-addon.ps1"
            exit 1
        }
    }
    Write-Host "PASS: addons/kite is in sync with fixture/addons/kite ($($srcFiles.Count) files)"
    exit 0
}

Remove-Item -Recurse -Force $dst -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item -Recurse -Force "$src/*" $dst
Write-Host "synced fixture/addons/kite -> addons/kite ($($srcFiles.Count) files)"
