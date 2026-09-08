#!/usr/bin/env bash
# Convenience launcher: starts the backend (uvicorn) and frontend (vite) together.
set -e

echo ">> Installing backend deps"
cd "$(dirname "$0")/backend"
python -m venv .venv 2>/dev/null || true
. .venv/Scripts/activate 2>/dev/null || . .venv/bin/activate
pip install -q -r requirements.txt

echo ">> Starting backend on :9096"
uvicorn app.main:app --host 0.0.0.0 --port 9096 &
BACKEND_PID=$!

cd ../frontend
echo ">> Installing frontend deps"
npm install
echo ">> Starting frontend on :9095"
npm run dev -- --host 0.0.0.0 --port 9095 --strictPort &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT INT TERM
wait
