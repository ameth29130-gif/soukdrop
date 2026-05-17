# 🚀 SoukDrop — Guide de démarrage sur Windows / VS Code

## ÉTAPE 1 — Installer Node.js (si pas encore fait)
👉 Allez sur : https://nodejs.org
👉 Cliquez "LTS" → Téléchargez → Installez avec toutes les options par défaut
👉 Redémarrez votre ordinateur après l'installation

---

## ÉTAPE 2 — Ouvrir le projet dans VS Code
1. Ouvrez VS Code
2. Fichier → Ouvrir le dossier → Sélectionnez le dossier "dropshipping-sn"
3. VS Code affiche tous les fichiers dans le panneau gauche

---

## ÉTAPE 3 — Démarrer l'application (2 méthodes)

### Méthode A — Double-cliquer (le plus simple)
Double-cliquez sur le fichier **DEMARRER.bat** dans le dossier.
L'application se lance automatiquement sur http://localhost:5173

### Méthode B — Via VS Code Terminal
Dans VS Code → Terminal → Nouveau Terminal, tapez :

```bash
# Terminal 1 : Backend
cd backend
npm install
node server.js

# Terminal 2 (ouvrir un 2ème terminal) : Frontend
cd frontend
npm install
npm run dev
```

---

## ÉTAPE 4 — Voir l'application
Ouvrez Chrome : **http://localhost:5173**

---

## ÉTAPE 5 — Remplir vos clés dans .env

Le fichier `.env` est dans le dossier racine.
Remplissez les lignes qui contiennent XXXXXXXX :

- `CJ_EMAIL` → votre email CJ Dropshipping
- `CJ_API_KEY` → votre clé API CJ (63dd02...)
- `PAYTECH_API_KEY` → votre clé PayTech
- `SMTP_USER` → votre email Gmail
- `SMTP_PASS` → votre App Password Gmail

---

## Accès Admin
- Triple-clic sur le logo "SoukDrop" en haut à gauche
- Email : ameth29.130@gmail.com
- Mot de passe : Ameth123

---

## ⚠️ IMPORTANT — Sécurité
Régénérez vos clés Supabase sur supabase.com/dashboard
car elles ont été partagées dans une conversation.