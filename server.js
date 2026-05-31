import express from 'express';
import axios from 'axios';
const app = express();
app.get('/api/products/:shopId', async (req, res) => {
    try {
        const response = await axios.get('https://jsonplaceholder.typicode.com/posts?_limit=6');
        res.json({ shop: req.params.shopId, products: response.data });
    } catch (e) { res.status(500).send('Erreur'); }
});
app.get('*', (req, res) => {
    res.send("<!DOCTYPE html><html><head><meta charset='UTF-8'><style>body{font-family:sans-serif;text-align:center;background:#f4f4f9;padding:20px}.card{background:white;padding:20px;margin:10px;border-radius:10px;box-shadow:0 2px 5px rgba(0,0,0,0.1);display:inline-block;width:200px}</style></head><body><h1>Boutique active</h1><div id='list'></div><script>fetch('/api/products/test').then(r=>r.json()).then(d=>{const l=document.getElementById('list'); d.products.forEach(p=>l.innerHTML+='<div class=\"card\">'+p.title.substring(0,20)+'</div>')});</script></body></html>");
});
app.listen(process.env.PORT || 10000);