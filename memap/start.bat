@echo off
cd /d "%~dp0"
start "" http://localhost:8001
python -m http.server 8001 --bind 127.0.0.1
