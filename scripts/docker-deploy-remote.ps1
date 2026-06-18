# Deploy the ai-confluence-pipeline image to a remote Docker host with no registry,
# by streaming it over SSH (docker save | gzip | ssh 'gunzip | docker load').
#
# Usage:
#   ./scripts/docker-deploy-remote.ps1 -Target user@host
#   ./scripts/docker-deploy-remote.ps1 -Target user@host -Image acp:1.0 -SshKey ~/.ssh/id_ed25519
#   ./scripts/docker-deploy-remote.ps1 -Target user@host -EnvFile .env -Run "acp pull-jira PROJ-1 /work/out"
#   ./scripts/docker-deploy-remote.ps1 -Target user@host -NoBuild
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [string]$Image = 'acp:latest',
  [string]$SshKey = '',
  [int]$Port = 22,
  [switch]$NoBuild,
  [string]$EnvFile = '',
  [string]$Run = ''
)
$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot

$sshArgs = @('-p', "$Port")
$scpArgs = @('-P', "$Port")
if ($SshKey) { $sshArgs += @('-i', $SshKey); $scpArgs += @('-i', $SshKey) }
function Invoke-Remote([string]$cmd) { ssh @sshArgs $Target $cmd }

Write-Host "==> Target: $Target (port $Port)   Image: $Image"

if (-not $NoBuild) {
  Write-Host "==> Building $Image locally..."
  docker build -t $Image $ProjectDir
  if ($LASTEXITCODE -ne 0) { throw "docker build failed" }
} else {
  Write-Host "==> Skipping build (-NoBuild); using existing local image $Image"
}

Write-Host "==> Checking remote Docker..."
Invoke-Remote "command -v docker >/dev/null 2>&1" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "'docker' not found on $Target. Install Docker there first." }

Write-Host "==> Shipping image (docker save | gzip | ssh | docker load)..."
# Pipe the gzipped tar stream straight into the remote loader.
$sshTarget = if ($SshKey) { "ssh -p $Port -i `"$SshKey`" $Target" } else { "ssh -p $Port $Target" }
cmd /c "docker save $Image | gzip | $sshTarget `"gunzip | docker load`""
if ($LASTEXITCODE -ne 0) { throw "image transfer failed" }

Write-Host "==> Verifying image on remote..."
Invoke-Remote "docker image inspect '$Image' --format 'loaded: {{.Id}}'"

$remoteEnv = ''
if ($EnvFile) {
  if (-not (Test-Path $EnvFile)) { throw "env file not found: $EnvFile" }
  $remoteEnv = '$HOME/acp.env'
  Write-Host "==> Copying $EnvFile -> ${Target}:~/acp.env"
  scp @scpArgs $EnvFile "${Target}:~/acp.env"
}

if ($Run) {
  $envOpt = if ($remoteEnv) { "--env-file $remoteEnv" } else { '' }
  Write-Host "==> Running on remote: docker run --rm $envOpt $Image $Run"
  Invoke-Remote "docker run --rm $envOpt '$Image' $Run"
}

Write-Host ''
Write-Host "==> Done. On $Target you can now run:"
$envHint = if ($remoteEnv) { '--env-file ~/acp.env ' } else { '' }
Write-Host "    docker run --rm $envHint-v `"`$PWD/out:/work/out`" $Image acp pull-jira PROJ-1 /work/out"
Write-Host "    docker run -i --rm $envHint$Image"
