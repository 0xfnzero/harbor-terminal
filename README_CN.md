<div align="center">
    <h1>⚓ Harbor Terminal — SSH 客户端与终端模拟器</h1>
    <h3><em>面向 macOS、Windows 和 Linux 的多标签 SSH / Mosh 桌面终端</em></h3>
</div>

<p align="center">
    <strong>Harbor Terminal 是一个开源 SSH 客户端和终端模拟器，将本地 Shell 和远程服务器放进同一个工作空间，集成保存 SSH 连接、独立终端标签页、自动重连、可选 Mosh、服务器配置加密和自定义主题，并支持即时中英文切换。</strong>
</p>

<p align="center">
    <a href="https://github.com/0xfnzero/harbor-terminal/releases">
        <img src="https://img.shields.io/github/v/release/0xfnzero/harbor-terminal?include_prereleases" alt="版本">
    </a>
    <a href="#documentation">
        <img src="https://img.shields.io/badge/docs-English%20%2F%20中文-green.svg" alt="文档">
    </a>
    <a href="LICENSE">
        <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="许可证">
    </a>
    <a href="https://github.com/0xfnzero/harbor-terminal/stargazers">
        <img src="https://img.shields.io/github/stars/0xfnzero/harbor-terminal?style=social" alt="GitHub stars">
    </a>
    <img src="https://img.shields.io/badge/status-preview-orange.svg" alt="预览版">
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg" alt="支持平台">
</p>

<p align="center">
    <img src="https://img.shields.io/badge/Electron-47848F?style=for-the-badge&amp;logo=electron&amp;logoColor=white" alt="Electron">
    <img src="https://img.shields.io/badge/React-149ECA?style=for-the-badge&amp;logo=react&amp;logoColor=white" alt="React">
    <img src="https://img.shields.io/badge/SSH%20%2F%20Mosh-243449?style=for-the-badge&amp;logo=gnubash&amp;logoColor=white" alt="SSH / Mosh">
</p>

<p align="center">
    <a href="README_CN.md">中文</a> |
    <a href="README.md">English</a> |
    <a href="https://github.com/0xfnzero/harbor-terminal/releases">Releases</a> |
    <a href="https://fnzero.dev/">Website</a> |
    <a href="https://t.me/fnzero_group">Telegram</a> |
    <a href="https://discord.gg/vuazbGkqQE">Discord</a>
</p>

当前版本：**0.1.0 Preview**。已在 macOS 本机验证；包含 Windows/Linux 适配和构建流程，但原生实机验收仍待完成。本项目是桌面应用，尚未发布为 npm 包。

![Harbor Terminal 开源 SSH 客户端：服务器管理、中英文切换与终端工作空间](docs/images/harbor-terminal-zh.png)

## 目录

- [安装](#installation)
- [项目特性](#features)
- [使用示例](#usage)
- [连接与恢复说明](#connections)
- [安全与加密](#security)
- [文档索引](#documentation)
- [项目结构](#project-structure)
- [测试与构建](#testing)
- [重要说明](#important-notes)
- [许可证](#license)
- [联系方式](#contact)

<a id="installation"></a>

## 安装

### 下载客户端

在 [GitHub Releases](https://github.com/0xfnzero/harbor-terminal/releases) 下载客户端。首版提供 macOS Apple Silicon 预览包；每个 Release 列出可用平台、校验值和已知限制。

### 从源码运行

需要 Node.js **22.12+ 或 24+**、npm，以及系统 OpenSSH 客户端。克隆仓库并执行：

```sh
git clone https://github.com/0xfnzero/harbor-terminal.git
cd harbor-terminal
npm ci
npm run dev
```

构建界面并启动桌面应用：

```sh
npm start
```

Mosh 为可选组件。持久远程会话需要**服务器已安装 tmux**；关闭「持久会话」即可使用普通 SSH Shell。Windows 的本地 Shell 和可选 WSL 运行环境均在 Harbor 界面内使用。

<a id="features"></a>

## 项目特性

1. **服务器管理**：为 SSH 连接命名，点击即可在独立标签页中打开。
2. **多种认证方式**：本机 SSH 配置 / Agent、PEM 私钥、加密私钥口令、密码、交互式验证 / OTP 及 SSH 证书。
3. **连接恢复**：保活、有上限的退避重试、倒计时、暂停和手动重连；tmux 保留远程任务。
4. **可选 Mosh**：自适应预测回显、协议自身的网络恢复，以及可配置 UDP 端口。
5. **应用内组件安装**：在客户端完成 Mosh 安装，可使用获授权的服务器管理账号并添加指定防火墙规则。
6. **配置加密**：可选应用锁屏密码与 macOS Touch ID、AES-256-GCM 存储、每次解锁独立内存密钥，以及独立的标签页重连密钥。
7. **即时中英文切换**：工具栏和锁屏页均可选择中文 / English，重启后保留选择，切换无需重开终端。
8. **终端样式**：Harbor、Tokyo Night、Dracula、Nord、Daylight、Amber 六套预设；支持字体、间距、光标、ANSI 色板，以及最多 12 个自定义主题。
9. **终端性能**：原生 PTY、xterm.js、活动标签页 WebGL 渲染、批量输出与有界缓存。

<a id="usage"></a>

## 使用示例

### 📋 连接服务器

1. 点击「添加服务器」，填写名称、主机、用户名与 SSH 端口。
2. 在「认证」选择本机密钥、PEM 文件、私钥 + 密码或密码登录。密码与私钥口令在连接时输入，不会保存。
3. 在「网络与会话」调整策略，点击「保存连接」。
4. 点击左侧服务器，即可打开终端标签页；每次点击都会新建独立连接。

AWS 下载的 `.pem` 在「私钥 / PEM 文件」中选择。由 SSH CA 签发的证书是另一个可选文件；普通 `.pub` 文件不能替代私钥。是否要求追加密码或验证码由服务器决定。

### 🌐 切换语言

在顶部工具栏或锁屏页的 **Language / 语言** 中选择 **中文** 或 **English**。应用界面、原生应用菜单及应用生成的消息使用所选语言。服务器名称、自定义主题名称、命令及远程输出保持用户输入或服务器返回的原文。

语言选择保存在 Electron 用户数据目录下的 `preferences.json`，其中仅包含界面语言，服务器配置锁定时仍可使用。没有保存语言选择时默认使用英文；用户手动选择中文或英文后，重启继续保留所选语言。

### 🎨 自定义外观

打开「终端外观」，选择预设并调整字体、字号、行距、字间距、光标与配色。「应用并保存」立即更新现有终端，不重建 PTY。字体需要事先安装在本机；缺失时使用等宽字体回退。命令高亮遵循 ANSI 输出，输入语法高亮由 Shell 自身配置提供。

### ⌨️ 快捷键

- macOS：`⌘T` 打开本地终端，`⌘W` 关闭当前标签页。
- Windows/Linux：`Ctrl+Shift+T` 打开本地终端，`Ctrl+Shift+W` 关闭当前标签页。
- 下拉框支持方向键、Home/End、Enter 和 Escape。

<a id="connections"></a>

## 连接与恢复说明

### 🔄 SSH 与 tmux

SSH 在传输或认证异常退出后，以 1、2、4、8、16 秒间隔重试，之后最高保持 30 秒间隔。均衡、弱网容错、快速恢复三种策略调整保活检测和连接超时。检测时间为近似值；重连认证可能仍需要用户输入。

同一标签页复用原来的远程 tmux 会话标识。关闭标签页会分离客户端，持久远程任务继续运行。重新点击服务器或重启 Harbor 会创建新标签页 / 会话；需要时手动接回旧 tmux 会话。服务器重启或远程任务被结束后，单靠重连无法恢复任务。

### 📡 Mosh 组件与端口

Mosh 先用 SSH 认证，再使用 UDP。默认服务器端口为 **60042**，可在连接设置中修改。同一服务器的每个并发 Mosh 连接需要独立 UDP 端口，可配置最多 64 个端口的小范围。

「可选组件」支持安装本机客户端或服务器组件。自动安装支持 macOS Homebrew 及 Debian/Ubuntu 用户目录安装；获授权的 root 账号可安装共享的服务器系统包。Windows 安装流程内部使用 PowerShell/WSL，首次准备可能要求 UAC 授权或重启。

可选防火墙配置通过 UFW 或 firewalld 仅添加指定 UDP 端口 / 范围，不开启或关闭整个防火墙，也不修改云安全组。旧规则不会自动删除。Mosh 预测回显改善输入等待感，不减少真实网络 RTT 或远程命令耗时。UDP 不可达时，点击「改用 SSH」即可新建普通 SSH 标签页。

<a id="security"></a>

## 安全与加密

在「安全设置」启用独立的 Harbor 锁屏密码（至少 12 个字符），并可选择 macOS Touch ID。未开启此功能前，配置不属于加密存储。

- **磁盘**：服务器名称、地址、用户名、密钥路径和连接设置通过 AES-256-GCM 加密。随机数据密钥由密码经过 scrypt 派生的密钥保护（`N=131072, r=8, p=1`，随机盐）。
- **解锁后的配置**：每次解锁生成新的随机内存密钥。配置读取使用内存密文缓存，磁盘数据密钥只在解锁或保存时短暂可用。
- **已有会话**：每个标签页拥有独立随机密钥与加密配置快照。锁定后禁止配置访问、新建连接和终端输入，但已有连接与自动重连继续工作；关闭标签页时清除对应会话密钥。
- **Touch ID**：由 macOS 验证指纹，验证后通过 Electron safeStorage 获取系统保护的密钥。Harbor 不收集指纹。尚未实现 Windows Hello / Linux 指纹验证。
- **自动锁定**：默认闲置 30 分钟，也会在电脑锁屏、休眠或关闭应用窗口后锁定；解锁期间多个服务器复用一次认证。

外部 PEM 文件不会被导入或重新加密。SSH 密码、验证码和私钥口令不会保存。屏幕文本、终端缓存、运行中的 SSH/Mosh 和短暂解密的数据无法始终保持密文。为了后台重连，锁定期间仍会保留会话密钥；这不能防御拥有完整进程访问权限的攻击者。请保管好应用密码：没有密码且 Touch ID 不可用时，无法恢复加密配置。

<a id="documentation"></a>

## 文档索引

- [English README](README.md)
- [中文 README](README_CN.md)
- [开发、架构与验证记录](docs/DEVELOPMENT_CN.md)
- [首版发布说明](docs/releases/v0.1.0.md)
- [界面与后端共用翻译词典](shared/messages.json)

<a id="project-structure"></a>

## 项目结构

```text
terminal/
├── electron/        # PTY、SSH/Mosh、加密库、组件安装、原生菜单与 IPC
├── src/             # React 界面、终端标签页、对话框、外观与语言切换
├── shared/          # 主题预设与中英文翻译词典
├── test/            # 协议、加密及桌面 UI 回归测试
├── docs/            # 架构与验证记录
├── README.md        # 英文文档
└── README_CN.md     # 中文文档
```

<a id="testing"></a>

## 🧪 测试与构建

```sh
npm test                 # 核心逻辑、本地真实 SSH/Mosh、加密及翻译
npm run test:desktop     # 终端界面、吞吐量、服务器表单及重连
npm run test:security    # 锁屏、解锁、持久化及后台重连
npm run test:language    # 即时切换、语言持久化及 Shell 连续性

npm run pack:mac         # 本机架构 .app
npm run pack:win         # x64 NSIS 安装包与便携 EXE
npm run pack:linux       # x64 AppImage 与 deb
```

请在目标操作系统构建，使原生 PTY 依赖与平台匹配。产物默认位于 `release/`，开发验收版可能使用 `release-next/`。构建与测试在本地执行，本仓库不启用 GitHub Actions。

<a id="important-notes"></a>

## ⚠️ 重要说明

- 当前为预览版，已测试的桌面平台为 macOS。Windows/Linux 原生验收与真人 Touch ID 验证仍待完成。
- macOS 预览包未签名，正式分发还需签名、公证和正式应用图标。
- Mosh 及其运行环境为外部可选组件，当前不是完整离线安装包，也没有第三方插件市场。
- 空闲与恢复测试使用有界测试场景和指定真实 SSH 会话，不能保证应对所有网络中断或服务器重启。
- 启用安全锁前，服务器设置为普通本地 JSON。启用时原子替换为密文文件，但无法清除文件系统快照、旧备份或 SSD 历史数据块。

<a id="license"></a>

## 📄 许可证

本项目采用 [MIT License](LICENSE)。

<a id="contact"></a>

## 💬 联系方式

- 项目仓库：https://github.com/0xfnzero/harbor-terminal
- 下载与版本：https://github.com/0xfnzero/harbor-terminal/releases
- 官网：https://fnzero.dev/
- Telegram 群组：https://t.me/fnzero_group
- Discord：https://discord.gg/vuazbGkqQE
