@echo off
REM Wrapper to call the bash version of manual-backup
bash scripts/hooks/manual-backup.sh %*

if not exist "%CONFIG_FILE%" (
    echo [backup] No backup configuration found. Run scripts\hooks\setup.bat to configure.
    exit /b 1
)

REM Read configuration
for /f "tokens=1,2 delims==" %%a in (%CONFIG_FILE%) do (
    if "%%a"=="BACKUP_ENABLED" set BACKUP_ENABLED=%%b
    if "%%a"=="BACKUP_PATH" set BACKUP_PATH=%%b
)

REM Check if backup is enabled
if not "%BACKUP_ENABLED%"=="true" (
    echo [backup] Backup is disabled in configuration.
    echo [backup] Run scripts\hooks\setup.bat to enable backup.
    exit /b 1
)

REM Check if backup path is configured
if "%BACKUP_PATH%"=="" (
    echo [backup] No backup path configured. Run scripts\hooks\setup.bat to configure.
    exit /b 1
)

REM Check if path exists
if not exist "%BACKUP_PATH%" (
    echo [backup] Backup path not accessible: %BACKUP_PATH%
    echo [backup] Run scripts\hooks\setup.bat to reconfigure.
    exit /b 1
)

REM Check if a specific file was provided
if not "%~1"=="" (
    REM Backup single file
    if not exist "%~1" (
        echo [backup] Error: File not found: %~1
        exit /b 1
    )
    
    set "filename=%~nx1"
    echo !filename! | findstr /i "\.user\.js$" >nul
    if errorlevel 1 (
        echo [backup] Error: File must be a .user.js file
        exit /b 1
    )
    
    copy /Y "%~1" "%BACKUP_PATH%\!filename!" >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        echo [backup] Backed up: %~1 -^> !filename!
        echo [backup] Backup complete^! ^(1 file backed up^)
    ) else (
        echo [backup] ERROR backing up: %~1
        exit /b 1
    )
    pause
    exit /b 0
)

echo [backup] Backing up scripts to %BACKUP_PATH%...

set COUNT=0

REM Backup all .user.js files
for /r scripts %%f in (*.user.js) do (
    set "file=%%f"
    
    REM Extract just the filename
    for %%n in ("!file!") do set "filename=%%~nxn"
    
    REM Copy file to backup location (flat structure)
    copy /Y "!file!" "%BACKUP_PATH%\!filename!" >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        echo [backup] Backed up: !file! -^> !filename!
        set /a COUNT+=1
    ) else (
        echo [backup] ERROR backing up: !file!
    )
)

echo [backup] Backup complete^! (!COUNT! files backed up^)
pause
