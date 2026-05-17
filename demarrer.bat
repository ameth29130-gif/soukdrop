@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════════════════╗
echo ║   🚀 SoukDrop — Démarrage                       ║
echo ╚══════════════════════════════════════════════════╝
echo.

:: Vérifier Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ ERREUR: Node.js n'est pas installé !
    echo    Téléchargez sur : https://nodejs.org
    pause
    exit
)

echo ✅ Node.js détecté.
echo.

:: Installer les dépendances si nécessaire
if not exist node_modules (
    echo 📦 Installation des dépendances...
    npm install
    echo.
)

:: Vérifier que .env existe
if not exist .env (
    echo ⚠️  Fichier .env manquant !
    echo    Créez le fichier .env dans ce dossier avec vos clés.
    pause
    exit
)

echo ═══════════════════════════════════════════════════
echo   Application sur : http://localhost:3001
echo   Admin : triple-clic sur le logo SoukDrop
echo ═══════════════════════════════════════════════════
echo.

:: Ouvrir le navigateur après 2 secondes
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3001"

:: Lancer le serveur
node server.js
pause