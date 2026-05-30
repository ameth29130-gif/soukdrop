import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Configuration de base
app.use(express.json());

// Routes API de test (pour vérifier que le serveur répond)
app.get('/api/health', (req, res) => {
    res.json({ status: 'server is running' });
});

// -- Frontend --
app.use(express.static(__dirname));

// Route wildcard standard (compatible Express 4+)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});