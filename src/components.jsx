import { t as tr, useLanguage } from './i18n.jsx';
import { Select } from './select.jsx';
import React, { useEffect, useState } from 'react';

export function ComponentsDialog({ api, servers, onClose, onInstall }) {
  useLanguage();
  const [cap, setCap] = useState(null);
  const [target, setTarget] = useState('local');
  const [serverId, setServerId] = useState(servers[0]?.id || '');
  const [installUsername, setInstallUsername] = useState('');
  const [configureNetwork, setConfigureNetwork] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.getCapabilities().then(setCap).catch(e => setError(e.message)); }, []);
  const remote = target === 'remote';
  const selected = servers.find(s => s.id === serverId);
  const udpStart = selected?.moshPort ?? 60042;
  const udpEnd = selected?.moshPortEnd ?? udpStart;
  const udpSpec = udpStart === udpEnd ? String(udpStart) : `${udpStart}–${udpEnd}`;
  const windows = cap?.platform === 'win32';
  return <div className="modal-overlay"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="components-title">
    <div className="modal-heading"><div><div className="eyebrow">{tr("可选组件")}</div><h2 id="components-title">{tr("可选组件 · Mosh")}</h2></div><button className="secondary" onClick={onClose}>{tr("关闭")}</button></div>
    <p className="form-note">{tr("Mosh 改善弱网下的交互与预测回显。普通 SSH 无需此组件，仍可使用。安装进度将在独立终端标签页显示。")}</p>
    <p role="status">{cap ? tr("本机 Mosh：{0}", [cap.mosh ? tr("已检测到") : tr("未检测到")]) : tr("正在检查本机组件…")}</p>
    <label>{tr("安装位置")}<Select aria-label={tr("安装位置")} value={target} onChange={e => { setTarget(e.target.value); setConfirmed(false); }}><option value="local">{tr("本机客户端")}</option><option value="remote">{tr("服务器端 · 通过 SSH 安装")}</option></Select></label>
    {remote && <label>{tr("目标服务器")}<Select aria-label={tr("目标服务器")} value={serverId} onChange={e => { setServerId(e.target.value); setConfirmed(false); }}><option value="" disabled>{tr("请选择已保存的服务器")}</option>{servers.map(s => <option key={s.id} value={s.id}>{s.name} · {s.username ? s.username + '@' : ''}{s.host}:{s.port}</option>)}</Select></label>}
    {remote && <label>{tr("安装管理账号 ")}<span className="optional">{tr("可选，默认使用连接账号")}</span><input aria-label={tr("安装管理账号")} placeholder={tr("例如 root")} value={installUsername} onChange={e => { setInstallUsername(e.target.value); setConfirmed(false); }}/></label>}
    <div className="component-details">{remote ? <><strong>{(installUsername || selected?.username) === 'root' ? tr("以管理员身份安装共享组件") : tr("安装到服务器用户目录")}</strong><p>{tr("自动安装支持 Debian / Ubuntu。以 root 安装时，通过 apt 安装系统组件，供其他账号共用；普通账号安装到用户目录。已有 Mosh 会直接复用。安装管理账号只用于本次操作，不会修改已保存的登录账号。")}</p><p>{tr("组件安装无需 sudo。下方可选择一并配置服务器防火墙规则，需要管理员权限；不会开启或关闭整个防火墙。云安全组可能还需云平台授权。")}</p></> : windows ? <><strong>{tr("自动准备 Windows 运行环境")}</strong><p>{tr("应用将自动检查并安装所需运行环境和 Mosh 组件。首次安装可能需要系统授权或重启电脑；完成后回到应用即可继续。")}</p><p>{tr("所有连接和认证均在本应用内完成，无需打开其他终端或手动输入安装命令。")}</p></> : cap?.platform === 'darwin' ? <><strong>{tr("使用 Homebrew 安装")}</strong><p>{tr("运行 brew install mosh，安装到 Homebrew 目录，并可能安装或更新所需共享依赖。本机需要先安装 Homebrew。")}</p></> : <><strong>{tr("安装到本机用户目录")}</strong><p>{tr("自动安装支持 Debian / Ubuntu，无需 sudo，从系统软件仓库下载并解压到 ~/.local/share/harbor/components/mosh。其他发行版请使用系统软件包管理器安装。")}</p></>}</div>
    {remote && <label className="checkbox"><input type="checkbox" checked={configureNetwork} onChange={e => setConfigureNetwork(e.target.checked)}/><span>{tr("安装时配置服务器防火墙：UDP ")}{udpSpec}{tr("（端口可在服务器连接设置中修改）")}</span></label>}
    <label className="checkbox"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/><span>{tr("我已了解安装位置及操作，允许安装所选组件")}</span></label>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="modal-footer"><button className="secondary" onClick={onClose}>{tr("取消")}</button><button className="primary" disabled={!cap || !confirmed || (remote && !serverId)} onClick={() => { try { onInstall(remote ? servers.find(s => s.id === serverId) : null, configureNetwork, installUsername.trim()); } catch (e) { setError(e.message); } }}>{tr("开始安装")}</button></div>
  </div></div>;
}

export function InstallationPane({ api, tab, active, onStatus }) {
  useLanguage();
  const [log, setLog] = useState('');
  const [state, setState] = useState('starting');
  const [details, setDetails] = useState(false);
  const [prompt, setPrompt] = useState(false);
  const [answer, setAnswer] = useState('');
  useEffect(() => {
    let tail = '';
    const off = api.onEvent(event => {
      if (event.id !== tab.id) return;
      if (event.type === 'data') {
        tail = (tail + event.data).slice(-16000);
        setLog(tail.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''));
        setPrompt(/(?:password|passphrase|yes\/no|密码|口令)[^\n]*[:?]\s*$/i.test(tail));
        api.ack(tab.id, event.data.length, event.generation);
      } else { setState(event.state); onStatus(tab.id, event); }
    });
    api.openSession({ id: tab.id, serverId: tab.server?.id, purpose: tab.purpose, configureNetwork: tab.configureNetwork, installUsername: tab.installUsername, cols: 100, rows: 30 }).catch(e => { setLog(e.message); setState('error'); onStatus(tab.id, { state: 'error', message: e.message }); });
    return () => { off(); api.closeSession(tab.id).catch(() => {}); };
  }, []);
  const completed = state === 'installed';
  const failed = ['install-failed', 'error'].includes(state);
  const networkRequired = state === 'network-required';
  const restart = state === 'restart-required';
  return <div className={`installation-pane ${active ? 'active' : ''}`}>
    <div className="installation-card"><div className="eyebrow">{tr("Harbor 组件")}</div><h2>{completed ? tr("组件已就绪") : networkRequired ? tr("组件已安装，端口待配置") : restart ? tr("需要重启电脑") : failed ? tr("安装未完成") : tr("正在准备 Mosh 组件")}</h2>
      <p>{completed ? tr("组件配置已完成。首次连接将验证网络是否可达；云平台安全组若有限制，仍需要对应授权。") : networkRequired ? tr("Mosh 已安装，但端口规则未能自动配置。请使用有防火墙管理权限的服务器账号重试，或在详情中查看原因；普通 SSH 仍可正常使用。") : restart ? tr("系统已准备运行环境。重启电脑后，返回可选组件，再次点击安装即可继续。") : failed ? tr("查看详情了解原因。你仍可正常使用 SSH 连接。") : tr("安装目标：{0}。请保持应用打开；所有安装步骤都在应用内完成。", [tab.server?.name || tr("本机")])}</p>
      {!completed && !failed && !restart && !networkRequired && <progress aria-label={tr("组件安装进度")}/>}
      {prompt && <form onSubmit={e => { e.preventDefault(); api.input(tab.id, answer + '\r'); setAnswer(''); setPrompt(false); }}><p className="form-note">{tr("连接需要认证或确认服务器指纹。请查看下面的提示后输入；认证内容不会保存。")}</p><pre className="installer-prompt">{log.slice(-2000)}</pre><input aria-label={tr("安装认证输入")} type="password" autoComplete="off" value={answer} onChange={e => setAnswer(e.target.value)}/><button className="primary">{tr("继续")}</button></form>}
      <button className="secondary" onClick={() => setDetails(!details)}>{details ? tr("收起安装详情") : tr("查看安装详情")}</button>
      {details && <pre className="installer-log">{log || tr("正在启动…")}</pre>}
    </div>
  </div>;
}
