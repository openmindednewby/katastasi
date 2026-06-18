# One-shot getting-started: build the ai-confluence-pipeline image and deploy it
# to LOCAL Docker Desktop or a REMOTE Docker host over SSH (no registry).
#
# Usage:
#   ./scripts/getting-started.ps1                              # interactive
#   ./scripts/getting-started.ps1 -Mode local
#   ./scripts/getting-started.ps1 -Mode local -WithN8n
#   ./scripts/getting-started.ps1 -Mode remote -Target user@host
#   ./scripts/getting-started.ps1 -Mode remote -Target user@host -SshKey ~/.ssh/id_ed25519 -WithN8n
[CmdletBinding()]
param(
  [ValidateSet('local', 'remote', '')] [string]$Mode = '',
  [string]$Target = '',
  [string]$Image = 'acp:latest',
  [string]$SshKey = '',
  [int]$Port = 22,
  [switch]$WithN8n,
  [switch]$NoBuild
)
$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$ProjectDir = Split-Path -Parent $ScriptDir
Set-Location $ProjectDir

if (-not $Mode) {
  Write-Host 'Where do you want to deploy ai-confluence-pipeline?'
  Write-Host '  1) Local Docker Desktop'
  Write-Host '  2) Remote Docker host over SSH'
  $choice = Read-Host 'Choose [1/2]'
  if ($choice -eq '2') { $Mode = 'remote'; $Target = Read-Host 'Remote target (user@host)' }
  else { $Mode = 'local' }
}
if ($Mode -eq 'remote' -and -not $Target) { throw 'remote needs -Target user@host' }

Write-Host ''
Write-Host '==================================================================='
Write-Host "  ai-confluence-pipeline getting-started"
Write-Host "  mode: $Mode   target: $Target   image: $Image   n8n: $WithN8n"
Write-Host '==================================================================='

# Prerequisites
docker info | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker daemon not reachable. Start Docker Desktop and retry.' }

if (-not (Test-Path .env)) {
  Write-Host '==> No .env found — creating one from .env.example.'
  Copy-Item .env.example .env
  Write-Host '    Edit .env and fill in JIRA_* / CONFLUENCE_* before using pull/push/publish.'
}

if (-not $NoBuild) {
  Write-Host "==> Building image $Image ..."
  docker build -t $Image $ProjectDir
  if ($LASTEXITCODE -ne 0) { throw 'docker build failed' }
}

if ($Mode -eq 'local') {
  Write-Host '==> Verifying the image runs locally...'
  docker run --rm $Image acp --version | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Host '    acp CLI OK' }
  '' | docker run -i --rm $Image acp-mcp 2>&1 | Select-Object -First 1

  if ($WithN8n) {
    Write-Host '==> Starting the n8n stack (docker compose up -d)...'
    docker compose up -d
    Write-Host '    n8n UI: http://localhost:10353 (import + activate workflows/ as in docs/INSTALL.md)'
  }

  Write-Host ''
  Write-Host '==> Local deploy done. Try:'
  Write-Host "    docker run --rm --env-file .env -v `"`$PWD/out:/work/out`" $Image acp pull-jira PROJ-12 /work/out"
  Write-Host "    docker run --rm --env-file .env -v `"`$PWD/out:/work/out`" $Image acp push-folder /work/out"
  Write-Host ''
  Write-Host '  Register the MCP server with Claude Code (.mcp.json):'
  Write-Host "    `"ai-confluence-pipeline`": { `"command`": `"docker`","
  Write-Host "      `"args`": [`"run`",`"-i`",`"--rm`",`"--env-file`",`"$ProjectDir\.env`",`"$Image`"] }"
}
else {
  Write-Host "==> Deploying to remote $Target over SSH..."
  $deployArgs = @('-Target', $Target, '-Image', $Image, '-NoBuild', '-EnvFile', '.env')
  if ($SshKey) { $deployArgs += @('-SshKey', $SshKey) }
  if ($Port -ne 22) { $deployArgs += @('-Port', $Port) }
  & (Join-Path $ScriptDir 'docker-deploy-remote.ps1') @deployArgs

  if ($WithN8n) {
    Write-Host "==> Bringing up the n8n stack on $Target ..."
    $sshArgs = @('-p', "$Port"); $scpArgs = @('-P', "$Port")
    if ($SshKey) { $sshArgs += @('-i', $SshKey); $scpArgs += @('-i', $SshKey) }
    ssh @sshArgs $Target 'mkdir -p ~/acp-pipeline'
    scp @scpArgs docker-compose.yml "${Target}:~/acp-pipeline/docker-compose.yml"
    scp @scpArgs .env "${Target}:~/acp-pipeline/.env"
    ssh @sshArgs $Target 'cd ~/acp-pipeline && docker compose up -d'
    Write-Host '    n8n is starting on the remote (port from .env N8N_PORT, default 10353).'
  }

  Write-Host ''
  Write-Host "==> Remote deploy done. On $Target the image '$Image' is loaded and ready."
}
