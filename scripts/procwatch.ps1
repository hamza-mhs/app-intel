# Diagnostic: who is killing the App Intel server every ~5 minutes?
# Started by server.js on Windows (detached, once). Records the server's ancestor chain, every node.exe command
# line, 5-minute scheduled tasks, and every process that starts during the next 7 minutes. Read-only.
param([int]$ServerPid, [string]$Out)
$ErrorActionPreference = 'Continue'
Write-Output "procwatch.ps1 running as pid $PID, out=$Out"
function W($s) { Add-Content -Path $Out -Value $s -Encoding UTF8 }
Set-Content -Path $Out -Value "== procwatch started $(Get-Date -Format o) for server pid $ServerPid ==" -Encoding UTF8
W "== ancestors of the server =="
$p = $ServerPid
for ($i = 0; $i -lt 8 -and $p; $i++) {
  $x = Get-CimInstance Win32_Process -Filter "ProcessId=$p"
  if (-not $x) { W "  $p (gone)"; break }
  W "  $($x.ProcessId) $($x.Name): $($x.CommandLine)"
  $p = $x.ParentProcessId
}
W "== node.exe processes =="
Get-CimInstance Win32_Process -Filter "name='node.exe'" | ForEach-Object { W "  $($_.ProcessId) <- $($_.ParentProcessId): $($_.CommandLine)" }
W "== scheduled tasks repeating every 1-10 minutes =="
Get-ScheduledTask | Where-Object { $_.State -ne 'Disabled' -and ($_.Triggers.Repetition.Interval -match '^PT([1-9]|10)M$') } | ForEach-Object { W "  $($_.TaskPath)$($_.TaskName) [$($_.Triggers.Repetition.Interval)] $(($_.Actions | ForEach-Object { $_.Execute + ' ' + $_.Arguments }) -join '; ')" }
W "== new processes (7 minutes) =="
$seen = @{}
Get-CimInstance Win32_Process | ForEach-Object { $seen[$_.ProcessId] = 1 }
$end = (Get-Date).AddMinutes(7)
$alive = $true
while ((Get-Date) -lt $end) {
  Get-CimInstance Win32_Process | Where-Object { -not $seen[$_.ProcessId] } | ForEach-Object {
    $seen[$_.ProcessId] = 1
    $par = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ParentProcessId)"
    W "$(Get-Date -Format HH:mm:ss.fff) $($_.ProcessId) $($_.Name) <- $($_.ParentProcessId) $($par.Name): $($_.CommandLine)"
  }
  if ($alive -and -not (Get-Process -Id $ServerPid)) { W "$(Get-Date -Format HH:mm:ss.fff) *** server pid $ServerPid is gone ***"; $alive = $false }
  Start-Sleep -Milliseconds 250
}
W "== done $(Get-Date -Format o) =="
