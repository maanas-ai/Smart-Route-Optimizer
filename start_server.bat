@echo off
title Smart City Waste Management Backend Server
cd /d "%~dp0"
echo ================================================================
echo   SMART CITY GARBAGE COLLECTION ROUTE OPTIMIZER
echo ================================================================
echo.
echo Launching Web Dashboard in your default browser...
start http://localhost:3000
echo Starting Node.js backend server...
echo (Keep this window open while using the dashboard)
echo.
npm start
pause
