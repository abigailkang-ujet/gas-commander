# GAS Commander

Desktop control panel for Google Apps Script projects, powered by Claude Code.

Manages **ESL Timeline** and **Programs Dashboard** — two Google Apps Script web apps for program management at UJET.

## What it does

- **Auto-sync**: On startup, clones or pulls the latest code from GitHub for both projects
- **Skill buttons**: Reads `.claude/commands/*.md` from each project and shows them as clickable buttons
- **Interactive Claude Code sessions**: Runs `claude -p` with `stream-json` output, supports follow-up conversations via `--continue`
- **One-click deploy**: clasp push + version + deploy with diff preview modal
- **Live Preview**: Loads the Apps Script live URL in a webview tab

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

On first launch, the app auto-clones ESL Timeline and Programs Dashboard from GitHub to `~/Desktop/`.

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

## Architecture

```
gas-commander/
├── main.js           # Electron main process
│                       - Project discovery (clone/pull from GitHub)
│                       - Claude Code CLI execution (stream-json)
│                       - Deploy via clasp (push + version + deploy)
├── preload.js        # IPC bridge (contextIsolation)
├── renderer/
│   ├── index.html    # App shell (sidebar + tabs + deploy modal)
│   ├── styles.css    # Dark theme (matches ESL Timeline aesthetic)
│   └── app.js        # UI logic (project selection, skill execution,
│                       stream event parsing, deploy flow)
├── setup.sh          # One-line setup script
└── package.json      # Electron dependency
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
  → shows diff preview (git diff --stat)
  → Deploy Now → clasp push --force → clasp version → clasp deploy
  → Preview Reload (webview navigates to live URL)
```

## Managed projects

| Project | Repo | Skills |
|---------|------|--------|
| ESL Timeline | [abigailkang-ujet/esl-timeline](https://github.com/abigailkang-ujet/esl-timeline) | deploy, sync-check, add-feature, fix-bug |
| Programs Dashboard | [abigailkang-ujet/Programs-dashboard](https://github.com/abigailkang-ujet/Programs-dashboard) | deploy, add-widget, add-feature, fix-bug |

### User-level skills (available in any project via CLI)

Located in `~/.claude/commands/`:
- `gas-deploy` — Generic GAS deploy helper
- `status` — Project status overview
- `update-docs` — Sync CLAUDE.md with current code

## Known limitations

- **clasp deploy creates new deployment** — each deploy generates a new URL. Fix: use `clasp deploy -i <deploymentId>` to update existing deployment in-place.
- **stream-json parsing** — not all event types are rendered (some edge cases may show raw text).
- **No split-view yet** — Preview and Output are separate tabs, not side-by-side.
- **Permission mode** — `acceptEdits` auto-approves file changes. Be aware when running destructive skills.

## Next steps

1. **Split view**: Code output + Live Preview side by side
2. **Click-to-describe**: Click on Gantt chart element in Preview → sends context to Claude
3. **Fix clasp deploy**: Update existing deployment instead of creating new one
4. **Markdown rendering**: Render Claude output as formatted markdown instead of plain text
5. **Session history**: Save/replay past interactions

## Running

```bash
cd ~/Desktop/gas-commander
npm start
```
