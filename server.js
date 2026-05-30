function proxyImageUrls(product, baseUrl) {
  const base = baseUrl || '';
  if (product && product.images && Array.isArray(product.images)) {
    product.images = product.images.map(img => {
      if (!img) return 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?w=400';
      if (img.startsWith('http') && !img.includes('/api/img')) {
        return base + '/api/img?url=' + encodeURIComponent(img);
      }
      return img;
    });
  }
  return product;
}

// -------------------------------------------------------------------
//  SoukDrop v3.0 � Backend Complet
// -------------------------------------------------------------------
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

dotenv.config();

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// -- Supabase ------------------------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// -- Middleware ----------------------------------------------------
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('dev'));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '5mb' }));

const limiter = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);

// -- Config --------------------------------------------------------
const USD_FCFA = parseFloat(process.env.USD_TO_FCFA || 615);
const MARGIN   = parseFloat(process.env.PRICE_MARGIN || 1.5);
const SHIP_USD = parseFloat(process.env.EST_SHIPPING_USD || 8);
const calcPrice = (usd) => Math.ceil((parseFloat(usd || 0) + SHIP_USD) * MARGIN * USD_FCFA);
const PLANS = {
  starter: { comm: 0.05, max: 50 },
  pro:     { comm: 0.02, max: 500 },
  business:{ comm: 0,    max: 999999 }
};

// -- CJ Token -----------------------------------------------------
const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0';
let cjToken = null, cjExpiry = 0;

async function getCJToken() {
  if (cjToken && Date.now() < cjExpiry) return cjToken;
  try {
    const r = await fetch(`${CJ_BASE}/v1/authentication/getAccessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.CJ_EMAIL, password: process.env.CJ_API_KEY })
    });
    const d = await r.json();
    if (d.result && d.data?.accessToken) {
      cjToken = d.data.accessToken;
      cjExpiry = Date.now() + 3_600_000;
      return cjToken;
    }
    return null;
  } catch(e) { return null; }
}

async function cjReq(endpoint, params = {}, method = 'GET') {
  const tok = await getCJToken();
  if (!tok) throw new Error('CJ: impossible de se connecter');
  let url = `${CJ_BASE}${endpoint}`;
  const opts = { method, headers: { 'Content-Type': 'application/json', 'CJ-Access-Token': tok } };
  if (method === 'GET') { const qs = new URLSearchParams(params).toString(); if (qs) url += '?' + qs; }
  else opts.body = JSON.stringify(params);
  const r = await fetch(url, opts);
  return r.json();
}

// -------------------------------------------------------------------
//  AUTH � Inscription / Connexion vendeurs
// -------------------------------------------------------------------

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, storeName, storeDesc, storeType, plan, wave, om } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Champs requis manquants' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min 6 caract�res)' });

    // V�rifier email unique
    const { data: existing } = await supabase.from('sellers').select('id').eq('email', email).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Cet email est d�j� utilis�' });

    const hash = await bcrypt.hash(password, 10);
    const slug = (storeName || name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);

    const { data: seller, error } = await supabase.from('sellers').insert({
      name, email,
      password_hash: hash,
      plan: plan || 'starter',
      store_name: storeName || name + ' Shop',
      store_slug: slug,
      store_desc: storeDesc || '',
      store_type: storeType || 'general',
      wave: wave || '',
      om: om || '',
    }).select().single();

    if (error) throw error;

    const userData = {
      id: seller.id, name: seller.name, email: seller.email,
      plan: seller.plan, role: 'seller', token: 'ADMIN_TOK',
      wave: seller.wave, om: seller.om,
      store: { name: seller.store_name, slug: seller.store_slug, type: seller.store_type }
    };
    res.json({ success: true, data: userData });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data: seller, error } = await supabase.from('sellers').select('*').eq('email', email).maybeSingle();
    if (error || !seller) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const ok = await bcrypt.compare(password, seller.password_hash);
    if (!ok) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const userData = {
      id: seller.id, name: seller.name, email: seller.email,
      plan: seller.plan, role: 'seller', token: 'ADMIN_TOK',
      wave: seller.wave, om: seller.om,
      store: { name: seller.store_name, slug: seller.store_slug, type: seller.store_type }
    };
    res.json({ success: true, data: userData });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// -------------------------------------------------------------------
//  PRODUITS
// -------------------------------------------------------------------

app.get('/api/products', async (req, res) => {
  try {
    const { category, limit = 40, offset = 0, search } = req.query;
    let q = supabase.from('products').select('*', { count: 'exact' })
      .eq('status', 'active').order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    if (category) q = q.eq('category', category);
    if (search)   q = q.ilike('name', `%${search}%`);
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data: data || [], total: count || 0 });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    supabase.from('products').update({ view_count: (data.view_count || 0) + 1 }).eq('id', req.params.id).then(() => {});
    res.json({ success: true, data });
  } catch(e) { res.status(404).json({ success: false, error: 'Produit non trouv�' }); }
});

// -------------------------------------------------------------------
//  STORE PUBLIC
// -------------------------------------------------------------------

app.get('/api/store/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { data: seller, error: sErr } = await supabase.from('sellers').select('*').eq('store_slug', slug).single();
    if (sErr || !seller) return res.status(404).json({ error: 'Boutique introuvable' });

    const { data: products, error: pErr } = await supabase.from('products').select('*').eq('seller_id', seller.id);
    if (pErr) return res.status(400).json({ error: pErr.message });

    const processedProducts = (products || []).map(p => proxyImageUrls(p, process.env.BASE_URL || ''));
    res.json({ success: true, store: seller, data: processedProducts });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/img', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url || !url.startsWith('http')) return res.status(400).send('URL invalide');
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return res.status(404).send('Image non trouv�e');
    const ct = r.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    r.body.pipe(res);
  } catch(e) { res.status(500).send('Erreur image'); }
});

app.get('/api/cj/products/search', async (req, res) => {
  try {
    const { keyword = '', pageNum = 1, pageSize = 20 } = req.query;
    const params = { pageNum: parseInt(pageNum), pageSize: parseInt(pageSize) };
    if (keyword) params.productNameEn = keyword;
    const d = await cjReq('/v1/product/list', params);
    if (!d.result) return res.json({ success: false, error: d.message, data: [], total: 0 });
    const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
    const proxyImg = url => url ? `${BASE_URL}/api/img?url=${encodeURIComponent(url)}` : '';
    const products = (d.data?.list || []).map(p => ({
      pid: p.pid,
      productNameEn: p.productNameEn,
      productImage: proxyImg(p.productImage),
      images: p.productImageSet?.map(i => proxyImg(i.imageUrl)) || [proxyImg(p.productImage)],
      categoryName: p.categoryName,
      sellPrice: parseFloat(p.sellPrice || 0),
      description: p.description || '',
      priceCalc: { usd: parseFloat(p.sellPrice || 0), finalFCFA: calcPrice(p.sellPrice || 0) }
    }));
    res.json({ success: true, data: products, total: d.data?.total || products.length });
  } catch(e) { res.status(500).json({ success: false, error: e.message, data: [] }); }
});

app.post('/api/cj/import', async (req, res) => {
  try {
    const { pid } = req.body;
    if (!pid) return res.status(400).json({ error: 'pid requis' });
    const { data: existing } = await supabase.from('products').select('id').eq('cj_pid', pid).maybeSingle();
    if (existing) return res.json({ success: true, message: 'D�j� import�', data: existing });
    const d = await cjReq('/v1/product/query', { pid });
    if (!d.result) throw new Error(d.message || 'Produit introuvable');
    const p = d.data;
    const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
    const proxyImg = url => url ? `${BASE_URL}/api/img?url=${encodeURIComponent(url)}` : '';
    // Toutes les images du fournisseur via proxy
    const allImages = p.productImageSet?.map(i => proxyImg(i.imageUrl)) || (p.productImage ? [proxyImg(p.productImage)] : []);
    const { data, error } = await supabase.from('products').insert({
      cj_pid: pid,
      name: p.productNameEn || p.productName,
      description: p.description || p.productNameEn || '',
      images: allImages,
      cj_price_usd: parseFloat(p.sellPrice || 0),
      price_fcfa: calcPrice(p.sellPrice || 0),
      category: p.categoryName || 'G�n�ral',
      status: 'active',
      variants: p.variants || [],
      metadata: { categoryId: p.categoryId }
    }).select().single();
    if (error) throw error;
    res.json({ success: true, data, message: 'Produit mis en ligne !' });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// -------------------------------------------------------------------
//  COMMANDES
// -------------------------------------------------------------------

app.post('/api/orders/create', async (req, res) => {
  try {
    const { items, customer, shippingCostFCFA = 2500, logisticName = 'Standard' } = req.body;
    if (!items?.length || !customer?.name || !customer?.email) return res.status(400).json({ error: 'Donn�es incompl�tes' });

    const subtotal = items.reduce((s, i) => s + (i.priceFCFA * i.quantity), 0);
    const total = subtotal + parseInt(shippingCostFCFA);

    const { data: order, error } = await supabase.from('orders').insert({
      customer_name: customer.name, customer_email: customer.email,
      customer_phone: customer.phone || '',
      shipping_address: customer.address || {},
      items, subtotal_fcfa: subtotal,
      shipping_fcfa: parseInt(shippingCostFCFA),
      total_fcfa: total, logistic_name: logisticName,
      status: 'pending_payment', payment_method: 'paytech'
    }).select().single();
    if (error) throw error;

    // PayTech
    let paymentUrl = null;
    try {
      const baseUrl = process.env.BASE_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` || 'http://localhost:3001';
      const payload = {
        item_name: `Commande SoukDrop #${order.id.slice(0,8).toUpperCase()}`,
        item_price: order.total_fcfa, currency: 'XOF',
        ref_command: order.id,
        command_name: `SoukDrop � ${order.customer_name}`,
        env: 'prod',
        ipn_url: `${baseUrl}/api/paytech/ipn`,
        success_url: `${baseUrl}/#/commande/succes?order=${order.id}`,
        cancel_url: `${baseUrl}/#/panier`
      };
      const r = await fetch('https://paytech.sn/api/payment/request-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'API_KEY': process.env.PAYTECH_API_KEY, 'API_SECRET': process.env.PAYTECH_SECRET_KEY },
        body: JSON.stringify(payload)
      });
      const d = await r.json();
      if (d.success === 1) {
        await supabase.from('orders').update({ paytech_ref: d.token }).eq('id', order.id);
        paymentUrl = `https://paytech.sn/payment/checkout/${d.token}`;
        console.log('? PayTech URL:', paymentUrl);
      } else {
        console.error('? PayTech erreur:', JSON.stringify(d));
        return res.status(500).json({ success: false, error: 'PayTech: ' + (d.errors?.join(', ') || 'Erreur paiement') });
      }
    } catch(pe) {
      console.error('? PayTech exception:', pe.message);
      return res.status(500).json({ success: false, error: 'Service paiement indisponible' });
    }

    res.json({ success: true, data: order, paymentUrl });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/paytech/ipn
app.post('/api/paytech/ipn', async (req, res) => {
  try {
    const { ref_command, type_event, api_key_sha256, api_secret_sha256 } = req.body;
    const expKey = crypto.createHash('sha256').update(process.env.PAYTECH_API_KEY || '').digest('hex');
    const expSec = crypto.createHash('sha256').update(process.env.PAYTECH_SECRET_KEY || '').digest('hex');
    if (api_key_sha256 !== expKey || api_secret_sha256 !== expSec) return res.status(403).send('Forbidden');
    if (type_event === 'sale_complete') {
      const { data: order } = await supabase.from('orders').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', ref_command).select().single();
      if (order) {
        console.log('? Paiement confirm�:', ref_command);
        sendEmail(order).catch(console.error);
        placeCJOrder(order).catch(console.error);
        // Mettre � jour revenus vendeur
        updateSellerRevenue(order).catch(console.error);
      }
    }
    res.send('OK');
  } catch(e) { console.error('IPN erreur:', e.message); res.status(500).send('Error'); }
});

async function updateSellerRevenue(order) {
  const { data: sellers } = await supabase.from('sellers').select('id,total_revenue').limit(1);
  if (sellers?.length) {
    const s = sellers[0];
    await supabase.from('sellers').update({ total_revenue: (s.total_revenue || 0) + (order.total_fcfa || 0) }).eq('id', s.id);
  }
}

async function placeCJOrder(order) {
  try {
    const productIds = (order.items || []).map(i => i.productId).filter(Boolean);
    if (!productIds.length) return;
  } catch (e) {
    console.error('Erreur placeCJOrder:', e.message);
  }
}

// -------------------------------------------------------------------
//  RETRAITS
// -------------------------------------------------------------------

app.post('/api/withdrawals/request', async (req, res) => {
  try {
    const { amount, method, phone, sellerName } = req.body;
    if (!amount || !method || !phone) return res.status(400).json({ error: 'Donn�es incompl�tes' });
    const { data, error } = await supabase.from('withdrawals').insert({
      seller_name: sellerName || 'Vendeur',
      amount: parseInt(amount), method, phone, status: 'pending'
    }).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// -------------------------------------------------------------------
//  ADMIN
// -------------------------------------------------------------------

app.get('/api/admin/stats', async (req, res) => {
  try {
    const { data } = await supabase.from('dashboard_stats').select('*').single();
    res.json({ success: true, data: {
      products: parseInt(data?.active_products || 0),
      paid_orders: parseInt(data?.paid_orders || 0),
      pending_orders: parseInt(data?.pending_orders || 0),
      revenue: parseInt(data?.total_revenue_fcfa || 0),
      monthly: parseInt(data?.monthly_revenue_fcfa || 0)
    }});
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/orders', async (req, res) => {
  try {
    const { status, limit = 100, offset = 0 } = req.query;
    let q = supabase.from('orders').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    if (status) q = q.eq('status', status);
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data: data || [], total: count || 0 });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/products', async (req, res) => {
  try {
    const { data, error, count } = await supabase.from('products').select('*', { count: 'exact' }).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    res.json({ success: true, data: data || [], total: count || 0 });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/sellers', async (req, res) => {
  try {
    const { data, error } = await supabase.from('sellers').select('id,name,email,plan,store_name,store_slug,store_type,wave,om,certified,products_count,total_revenue,created_at').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/withdrawals', async (req, res) => {
  try {
    const { data, error } = await supabase.from('withdrawals').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/admin/withdrawals/:id/process', async (req, res) => {
  try {
    const { data, error } = await supabase.from('withdrawals').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/admin/sellers/:id/certify', async (req, res) => {
  try {
    const { certified } = req.body;
    const { data, error } = await supabase.from('sellers').update({ certified }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// -- Seller specific routes ----------------------------------------
app.get('/api/seller/orders', async (req, res) => {
  try {
    const sellerId = req.headers['x-seller-id'];
    const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/seller/withdrawals', async (req, res) => {
  try {
    const sellerId = req.headers['x-seller-id'];
    let q = supabase.from('withdrawals').select('*').order('created_at', { ascending: false });
    if (sellerId) q = q.eq('seller_id', sellerId);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/seller/stats', async (req, res) => {
  try {
    const sellerId = req.headers['x-seller-id'];
    const { data: orders } = await supabase.from('orders').select('total_fcfa,status').order('created_at', { ascending: false }).limit(500);
    const paid = (orders || []).filter(o => o.status === 'paid' || o.status === 'shipped' || o.status === 'delivered');
    const revenue = paid.reduce((s, o) => s + (o.total_fcfa || 0), 0);
    const { data: seller } = await supabase.from('sellers').select('plan').eq('id', sellerId || '').maybeSingle();
    const plan = seller?.plan || 'starter';
    const commRate = plan === 'pro' ? 0.02 : plan === 'business' ? 0 : 0.05;
    const commission = Math.round(revenue * commRate);
    res.json({ success: true, data: { revenue, commission, net: revenue - commission } });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/subscription/pay � Paiement abonnement via PayTech
app.post('/api/subscription/pay', async (req, res) => {
  try {
    const { plan, sellerId, sellerEmail, sellerName } = req.body;
    const PLANS = { pro: 9900, business: 24900 };
    const price = PLANS[plan];
    if (!price) return res.status(400).json({ error: 'Plan invalide' });

    const baseUrl = process.env.BASE_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` || 'http://localhost:3001';
    const payload = {
      item_name: `Abonnement SoukDrop ${plan.toUpperCase()}`,
      item_price: price, currency: 'XOF',
      ref_command: `SUB_${plan}_${sellerId || Date.now()}`,
      command_name: `SoukDrop Abonnement ${plan} � ${sellerName || sellerEmail}`,
      env: 'prod',
      ipn_url: `${baseUrl}/api/subscription/ipn`,
      success_url: `${baseUrl}/#/dashboard?subscribed=${plan}`,
      cancel_url: `${baseUrl}/#/pricing`
    };

    const r = await fetch('https://paytech.sn/api/payment/request-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'API_KEY': process.env.PAYTECH_API_KEY, 'API_SECRET': process.env.PAYTECH_SECRET_KEY },
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    if (d.success === 1) {
      res.json({ success: true, paymentUrl: `https://paytech.sn/payment/checkout/${d.token}` });
    } else {
      res.status(500).json({ success: false, error: d.errors?.join(', ') || 'Erreur PayTech' });
    }
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/subscription/ipn � Webhook confirmation abonnement
app.post('/api/subscription/ipn', async (req, res) => {
  try {
    const { ref_command, type_event, api_key_sha256, api_secret_sha256 } = req.body;
    const expKey = crypto.createHash('sha256').update(process.env.PAYTECH_API_KEY || '').digest('hex');
    const expSec = crypto.createHash('sha256').update(process.env.PAYTECH_SECRET_KEY || '').digest('hex');
    if (api_key_sha256 !== expKey || api_secret_sha256 !== expSec) return res.status(403).send('Forbidden');

    if (type_event === 'sale_complete' && ref_command?.startsWith('SUB_')) {
      const parts = ref_command.split('_');
      const plan = parts[1];
      const sellerId = parts[2];
      const now = new Date();
      const expires = new Date(now);
      expires.setMonth(expires.getMonth() + 1);

      if (sellerId && sellerId !== String(Date.now())) {
        await supabase.from('sellers').update({
          plan,
          subscription_starts: now.toISOString(),
          subscription_expires: expires.toISOString()
        }).eq('id', sellerId);
        console.log(`? Abonnement ${plan} activ� pour seller ${sellerId}`);
      }
    }
    res.send('OK');
  } catch(e) { console.error('SUB IPN:', e.message); res.status(500).send('Error'); }
});

// PUT /api/admin/sellers/:id/plan
app.put('/api/admin/sellers/:id/plan', async (req, res) => {
  try {
    const { plan } = req.body;
    const { data, error } = await supabase.from('sellers').update({ plan }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// DELETE /api/admin/products/:id
app.delete('/api/admin/products/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('products').update({ status: 'archived' }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Ajout colonne subscription � sellers si manquante
async function ensureSellerColumns() {
  try {
    await supabase.rpc('exec_sql', { sql: `ALTER TABLE sellers ADD COLUMN IF NOT EXISTS subscription_starts TIMESTAMPTZ; ALTER TABLE sellers ADD COLUMN IF NOT EXISTS subscription_expires TIMESTAMPTZ;` });
  } catch(e) { /* colonnes d�j� pr�sentes */ }
}

// -- Categories & Settings -----------------------------------------
app.get('/api/categories', async (req, res) => {
  try {
    const { data, error } = await supabase.from('categories').select('*').eq('active', true).order('sort_order');
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/settings', async (req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('*');
    if (error) throw error;
    const s = {};(data || []).forEach(r => { s[r.key] = r.value; });
    res.json({ success: true, data: s });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// -- Health --------------------------------------------------------
app.get('/api/health', async (req, res) => {
  const { error } = await supabase.from('settings').select('key').limit(1);
  res.json({ status: 'ok', supabase: !error ? 'connected' : 'error', cj: !!(process.env.CJ_EMAIL), paytech: !!(process.env.PAYTECH_API_KEY), resend: !!(process.env.RESEND_API_KEY), ts: new Date().toISOString() });
});

// -- Frontend ------------------------------------------------------
app.use(express.static(__dirname));
app.get('/{*path}', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// -- Start ---------------------------------------------------------
app.listen(PORT, () => {
  console.log('\n+------------------------------------------+');
  console.log('�  ?? SoukDrop v3.0 � PR�T � VENDRE       �');
  console.log(`�  http://localhost:${PORT}                    �`);
  console.log('+------------------------------------------+');
  getCJToken().then(t => console.log(t ? '? CJ Connect�' : '? CJ: �chec'));
);









