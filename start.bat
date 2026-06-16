@echo off
:: Start Nnoel with Docker Compose (Windows equivalent of start.sh)
setlocal enabledelayedexpansion

:: Check Docker is installed
where docker >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: Docker is not installed.
    echo.
    echo Download and install Docker Desktop for Windows:
    echo   https://docs.docker.com/desktop/setup/install/windows-install/
    echo.
    echo Make sure WSL 2 backend is enabled during installation.
    echo.
    pause
    exit /b 1
)

:: Check Docker daemon is running
docker info >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: Cannot connect to Docker daemon.
    echo.
    echo Make sure Docker Desktop is running.
    echo If not, start it from the Start Menu or system tray.
    echo.
    pause
    exit /b 1
)

:: Check Docker Compose is available
docker compose version >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: Docker Compose not found.
    echo Docker Desktop for Windows includes Compose v2 by default.
    echo Make sure you have the latest version:
    echo   https://docs.docker.com/desktop/setup/install/windows-install/
    pause
    exit /b 1
)

echo Starting Nnoel...
docker compose up
pause
