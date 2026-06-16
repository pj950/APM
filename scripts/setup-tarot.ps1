param(
  [Parameter(Mandatory = $true)]
  [string]$TarotDir,
  [switch]$OverwriteIndex
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$dest = Join-Path $repoRoot 'public\tarot'
$destAssets = Join-Path $dest 'assets'
$indexPath = Join-Path $dest 'index.html'
$envFile = Join-Path $repoRoot '.env'

if (-not (Test-Path $TarotDir)) {
  Write-Error "Source directory not found: $TarotDir"
  exit 1
}

New-Item -ItemType Directory -Force -Path $destAssets | Out-Null

$sourceIndex = Join-Path $TarotDir 'index.html'
if (-not (Test-Path $sourceIndex)) {
  Write-Error "index.html not found in source directory: $TarotDir"
  exit 1
}

if ($OverwriteIndex -or -not (Test-Path $indexPath)) {
  Copy-Item $sourceIndex $indexPath -Force
  Write-Host 'Copied index.html'
} else {
  Write-Host 'Kept existing public/tarot/index.html'
}

$sourceBack = Join-Path $TarotDir 'tarot-card-back.jpg'
if (Test-Path $sourceBack) {
  Copy-Item $sourceBack (Join-Path $dest 'tarot-card-back.jpg') -Force
  Write-Host 'Copied tarot-card-back.jpg'
}

$sourceAssets = Join-Path $TarotDir 'assets'
if (Test-Path $sourceAssets) {
  Copy-Item (Join-Path $sourceAssets '*') $destAssets -Recurse -Force
  $count = (Get-ChildItem $destAssets -File | Measure-Object).Count
  Write-Host "Copied assets ($count files)"
} else {
  Write-Warning 'assets directory not found. Card images will be missing.'
}

$html = Get-Content $indexPath -Raw -Encoding UTF8
$html = $html -replace "proxyURL:\s*'http://localhost:\d+/api/tarot-reading'", "proxyURL: '/api/tarot-reading'"
[System.IO.File]::WriteAllText($indexPath, $html, [System.Text.Encoding]::UTF8)
Write-Host 'Patched proxyURL to /api/tarot-reading'

if (-not (Test-Path $envFile) -or -not (Select-String -Path $envFile -Pattern 'DEEPSEEK_API_KEY' -Quiet)) {
  Write-Warning 'Add DEEPSEEK_API_KEY=sk-... to .env before using tarot reading.'
}

Write-Host 'Tarot assets are ready. Start npm run dev and click Mars.'
