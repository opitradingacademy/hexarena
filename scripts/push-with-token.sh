#!/usr/bin/env bash
# Push usando un GitHub Personal Access Token sin persistirlo en git config.
#
# Uso:
#   1. Crear el archivo .github-token en la raíz del repo (NUNCA se commitea)
#      con el token pegado en una sola línea.
#   2. Ejecutar: bash scripts/push-with-token.sh [rama]
set -euo pipefail

TOKEN_FILE=".github-token"
BRANCH="${1:-main}"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "Error: no existe $TOKEN_FILE. Pegá tu token ahí (una sola línea) y volvé a correr el script." >&2
  exit 1
fi

TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")

if [ -z "$TOKEN" ]; then
  echo "Error: $TOKEN_FILE está vacío." >&2
  exit 1
fi

REMOTE_URL=$(git remote get-url origin)
REPO_PATH=$(echo "$REMOTE_URL" | sed -E 's#https://(github\.com/.*)#\1#')

git push "https://${TOKEN}@${REPO_PATH}" "$BRANCH"

echo "Push OK a $BRANCH. El token no quedó guardado en git config."
