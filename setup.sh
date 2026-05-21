#!/bin/bash
# GAS Commander — one-line setup
# Usage: curl -sL <raw-url>/setup.sh | bash
# Or:    git clone <repo> && cd gas-commander && ./setup.sh

set -e

echo "=== GAS Commander Setup ==="

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "Node.js not found. Install from https://nodejs.org"
  exit 1
fi

# Check Claude Code CLI
if ! command -v claude &>/dev/null; then
  echo "Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code"
  exit 1
fi

# Install dependencies
echo "Installing dependencies..."
npm install

echo ""
echo "=== Setup complete ==="
echo "Run:  npm start"
echo ""
echo "On first launch the app will:"
echo "  1. Auto-clone ESL Timeline + Programs Dashboard from GitHub"
echo "  2. Pull latest code if already cloned"
echo "  3. Detect skills from .claude/commands/"
echo ""
