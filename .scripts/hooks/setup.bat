@echo off
REM Check if bash is available
where bash >nul 2>&1
if errorlevel 1 (
	echo [ERROR] bash is not installed or not in PATH. Please install Git Bash or add bash to your PATH.
	exit /b 1
)
REM Wrapper to call the bash version of setup
bash .scripts/hooks/setup.sh %*
