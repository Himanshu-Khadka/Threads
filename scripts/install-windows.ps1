param([Parameter(Mandatory=$true)][string]$VaultPath, [switch]$Update)
$ErrorActionPreference = 'Stop'
$vault = (Resolve-Path -LiteralPath $VaultPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $vault '.obsidian') -PathType Container)) {
    throw 'Choose a vault opened in Obsidian, with its default .obsidian configuration folder.'
}
$source = Join-Path (Split-Path $PSScriptRoot -Parent) 'dist\threads-sync'
$target = Join-Path $vault '.obsidian\plugins\threads-sync'
if ((Test-Path -LiteralPath $target) -and -not $Update) {
    throw 'Threads is already installed. Disable it in Obsidian, then rerun with -Update. Existing settings will be preserved.'
}
foreach ($name in @('main.js', 'manifest.json', 'styles.css')) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $name))) { throw 'Build missing. Run npm ci, then npm run package, or use the packaged release.' }
}
if (Test-Path -LiteralPath $target) {
    $stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
    $backup = Join-Path (Split-Path $PSScriptRoot -Parent) ('install-backups\' + $stamp)
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    foreach ($name in @('main.js', 'manifest.json', 'styles.css')) {
        $oldFile = Join-Path $target $name
        if (Test-Path -LiteralPath $oldFile) { Copy-Item -LiteralPath $oldFile -Destination (Join-Path $backup $name) }
    }
    Write-Host "Previous plugin code backed up to $backup"
} else {
    New-Item -ItemType Directory -Path $target -Force | Out-Null
}
foreach ($name in @('main.js', 'manifest.json', 'styles.css')) {
    Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $target $name)
}
Write-Host "Installed Threads to $target"
Write-Host 'Existing data.json was preserved. Restart Obsidian, then enable Threads in Settings > Community plugins.'
