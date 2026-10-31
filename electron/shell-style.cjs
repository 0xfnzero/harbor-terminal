const fs = require('node:fs');
const path = require('node:path');

// App-owned startup files; never edit the user's shell configuration.
function styledShell(command, root, platform = process.platform, env = process.env) {
  const name = path.basename(command.executable).toLowerCase();
  if (platform === 'win32') return { ...command, args: ['-NoLogo', '-NoExit', '-Command', "if (Get-Module PSReadLine) { Set-PSReadLineOption -Colors @{ Command='Green'; String='Yellow'; Parameter='Cyan'; Operator='Magenta'; Comment='DarkGray'; Error='Red' } }; function global:prompt { Write-Host ($executionContext.SessionState.Path.CurrentLocation) -ForegroundColor Cyan; Write-Host '>' -ForegroundColor Green -NoNewline; ' ' }"] };
  if (!['zsh', 'bash'].includes(name)) return { ...command, env: { ...command.env, CLICOLOR: '1' } };
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const save = (file, text) => {
    const target = path.join(root, file);
    try { if (fs.readFileSync(target, 'utf8') === text) return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    fs.writeFileSync(target + '.tmp', text, { mode: 0o600 });
    fs.renameSync(target + '.tmp', target);
  };
  const colors = `export CLICOLOR=1\nexport LSCOLORS=ExGxFxdxCxegedabagacad\nexport LS_COLORS='di=01;34:ln=01;36:ex=01;32:pi=33:so=01;35:bd=33:cd=33:or=01;31:*.tar=01;31:*.gz=01;31:*.zip=01;31:*.jpg=35:*.png=35:*.mp4=35'\nalias grep='grep --color=auto'\n${platform === 'darwin' ? "alias ls='ls -G'" : "alias ls='ls --color=auto'"}\n`;
  if (name === 'bash') {
    save('bashrc', `# Preserve the normal login setup inside this app-owned interactive shell.\n[ ! -r /etc/profile ] || . /etc/profile\nfor file in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do\n  if [ -r "$file" ]; then . "$file"; break; fi\ndone\n${colors}PS1='\\[\\e[32m\\]\\u\\[\\e[0m\\] \\[\\e[36m\\]\\w\\[\\e[0m\\]\\n\\[\\e[32m\\]\\$\\[\\e[0m\\] '\n`);
    return { ...command, args: ['--rcfile', path.join(root, 'bashrc'), '-i'] };
  }
  save('.zshenv', `ZDOTDIR="$HARBOR_ORIGINAL_ZDOTDIR"\n[[ ! -r "$ZDOTDIR/.zshenv" ]] || source "$ZDOTDIR/.zshenv"\n[[ -n $ZDOTDIR ]] || ZDOTDIR="$HOME"\nexport HARBOR_ORIGINAL_ZDOTDIR="$ZDOTDIR"\nZDOTDIR="$HARBOR_STYLE_DIR"\n`);
  save('.zprofile', `ZDOTDIR="$HARBOR_ORIGINAL_ZDOTDIR"\n[[ ! -r "$ZDOTDIR/.zprofile" ]] || source "$ZDOTDIR/.zprofile"\n[[ -n $ZDOTDIR ]] || ZDOTDIR="$HOME"\nexport HARBOR_ORIGINAL_ZDOTDIR="$ZDOTDIR"\nZDOTDIR="$HARBOR_STYLE_DIR"\n`);
  save('.zshrc', `ZDOTDIR="$HARBOR_ORIGINAL_ZDOTDIR"\n[[ ! -r "$ZDOTDIR/.zshrc" ]] || source "$ZDOTDIR/.zshrc"\n${colors}PROMPT='%F{green}%n%f %F{cyan}%~%f\n%F{green}❯%f '\nif (( ! $+functions[_zsh_highlight] )) && [[ -r $HARBOR_HIGHLIGHTING_FILE ]]; then\n  source \"$HARBOR_HIGHLIGHTING_FILE\"\nfi\n# Paths use the terminal palette instead of hyperlink-like underlines.\nif (( $+functions[_zsh_highlight] )); then\n  ZSH_HIGHLIGHT_STYLES[path]=fg=cyan\n  ZSH_HIGHLIGHT_STYLES[path_prefix]=fg=cyan\n  ZSH_HIGHLIGHT_STYLES[path_pathseparator]=fg=cyan\n  ZSH_HIGHLIGHT_STYLES[path_prefix_pathseparator]=fg=cyan\nfi\n# Keep syntax colors without making pasted text look selected.\nzle_highlight=("\${(@)zle_highlight:#paste:*}" paste:none)\nunset HARBOR_ORIGINAL_ZDOTDIR HARBOR_STYLE_DIR HARBOR_HIGHLIGHTING_FILE\n`);
  return { ...command, args: ['-l'], env: { ...command.env, ZDOTDIR: root, HARBOR_HIGHLIGHTING_FILE: path.join(__dirname, 'vendor/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh').replace('app.asar/', 'app.asar.unpacked/'), HARBOR_STYLE_DIR: root, HARBOR_ORIGINAL_ZDOTDIR: env.ZDOTDIR || env.HOME || require('node:os').homedir() } };
}
module.exports = { styledShell };
