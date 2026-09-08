@echo off
REM Camptainer one-command launcher (Windows).
REM Opens the backend (uvicorn, in the venv) and the frontend (vite) in their
REM own windows. Close those windows to stop the servers.
cd /d "%~dp0backend"
if not exist .venv\Scripts\activate (
    python -m venv .venv
)
call .venv\Scripts\activate
pip install -q -r requirements.txt
start "Camptainer Backend" cmd /k "uvicorn app.main:app --host 0.0.0.0 --port 9096"

cd /d "%~dp0frontend"
call npm install
start "Camptainer Frontend" cmd /k "npm run dev -- --host 0.0.0.0 --port 9095 --strictPort"

echo.
echo Camptainer starting... backend on http://localhost:9096 , UI on http://localhost:9095
pause
