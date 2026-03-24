@echo off
chcp 65001 >nul
cd /d "%~dp0"

set REMOTE_URL=https://github.com/unoa14171241-cmd/coin-pool.git
set BRANCH=main

echo === GitHub push: coin-pool ===
echo.

:: Check git
git status >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo [1/6] Initializing git...
  git init
) else (
  echo [1/6] Git already initialized.
)
echo.

:: Remote
echo [2/6] Setting remote origin...
git remote get-url origin >nul 2>&1
if %ERRORLEVEL% equ 0 (
  git remote set-url origin %REMOTE_URL%
) else (
  git remote add origin %REMOTE_URL%
)
echo.

:: Add & commit
echo [3/6] Adding files...
git add .
echo.
echo [4/6] Committing...
git commit -m "Initial commit: Coin Pool"
if %ERRORLEVEL% neq 0 (
  echo.
  echo Nothing to commit - repository may already be up to date.
  echo Attempting push anyway...
)
echo.

:: Branch & push
echo [5/6] Setting branch to main...
git branch -M %BRANCH%
echo.
echo [6/6] Pushing to GitHub...
git push -u origin %BRANCH%

if %ERRORLEVEL% equ 0 (
  echo.
  echo === Success ===
  echo Repository: https://github.com/unoa14171241-cmd/coin-pool
) else (
  echo.
  echo === Push failed ===
  echo - GitHub にログイン済みか確認してください
  echo - Personal Access Token が必要な場合があります
  echo - リポジトリが存在し、空であることを確認してください
  exit /b 1
)

exit /b 0
