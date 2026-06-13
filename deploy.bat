@echo off
setlocal
set BASE=%~dp0
set BASE=%BASE:~0,-1%

echo ========================================
echo   FantasAI Full Deploy
echo ========================================

:: ── App ──────────────────────────────────
cd /d "%BASE%\app"
echo.
echo [1/4] app -- npm run build
call npm run build
if errorlevel 1 (echo FAILED: npm run build & pause & exit /b 1)

echo.
echo [2/4] app -- npx wrangler pages deploy dist --project-name fantasai
call npx wrangler pages deploy dist --project-name fantasai --branch main --commit-dirty=true
if errorlevel 1 (echo FAILED: pages deploy & pause & exit /b 1)

:: ── Worker API ───────────────────────────
cd /d "%BASE%\worker-api"
echo.
echo [3/4] worker-api -- npx wrangler deploy
call npx wrangler deploy
if errorlevel 1 (echo FAILED: worker-api deploy & pause & exit /b 1)

:: ── Worker ───────────────────────────────
cd /d "%BASE%\worker"
echo.
echo [4/4] worker -- npx wrangler deploy
call npx wrangler deploy
if errorlevel 1 (echo FAILED: worker deploy & pause & exit /b 1)

cd /d "%BASE%"
echo.
echo ========================================
echo   All deployments complete!
echo ========================================
pause
