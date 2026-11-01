.DEFAULT_GOAL := help
NPM ?= npm
ARCH ?= native
OUT ?= release

.PHONY: help install dev start build test test-desktop test-security test-language test-terminal test-components test-quit test-servers test-pty test-scroll test-layout test-all pack pack-mac pack-win pack-linux

help: ## Show all commands and descriptions
	@node scripts/make-help.cjs

install: ## Install dependencies from package-lock.json
	$(NPM) ci

dev: ## Run the development app with Vite hot reload
	$(NPM) run dev

start: ## Build and launch the desktop app locally
	$(NPM) start

build: ## Build the production renderer (not an installer)
	$(NPM) run build

test: ## Run core, SSH/Mosh, encryption and translation tests
	$(NPM) test

test-desktop: ## Run terminal and server-management UI tests
	$(NPM) run test:desktop

test-security: ## Run lock, encryption and reconnect UI tests
	$(NPM) run test:security

test-language: ## Run English/Chinese UI tests
	$(NPM) run test:language

test-terminal: ## Run copy, paste, context-menu and search UI tests
	$(NPM) run test:terminal

test-components: ## Test tmux detection, installation and persistent connection UI
	$(NPM) run test:components

test-quit: ## Verify native app quit and bounded cleanup
	$(NPM) run test:quit

test-servers: ## Test server actions menu and tab reuse
	$(NPM) run test:servers

test-pty: ## Test terminal resize during process exit
	$(NPM) run test:pty

test-scroll: ## Test local and full-screen terminal scrolling
	$(NPM) run test:scroll

test-layout: ## Test terminal alignment after resize, input and full-screen apps
	$(NPM) run test:layout

test-all: ## Run all tests sequentially (safe with make -j)
	$(NPM) test
	$(NPM) run test:desktop
	$(NPM) run test:security
	$(NPM) run test:language
	$(NPM) run test:terminal
	$(NPM) run test:components
	$(NPM) run test:quit
	$(NPM) run test:servers
	$(NPM) run test:pty
	$(NPM) run test:scroll
	$(NPM) run test:layout

pack: ## Package for the current OS; ARCH=native|arm64|x64 OUT=release
	node scripts/package.cjs native "$(ARCH)" "$(OUT)"

pack-mac: ## Build macOS DMG and ZIP (run on macOS)
	node scripts/package.cjs darwin "$(ARCH)" "$(OUT)"

pack-win: ## Build Windows NSIS installer and portable EXE (run on Windows)
	node scripts/package.cjs win32 "$(ARCH)" "$(OUT)"

pack-linux: ## Build Linux AppImage and deb (run on Linux)
	node scripts/package.cjs linux "$(ARCH)" "$(OUT)"
