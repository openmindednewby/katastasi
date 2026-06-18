# Build the ai-confluence-pipeline Docker image locally.
#   ./scripts/docker-build.ps1                 # builds acp:latest
#   ./scripts/docker-build.ps1 myreg/acp:1.0   # custom tag
$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
$Image = if ($args.Count -ge 1) { $args[0] } else { 'acp:latest' }

Write-Host "Building $Image from $ProjectDir ..."
docker build -t $Image $ProjectDir
if ($LASTEXITCODE -ne 0) { throw "docker build failed" }
Write-Host "Done: $Image"
docker image inspect $Image --format '  size: {{.Size}} bytes, created: {{.Created}}'
