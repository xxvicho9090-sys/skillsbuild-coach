@echo off
rem Igual que Iniciar-Coach.vbs pero con ventana (útil para ver mensajes).
rem Agrega --lan para usarlo desde el celular en la misma Wi-Fi.
cd /d "%~dp0"
title SkillsBuild Coach
node scripts\local.mjs %*
if errorlevel 1 pause
