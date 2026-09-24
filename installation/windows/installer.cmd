@echo off
rem Lance l'installateur PowerShell avec les droits d'administrateur et garde la fenêtre ouverte.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File \"%~dp0installer.ps1\"'"
