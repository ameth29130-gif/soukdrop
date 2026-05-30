
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.static(__dirname));

// Route API pour les produits
app.get('/api/products/:shopId', async (req, res) => {
    try {
        // Remplace l'URL ci-dessous par celle fournie par ton fournisseur
        const apiResponse = await axios.get('https://jsonplaceholder.typicode.com/posts?_limit=6'); 
        res.json({ shop: req.params.shopId, products: apiResponse.data });
    } catch (error) {
        res.status(500).json({ error: 'Erreur fournisseur' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log('Server listening on port ' + PORT));

