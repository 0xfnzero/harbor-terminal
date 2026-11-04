// Only classify terminal OpenSSH failures after exit 255. Never retry credentials
// or host trust errors automatically; the user must correct them first.
function sshFailure(output) {
  if (/^.*Permission denied \([a-z0-9,@._-]+\)\.?\r?$/mi.test(output)) return 'SSH 认证失败，请检查用户名、私钥或密码后重新连接。已停止自动重试。';
  if (/^Host key verification failed\.\r?$/m.test(output)) return 'SSH 主机密钥验证失败，请核实服务器身份后重新连接。已停止自动重试。';
  return null;
}
module.exports = { sshFailure };
