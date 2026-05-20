// src/discovery/uri_handler_scripts.ts — Iter3 P0.2: served as static text
// at /scripts/uri-handler/install-{macos.sh,windows.ps1,linux.sh}.
//
// All three scripts are idempotent (re-running them is a no-op once the
// handler is registered) and require no admin privileges.

export const INSTALL_MACOS_SH = `#!/usr/bin/env bash
# install-macos.sh — register verdigraph:// URI scheme on macOS.
# Resolves verdigraph://brain/<id> -> https://verdigraph.dev/app/brains/<id>
#
# Usage:
#   curl -sS https://verdigraph.dev/scripts/uri-handler/install-macos.sh | bash
#
# Idempotent. No admin privileges required.

set -euo pipefail

APP_DIR="\${HOME}/Library/Application Support/Verdigraph/UriHandler.app"
INFO_PLIST="\${APP_DIR}/Contents/Info.plist"
SHIM="\${APP_DIR}/Contents/MacOS/UriHandler"

mkdir -p "\${APP_DIR}/Contents/MacOS"
mkdir -p "\${APP_DIR}/Contents/Resources"

cat > "\${INFO_PLIST}" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>UriHandler</string>
  <key>CFBundleIdentifier</key><string>dev.verdigraph.UriHandler</string>
  <key>CFBundleName</key><string>Verdigraph URI Handler</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>Verdigraph</string>
      <key>CFBundleURLSchemes</key>
      <array><string>verdigraph</string></array>
    </dict>
  </array>
</dict>
</plist>
PLIST

cat > "\${SHIM}" <<'SHIM'
#!/usr/bin/env bash
# Invoked by macOS with the URI as the first argument when verdigraph:// is opened.
set -euo pipefail
URI="\${1:-}"
if [[ -z "\${URI}" ]]; then exit 0; fi
# verdigraph://brain/<id>     -> https://verdigraph.dev/app/brains/<id>
# verdigraph://genome/<id>    -> https://verdigraph.dev/app/genomes/<id>
PATH_PART="\${URI#verdigraph://}"
HTTPS_URL="https://verdigraph.dev/app/\${PATH_PART/brain\\//brains/}"
HTTPS_URL="\${HTTPS_URL/genome\\//genomes/}"
open "\${HTTPS_URL}"
SHIM
chmod +x "\${SHIM}"

# Register the .app bundle with macOS LaunchServices so it owns the verdigraph:// scheme.
LSREG="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
if [[ -x "\${LSREG}" ]]; then
  "\${LSREG}" -f "\${APP_DIR}"
fi

echo "✓ verdigraph:// scheme registered on macOS"
echo "  Bundle: \${APP_DIR}"
echo "  Try: open verdigraph://brain/G0HMXXZ360QZWNVHHWKXMHZVCJ"
`;

export const INSTALL_WINDOWS_PS1 = `# install-windows.ps1 — register verdigraph:// URI scheme on Windows.
# Resolves verdigraph://brain/<id> -> https://verdigraph.dev/app/brains/<id>
#
# Usage:
#   irm https://verdigraph.dev/scripts/uri-handler/install-windows.ps1 | iex
#
# Idempotent. Per-user (HKCU). No admin privileges required.

$ErrorActionPreference = 'Stop'

$shimDir = Join-Path $env:LOCALAPPDATA 'Verdigraph'
$shim    = Join-Path $shimDir 'verdigraph-uri-handler.ps1'

New-Item -ItemType Directory -Force -Path $shimDir | Out-Null

@'
param([string]$Uri)
if (-not $Uri) { exit 0 }
$path = $Uri -replace '^verdigraph://', ''
$path = $path -replace '^brain/',  'brains/'
$path = $path -replace '^genome/', 'genomes/'
Start-Process "https://verdigraph.dev/app/$path"
'@ | Set-Content -Path $shim -Encoding UTF8

# Per-user URI scheme registration in HKCU.
$root = 'HKCU:\\Software\\Classes\\verdigraph'
New-Item -Path $root           -Force | Out-Null
Set-ItemProperty -Path $root -Name '(default)' -Value 'URL:Verdigraph Protocol'
Set-ItemProperty -Path $root -Name 'URL Protocol' -Value ''
New-Item -Path "$root\\shell\\open\\command" -Force | Out-Null
Set-ItemProperty -Path "$root\\shell\\open\\command" -Name '(default)' \`
  -Value ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $shim + '" -Uri "%1"')

Write-Host "✓ verdigraph:// scheme registered (HKCU)"
Write-Host "  Shim: $shim"
Write-Host "  Try: Start-Process verdigraph://brain/G0HMXXZ360QZWNVHHWKXMHZVCJ"
`;

export const INSTALL_LINUX_SH = `#!/usr/bin/env bash
# install-linux.sh — register verdigraph:// URI scheme on Linux.
# Resolves verdigraph://brain/<id> -> https://verdigraph.dev/app/brains/<id>
#
# Usage:
#   curl -sS https://verdigraph.dev/scripts/uri-handler/install-linux.sh | bash
#
# Idempotent. Per-user. No admin privileges required.

set -euo pipefail

BIN_DIR="\${HOME}/.local/bin"
DESKTOP_DIR="\${HOME}/.local/share/applications"
SHIM="\${BIN_DIR}/verdigraph-uri-handler"
DESKTOP_FILE="\${DESKTOP_DIR}/verdigraph-uri-handler.desktop"

mkdir -p "\${BIN_DIR}" "\${DESKTOP_DIR}"

cat > "\${SHIM}" <<'SHIM'
#!/usr/bin/env bash
URI="\${1:-}"
[[ -z "\${URI}" ]] && exit 0
PATH_PART="\${URI#verdigraph://}"
HTTPS_URL="https://verdigraph.dev/app/\${PATH_PART/brain\\//brains/}"
HTTPS_URL="\${HTTPS_URL/genome\\//genomes/}"
xdg-open "\${HTTPS_URL}"
SHIM
chmod +x "\${SHIM}"

cat > "\${DESKTOP_FILE}" <<DESK
[Desktop Entry]
Name=Verdigraph URI Handler
Exec=\${SHIM} %u
Type=Application
NoDisplay=true
MimeType=x-scheme-handler/verdigraph;
DESK

xdg-mime default verdigraph-uri-handler.desktop x-scheme-handler/verdigraph
update-desktop-database "\${DESKTOP_DIR}" 2>/dev/null || true

echo "✓ verdigraph:// scheme registered on Linux"
echo "  Shim:    \${SHIM}"
echo "  Desktop: \${DESKTOP_FILE}"
echo "  Try: xdg-open verdigraph://brain/G0HMXXZ360QZWNVHHWKXMHZVCJ"
`;
