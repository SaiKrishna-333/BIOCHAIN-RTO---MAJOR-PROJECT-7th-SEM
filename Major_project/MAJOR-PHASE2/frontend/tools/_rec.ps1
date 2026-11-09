# Headed, screen-recordable A-to-Z launcher: opens a real Chrome window,
# drives all scenes, records a .webm, and streams progress live to the log.
Set-Location $PSScriptRoot
$env:DEMO_HEADED = "1"
$env:DEMO_VIDEO = "1"
Write-Output ("launch at " + (Get-Date -Format "HH:mm:ss"))
node tools/demo.mjs 2>&1 | Tee-Object -FilePath a2z-recording-run.log
