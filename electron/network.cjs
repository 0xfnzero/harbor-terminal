const { t: tr } = require('./locale.cjs');
function portSpec(server, separator = ':') {
  const start = Number(server.moshPort ?? 60042);
  const end = Number(server.moshPortEnd ?? start);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1024 || end > 65535 || end < start || end - start > 63) throw new Error(tr("UDP 端口需介于 1024–65535，范围最多 64 个端口"));
  return start === end ? String(start) : `${start}${separator}${end}`;
}
function firewallScript(server) {
  const ufwPort = portSpec(server);
  const firewalldPort = portSpec(server, '-');
  return `
printf '\\n[Harbor] Configuring UDP ${ufwPort} for Mosh...\\n'
run_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; return $?; fi
  if ! command -v sudo >/dev/null 2>&1; then printf 'Administrator permission is required.\\n'; return 1; fi
  if result=$(LC_ALL=C sudo -n "$@" 2>&1); then printf '%s\\n' "$result"; return 0; fi
  case "$result" in
    *'a password is required'*) sudo -p '[Harbor] password: ' "$@";;
    *) printf '%s\\n' "$result"; return 1;;
  esac
}
if command -v ufw >/dev/null 2>&1; then
  if ! run_root ufw allow ${ufwPort}/udp comment 'Harbor Mosh'; then
    printf '\\n[Harbor] Component installed; UDP rule needs administrator access.\\n'; exit 72
  fi
elif command -v firewall-cmd >/dev/null 2>&1; then
  if ! run_root firewall-cmd --permanent --add-port=${firewalldPort}/udp || ! run_root firewall-cmd --add-port=${firewalldPort}/udp; then
    printf '\\n[Harbor] Component installed; firewall rule could not be applied.\\n'; exit 72
  fi
else
  printf '\\n[Harbor] Component installed. No supported firewall manager found (UFW/firewalld). Ask the server administrator to allow UDP ${ufwPort}.\\n'; exit 72
fi
printf '\\n[Harbor] Host firewall rule configured for UDP ${ufwPort}. Cloud firewall/security-group rules are separate and may still require provider authorization.\\n'
`;
}
module.exports = { portSpec, firewallScript };
