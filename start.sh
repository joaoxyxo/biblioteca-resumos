#!/bin/sh
# Arranca a Biblioteca de Resumos e abre o browser.
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8765}"
export PORT
( sleep 1.5; command -v open >/dev/null 2>&1 && open "http://localhost:$PORT" ) &
exec python3 server.py
