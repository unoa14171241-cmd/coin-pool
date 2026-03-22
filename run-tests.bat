@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo === Running all tests (web + api) ===
call npm run test
if %ERRORLEVEL% neq 0 (
  echo.
  echo Tests failed. Exit code: %ERRORLEVEL%
  exit /b %ERRORLEVEL%
)

echo.
echo === All tests passed ===
exit /b 0
