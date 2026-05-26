# GAS Commander

Portfolio-aware PM tool and Electron desktop control panel for managing multi-stack projects with Claude Code.

Manages Google Apps Script, Forge, Python, and Electron projects — deploy, skill execution, and Mission Control health overview in one place.

## What it does

- **Mission Control**: Overview panel showing per-project health — Live URL ping, last commit, git state, Forge install version, GH Actions cron status
- **Multi-stack project registry**: JSON-driven registry (5 projects by default); add more on the fly via + Add Project modal with auto stack detection
- **Auto-sync**: On startup, clones or pulls the latest code from GitHub for all registered projects
- **Skill buttons**: Reads `.claude/commands/*.md` from each project and shows them as clickable buttons
- **Interactive Claude Code sessions**: Runs `claude -p` with `stream-json` output, supports follow-up conversations via `--continue`
- **One-click deploy**: clasp push + version + deploy with diff preview modal (shows HEAD commit, Case A "already in sync" vs Case B "commits/files to push")
- **Live Preview**: Loads the Apps Script live URL in a webview tab
- **Refresh on demand**: Overview reloads all health probes with the ↻ button — no background polling

## Setup (new laptop)

```bash
# 1. Clone this repo
git clone https://github.com/abigailkang-ujet/gas-commander.git ~/Desktop/gas-commander
cd ~/Desktop/gas-commander

# 2. Run setup (checks Node.js + Claude Code CLI, installs deps)
./setup.sh

# 3. Launch
npm start
```

On first launch, the app auto-clones all registered projects from GitHub to `~/Desktop/`.

**Optional:** Install `gh` CLI for Python project cron monitoring:

```bash
brew install gh && gh auth login
```

Without `gh`, Mission Control will still run — the Python probe degrades gracefully (last cron shows "gh not installed", dot turns red).

### Deploy setup (one-time per laptop)

```bash
# Install clasp
npm install -g @google/clasp

# Login to Google
clasp login

# Enable Apps Script API
# Visit: https://script.google.com/home/usersettings → toggle ON
```

Then in the app, click **Deploy to Apps Script** — it will ask for the Script ID on first use (find it in the Apps Script editor URL: `script.google.com/home/projects/SCRIPT_ID/edit`).

The deploy modal now shows the HEAD commit being deployed and distinguishes two cases:
- **Case A** — "already in sync" (remote has the commit; clasp push is a no-op)
- **Case B** — "commits/files to push" (local changes not yet on remote; deploy will push them)

## Architecture

```
gas-commander/
├── main.js                  # Electron main process + IPC handlers
├── preload.js               # contextBridge → window.api
├── registry.js              # projects.json load/save + add/remove (NEW)
├── stackDetect.js           # filesystem-based stack tagging (NEW)
├── health.js                # per-stack probes (NEW)
├── projects.default.json    # seed registry (NEW)
├── renderer/
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── docs/
    └── superpowers/
        ├── specs/           # design docs (NEW)
        └── plans/           # impl plans + verification records (NEW)
```

### How Claude Code is invoked

```
Skill button click
  → reads .claude/commands/{skill}.md file content
  → writes to temp file
  → spawns: claude -p --output-format stream-json --verbose --permission-mode acceptEdits < tempfile
  → parses stream-json events → renders as chat bubbles
  → on completion, follow-ups use --continue flag
```

### How deploy works

```
Deploy button → deploy-check (clasp installed? logged in? .clasp.json?)
  → re-syncs from GitHub → shows HEAD commit + Case A/B diff preview
  → Deploy Now → clasp push --force → clasp version → clasp deploy
  → Preview Reload (webview navigates to live URL)
```

### How Mission Control health works

```
Overview panel open / ↻ Refresh click
  → health.js probes each project in parallel
  → Apps Script: HEAD request to Live URL (302 → green, 4xx/unreachable → red)
  → Forge: `forge install list --product jira` → parse installed version
  → Python: `gh run list` → extract last cron run + next schedule
  → git state: `git status --porcelain` + `git log -1 --format=%cd`
  → results rendered as cards with dot indicator (green/yellow/red/grey)
```

## Managed projects (default)

| Project | Stack | Mission Control surfaces |
|---------|-------|--------------------------|
| [esl-timeline](https://github.com/abigailkang-ujet/esl-timeline) | Apps Script | Live URL ping, last commit, git state |
| [Programs-dashboard](https://github.com/abigailkang-ujet/Programs-dashboard) | Apps Script | Live URL ping, last commit, git state |
| [jira-portfolio-plugin](https://github.com/abigailkang-ujet/jira-portfolio-plugin) | Forge | Forge install version, last commit, git state |
| [esl-jira-notion-sync](https://github.com/abigailkang-ujet/esl-jira-notion-sync) | Python | GH Actions last cron run + next schedule, last commit, git state |
| gas-commander (self) | Electron | Git state only (grey dot lock — no live probe on self) |

Add more projects at runtime via **+ Add Project** → Browse to a folder → stack is auto-detected from the filesystem → Save.

### User-level skills (available in any project via CLI)

Located in `~/.claude/commands/`:
- `gas-deploy` — Generic GAS deploy helper
- `status` — Project status overview
- `update-docs` — Sync CLAUDE.md with current code

## Roadmap

| Phase | What | Status |
|-------|------|--------|
| 1 | Multi-stack Registry + Mission Control (read-only health overview) | ✅ Shipped |
| 2 | Per-stack Deploy Automation (1-click Forge + Python GH workflow trigger) | Next |
| 3 | Notion vs Jira drift check | Planned |
| 4 | Daily/Weekly portfolio snapshot for Slack | Planned |
| 5 | JIRA issue bulk ops | Planned |

## Known limitations

- **clasp deploy creates new deployment** — each deploy generates a new URL. Fix: use `clasp deploy -i <deploymentId>` to update existing deployment in-place.
- **stream-json parsing** — not all event types are rendered (some edge cases may show raw text).
- **No split-view yet** — Preview and Output are separate tabs, not side-by-side.
- **Permission mode** — `acceptEdits` auto-approves file changes. Be aware when running destructive skills.
- **Mission Control read-only in Phase 1** — mutating actions (deploy from Overview, kill a cron) deferred to Phase 2.

## Running

```bash
cd ~/Desktop/gas-commander
npm start
```
