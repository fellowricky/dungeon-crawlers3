@echo off
REM Launches the sprite review tool and opens it in your browser.
cd /d "%~dp0"
python server.py %*
pause
