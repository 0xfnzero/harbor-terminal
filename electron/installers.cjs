const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";

// Download distro packages into a versioned user directory. No sudo, service
// changes, firewall changes, or writes to the remote project's working tree.
function linuxInstaller(role = 'server') {
  if (!['client', 'server'].includes(role)) throw new Error('Invalid component role');
  return `set -eu
role=${quote(role)}
if [ "$role" = server ] && [ "$(id -u)" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then
  if ! command -v mosh-server >/dev/null 2>&1; then apt-get install -y --no-install-recommends mosh; fi
  mosh-server --version
  printf '\\nMosh server is available to all server users.\\n'
  exit 0
fi
if [ "$role" = server ] && command -v mosh-server >/dev/null 2>&1; then mosh-server --version; printf '\\nMosh server already available.\\n'; exit 0; fi
if [ "$role" = client ] && command -v mosh >/dev/null 2>&1 && command -v mosh-client >/dev/null 2>&1; then mosh-client --version; printf '\\nMosh client already available.\\n'; exit 0; fi
if ! command -v apt-cache >/dev/null 2>&1 || ! command -v dpkg-deb >/dev/null 2>&1; then
  printf '\\nAutomatic user installation currently supports Debian/Ubuntu. Install mosh with your distribution package manager, then retry.\\n'; exit 69
fi
root="$HOME/.local/share/harbor/components/mosh"
mkdir -p "$root" "$HOME/.local/bin"
exec 9>"$root/install.lock"
if ! flock -n 9; then printf 'Another Mosh installer is running.\\n'; exit 73; fi
stage=$(mktemp -d "$root/version.XXXXXX")
trap 'rm -rf "$stage/downloads"' EXIT
trap 'exit 130' HUP INT TERM
mkdir "$stage/downloads"
cd "$stage/downloads"
libs=$(apt-cache depends --recurse --important --no-recommends --no-suggests mosh | sed -n 's/^[[:space:]]*Depends: \\(lib[a-zA-Z0-9.+-]*\\)$/\\1/p')
# Package names come only from the system package index, not from UI input.
missing=""
for lib in $libs; do
  if ! dpkg -s "$lib" 2>/dev/null | grep -q '^Status: install ok installed$'; then missing="$missing $lib"; fi
done
apt download mosh $missing
for package in ./*.deb; do dpkg-deb -x "$package" "$stage"; done
libdirs=$(find "$stage/usr/lib" -type d | paste -sd : -)
export LD_LIBRARY_PATH="$libdirs\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
"$stage/usr/bin/mosh-server" --version
if [ "$role" = client ]; then "$stage/usr/bin/mosh-client" --version; fi
rm -rf "$stage/downloads"
# Publish only after the extracted binary successfully starts.
ln -s "$stage" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
for program in mosh-server; do
  if [ -e "$HOME/.local/bin/$program" ]; then printf 'Keeping existing %s\\n' "$HOME/.local/bin/$program"; continue; fi
  cat > "$HOME/.local/bin/$program" <<'WRAPPER'
#!/bin/sh
root="$HOME/.local/share/harbor/components/mosh/current"
libdirs=$(find "$root/usr/lib" -type d | paste -sd : -)
export LD_LIBRARY_PATH="$libdirs\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$root/usr/bin/mosh-server" "$@"
WRAPPER
  chmod 755 "$HOME/.local/bin/$program"
done
printf '\\nHarbor Mosh installed at %s/current\\nNo system services or firewall settings changed.\\n' "$root"
`;
}

function localInstaller(platform = process.platform) {
  if (platform === 'darwin') return `set -eu
if [ -x /opt/homebrew/bin/brew ]; then brew=/opt/homebrew/bin/brew
elif [ -x /usr/local/bin/brew ]; then brew=/usr/local/bin/brew
else printf 'Homebrew is required for this installer. Install it from https://brew.sh, then retry.\\n'; exit 69; fi
HOMEBREW_NO_AUTO_UPDATE=1 "$brew" install mosh
printf '\\nMosh client installation completed.\\n'
`;
  return linuxInstaller('client');
}
module.exports = { linuxInstaller, localInstaller, quote };

function windowsInstaller() {
  return `$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$wsl = Join-Path $env:SystemRoot 'System32\\wsl.exe'
Write-Output 'Checking the enhanced terminal runtime...'
$names = @()
try { $names = @(& $wsl --list --quiet 2>$null | ForEach-Object { ($_.Replace([string][char]0, '')).Trim() }) } catch {}
$distribution = @($names | Where-Object { $_ -match '^(Ubuntu|Debian)' } | Select-Object -First 1)
if ($distribution.Count -eq 0) {
  Write-Output 'Preparing the runtime. Windows may request system authorization.'
  $setup = Start-Process -FilePath $wsl -ArgumentList '--install --distribution Ubuntu --no-launch' -Verb RunAs -WindowStyle Hidden -Wait -PassThru
  if ($setup.ExitCode -eq 3010) { Write-Output 'Restart your computer and continue installation in Harbor.'; exit 75 }
  if ($setup.ExitCode -ne 0) { throw 'Windows could not prepare the runtime. Check installation details or restart and retry.' }
  $distribution = @('Ubuntu')
}
$distro = $distribution[0]
& $wsl --distribution $distro --user root --exec /bin/true
if ($LASTEXITCODE -ne 0) { Write-Output 'The runtime is not ready. Restart Windows and retry installation in Harbor.'; exit 75 }
Write-Output 'Installing the optional terminal component...'
$script = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:HARBOR_LINUX_INSTALL_B64))
$payload = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('set -e' + [char]10 + 'apt-get update' + [char]10 + $script))
$payload | & $wsl --distribution $distro --user root --exec sh -c 'base64 -di | sh'
if ($LASTEXITCODE -ne 0) { exit 1 }
$state = @{ distribution = $distro; user = 'root' } | ConvertTo-Json
[System.IO.File]::WriteAllText($env:HARBOR_RUNTIME_CONFIG, $state, (New-Object System.Text.UTF8Encoding($false)))
Write-Output 'The enhanced terminal component is ready.'
`;
}
module.exports.windowsInstaller = windowsInstaller;
