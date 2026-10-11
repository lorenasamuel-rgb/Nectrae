#!/usr/bin/env bash
set -euo pipefail
export GITHUB_OWNER=lorenasamuel-rgb
export REPO_DESCRIPTION="Teto de gastos para agentes de IA, com validação na Solana e na Base."
exec "$HOME/.cursor/skills/publish-github-repo/scripts/push-github.sh" "$@"
