#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== MotoLucro Deploy Script ==="

if [ -f .env ]; then
  echo "Carregando variáveis de .env..."
  export $(grep -v '^#' .env | xargs)
fi

echo "Verificando dependências e build..."
npm install
npm run build

echo "Build realizado com sucesso em ./dist."

if [ -z "$VERCEL_TOKEN" ]; then
  echo "VERCEL_TOKEN não encontrado. Executando via npx vercel interativo..."
  npx vercel --prod
else
  echo "Executando deploy na Vercel com VERCEL_TOKEN..."
  npx vercel --prod --token "$VERCEL_TOKEN" --yes
fi
