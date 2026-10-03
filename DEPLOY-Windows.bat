@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Gilnun - deploy
where node >nul 2>nul
if errorlevel 1 goto nonode
node "scripts\deploy.mjs" %*
echo.
pause
exit /b

:nonode
echo.
echo   길눈을 실행하려면 Node.js(무료)가 필요해요.
echo   방금 열린 페이지에서 LTS 버전을 설치한 뒤, 이 파일을 다시 더블클릭하세요.
echo.
start "" "https://nodejs.org/ko/download"
pause
exit /b 1
