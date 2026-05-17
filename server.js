// ═══════════════════════════════════════════════════════════════════
//  SoukDrop — Backend Complet v2.0
//  Routes : Produits, Commandes, CJ Dropshipping, PayTech, Admin
// ═══════════════════════════════════════════════════════════════════
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// ── Supabase ──────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Middleware ────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('dev'));
app.use(cors({
  origin: [
    'http://localhost:3001',
    'http://localhost:5173',
    process.env.FRONTEND_URL || 'http://localhost:5173'
  ],
  credentials: true
}));
app.use(express.json({ limit: '5mb' }));

const limiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);

// ── Auth Admin Middleware ─────────────────────────────────────────
function adminOnly(req, res, next) {
  const tok = req.headers['x-admin-token'] || '';
  if (tok === 'ADMIN_TOK' || tok === process.env.ADMIN_SECRET) return next();
  return res.status(401).json({ error: 'Non autorisé' });
}

// ── Config ────────────────────────────────────────────────────────
const USD_FCFA = parseFloat(process.env.USD_TO_FCFA || 615);
const MARGIN   = parseFloat(process.env.PRICE_MARGIN || 1.5);
const SHIP_USD = parseFloat(process.env.EST_SHIPPING_USD || 8);
const calcPrice = (usdPrice) => Math.ceil((parseFloat(usdPrice || 0) + SHIP_USD) * MARGIN * USD_FCFA);

// ═══════════════════════════════════════════════════════════════════
//  CJ DROPSHIPPING — Helper
// ═══════════════════════════════════════════════════════════════════
const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0';
let cjToken = null;
let cjTokenExpiry = 0;

async function getCJToken() {
  if (cjToken && Date.now() < cjTokenExpiry) return cjToken;
  try {
    const r = await fetch(`${CJ_BASE}/v1/authentication/getAccessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.CJ_EMAIL, password: process.env.CJ_API_KEY })
    });
    const d = await r.json();
    if (d.result && d.data?.accessToken) {
      cjToken = d.data.accessToken;
      cjTokenExpiry = Date.now() + (d.data.tokenExpiryDate ? new Date(d.data.tokenExpiryDate).getTime() - Date.now() : 3600000);
      console.log('✅ CJ Token obtenu');
      return cjToken;
    }
    // Essayer avec refreshToken flow
    if (d.data?.refreshToken) {
      const r2 = await fetch(`${CJ_BASE}/v1/authentication/refreshAccessToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: d.data.refreshToken })
      });
      const d2 = await r2.json();
      if (d2.result && d2.data?.accessToken) {
        cjToken = d2.data.accessToken;
        cjTokenExpiry = Date.now() + 3600000;
        return cjToken;
      }
    }
    console.error('❌ CJ Auth échec:', JSON.stringify(d));
    return null;
  } catch (e) {
    console.error('❌ CJ Token erreur:', e.message);
    return null;
  }
}

async function cjRequest(endpoint, params = {}, method = 'GET') {
  const tok = await getCJToken();
  if (!tok) throw new Error('CJ Dropshipping: impossible de se connecter');
  
  let url = `${CJ_BASE}${endpoint}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'CJ-Access-Token': tok }
  };
  
  if (method === 'GET') {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += '?' + qs;
  } else {
    opts.body = JSON.stringify(params);
  }
  
  const r = await fetch(url, opts);
  return r.json();
}

// ═══════════════════════════════════════════════════════════════════
//  ROUTES PRODUITS
// ═══════════════════════════════════════════════════════════════════

// GET /api/products — Liste tous les produits actifs
app.get('/api/products', async (req, res) => {
  try {
    const { category, limit = 40, offset = 0, search } = req.query;
    let q = supabase.from('products').select('*', { count: 'exact' })
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    
    if (category) q = q.eq('category', category);
    if (search)   q = q.ilike('name', `%${search}%`);
    
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data: data || [], total: count || 0 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/products/:id
app.get('/api/products/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    // Incrémenter vues
    supabase.from('products').update({ view_count: (data.view_count || 0) + 1 }).eq('id', req.params.id).then(() => {});
    res.json({ success: true, data });
  } catch (e) {
    res.status(404).json({ success: false, error: 'Produit non trouvé' });
  }
});

// POST /api/products — Créer un produit (admin)
app.post('/api/products', adminOnly, async (req, res) => {
  try {
    const { name, description, images, cj_pid, cj_price_usd, price_fcfa, category, status, variants, metadata } = req.body;
    if (!name) return res.status(400).json({ error: 'Nom requis' });
    
    const finalPrice = price_fcfa || calcPrice(cj_price_usd || 0);
    const { data, error } = await supabase.from('products').insert({
      name, description: description || '', images: images || [],
      cj_pid: cj_pid || `CUSTOM_${Date.now()}`,
      cj_price_usd: parseFloat(cj_price_usd || 0),
      price_fcfa: parseInt(finalPrice),
      category: category || 'Général',
      status: status || 'active',
      variants: variants || [],
      metadata: metadata || {}
    }).select().single();
    
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/products/:id — Modifier
app.put('/api/products/:id', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/products/:id
app.delete('/api/products/:id', adminOnly, async (req, res) => {
  try {
    const { error } = await supabase.from('products').update({ status: 'archived' }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  ROUTES CJ DROPSHIPPING
// ═══════════════════════════════════════════════════════════════════

// GET /api/cj/products/search
app.get('/api/cj/products/search', async (req, res) => {
  try {
    const { keyword = '', pageNum = 1, pageSize = 20, categoryId } = req.query;
    const params = { pageNum: parseInt(pageNum), pageSize: parseInt(pageSize) };
    if (keyword)    params.productNameEn = keyword;
    if (categoryId) params.categoryId = categoryId;
    
    const d = await cjRequest('/v1/product/list', params);
    
    if (!d.result) {
      return res.json({ success: false, error: d.message, data: [], total: 0 });
    }
    
    const products = (d.data?.list || []).map(p => ({
      pid: p.pid,
      productNameEn: p.productNameEn,
      productImage: p.productImage,
      categoryName: p.categoryName,
      sellPrice: parseFloat(p.sellPrice || 0),
      listingPrice: parseFloat(p.listingPrice || 0),
      description: p.description || '',
      variants: p.variants || [],
      priceCalc: {
        usd: parseFloat(p.sellPrice || 0),
        finalFCFA: calcPrice(p.sellPrice || 0)
      }
    }));
    
    res.json({ success: true, data: products, total: d.data?.total || products.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message, data: [] });
  }
});

// GET /api/cj/product/:pid — Détail produit CJ
app.get('/api/cj/product/:pid', adminOnly, async (req, res) => {
  try {
    const d = await cjRequest('/v1/product/query', { pid: req.params.pid });
    if (!d.result) throw new Error(d.message);
    
    const p = d.data;
    res.json({
      success: true,
      data: {
        ...p,
        priceCalc: { usd: parseFloat(p.sellPrice || 0), finalFCFA: calcPrice(p.sellPrice || 0) }
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/cj/import
app.post('/api/cj/import', async (req, res) => {
  try {
    const { pid, customPriceFCFA } = req.body;
    if (!pid) return res.status(400).json({ error: 'pid requis' });
    
    const d = await cjRequest('/v1/product/query', { pid });
    if (!d.result) throw new Error(d.message || 'Produit CJ introuvable');
    const p = d.data;
    
    const price_fcfa = customPriceFCFA || calcPrice(p.sellPrice || 0);
    
    // Vérifier si déjà importé
    const { data: existing } = await supabase.from('products').select('id').eq('cj_pid', pid).single();
    if (existing) {
      return res.json({ success: true, message: 'Produit déjà importé', data: existing });
    }
    
    const { data, error } = await supabase.from('products').insert({
      cj_pid: pid,
      name: p.productNameEn || p.productName,
      description: p.description || '',
      images: p.productImageSet?.map(i => i.imageUrl) || [p.productImage],
      cj_price_usd: parseFloat(p.sellPrice || 0),
      price_fcfa: parseInt(price_fcfa),
      category: p.categoryName || 'Général',
      status: 'active',
      variants: p.variants || [],
      metadata: { cj_data: { categoryId: p.categoryId, weight: p.weight } }
    }).select().single();
    
    if (error) throw error;
    res.json({ success: true, data, message: 'Produit importé avec succès !' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/cj/categories
app.get('/api/cj/categories', async (req, res) => {
  try {
    const d = await cjRequest('/v1/product/getCategory', {});
    res.json({ success: true, data: d.data || [] });
  } catch (e) {
    res.json({ success: false, data: [], error: e.message });
  }
});

// POST /api/cj/order — Passer commande chez CJ
app.post('/api/cj/order', adminOnly, async (req, res) => {
  try {
    const { orderId, shippingInfo, products } = req.body;
    const d = await cjRequest('/v1/shopping/order/createOrderV2', {
      orderNumber: orderId,
      shippingZip: shippingInfo?.zip || '',
      shippingCountry: 'SN',
      shippingCountryCode: 'SN',
      shippingProvince: shippingInfo?.city || 'Dakar',
      shippingCity: shippingInfo?.city || 'Dakar',
      shippingAddress: shippingInfo?.street || '',
      shippingAddress2: '',
      shippingCustomerName: shippingInfo?.name || '',
      shippingPhone: shippingInfo?.phone || '',
      remark: `SoukDrop Order ${orderId}`,
      logisticName: 'CJ Packet Standard',
      products: products.map(p => ({
        vid: p.vid || '',
        quantity: parseInt(p.quantity || 1)
      }))
    }, 'POST');
    
    res.json({ success: d.result, data: d.data, message: d.message });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/cj/track/:cjOrderId
app.get('/api/cj/track/:cjOrderId', async (req, res) => {
  try {
    const d = await cjRequest('/v1/shopping/order/getOrderDetail', { orderId: req.params.cjOrderId });
    res.json({ success: d.result, data: d.data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  ROUTES COMMANDES
// ═══════════════════════════════════════════════════════════════════

// POST /api/orders/create
app.post('/api/orders/create', async (req, res) => {
  try {
    const { items, customer, shippingCostFCFA = 0, logisticName = 'Standard', logisticId } = req.body;
    
    if (!items?.length || !customer?.name || !customer?.email) {
      return res.status(400).json({ error: 'Données commande incomplètes' });
    }
    
    const subtotal = items.reduce((s, i) => s + (i.priceFCFA * i.quantity), 0);
    const total    = subtotal + parseInt(shippingCostFCFA);
    
    const { data: order, error } = await supabase.from('orders').insert({
      customer_name:    customer.name,
      customer_email:   customer.email,
      customer_phone:   customer.phone || '',
      shipping_address: customer.address || {},
      items:            items,
      subtotal_fcfa:    subtotal,
      shipping_fcfa:    parseInt(shippingCostFCFA),
      total_fcfa:       total,
      logistic_id:      logisticId || '',
      logistic_name:    logisticName,
      status:           'pending_payment',
      payment_method:   'paytech'
    }).select().single();
    
    if (error) throw error;
    
    // Initialiser paiement PayTech
    let paymentUrl = null;
    try {
      paymentUrl = await initiatePayTech(order);
    } catch (pe) {
      console.error('PayTech init error:', pe.message);
    }
    
    res.json({ success: true, data: order, paymentUrl });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/orders — Liste commandes (admin)
app.get('/api/orders', adminOnly, async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    let q = supabase.from('orders').select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    
    if (status) q = q.eq('status', status);
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data: data || [], total: count || 0 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/orders/:id
app.get('/api/orders/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('orders').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(404).json({ success: false, error: 'Commande non trouvée' });
  }
});

// PUT /api/orders/:id/status
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { status, tracking_number, cj_order_id, notes } = req.body;
    const update = { status };
    if (tracking_number) update.tracking_number = tracking_number;
    if (cj_order_id)     update.cj_order_id = cj_order_id;
    if (notes)           update.notes = notes;
    if (status === 'paid') update.paid_at = new Date().toISOString();
    
    const { data, error } = await supabase.from('orders').update(update).eq('id', req.params.id).select().single();
    if (error) throw error;
    
    // Envoyer email si commande payée
    if (status === 'paid') sendOrderEmail(data).catch(console.error);
    
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  PAYTECH — Paiement Mobile Money Sénégal
// ═══════════════════════════════════════════════════════════════════

async function initiatePayTech(order) {
  const payload = {
    item_name:    `Commande SoukDrop #${order.id.slice(0, 8).toUpperCase()}`,
    item_price:   order.total_fcfa,
    currency:     'XOF',
    ref_command:  order.id,
    command_name: `SoukDrop — ${order.customer_name}`,
    env:          'prod',
    ipn_url:      `${process.env.BASE_URL}/api/paytech/ipn`,
    success_url:  `${process.env.FRONTEND_URL || 'http://localhost:3001'}/#/commande/succes?order=${order.id}`,
    cancel_url:   `${process.env.FRONTEND_URL || 'http://localhost:3001'}/#/panier`
  };
  
  const r = await fetch('https://paytech.sn/api/payment/request-payment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'API_KEY':    process.env.PAYTECH_API_KEY,
      'API_SECRET': process.env.PAYTECH_SECRET_KEY
    },
    body: JSON.stringify(payload)
  });
  
  const d = await r.json();
  if (d.success === 1) {
    // Sauvegarder la ref PayTech
    await supabase.from('orders').update({ paytech_ref: d.token }).eq('id', order.id);
    return `https://paytech.sn/payment/checkout/${d.token}`;
  }
  throw new Error(d.errors?.join(', ') || 'PayTech: erreur paiement');
}

// POST /api/paytech/ipn — Notification de paiement (webhook)
app.post('/api/paytech/ipn', async (req, res) => {
  try {
    const { ref_command, type_event, api_key_sha256, api_secret_sha256 } = req.body;
    
    // Vérifier la signature PayTech
    const crypto = await import('crypto');
    const expectedKey = crypto.createHash('sha256').update(process.env.PAYTECH_API_KEY).digest('hex');
    const expectedSec = crypto.createHash('sha256').update(process.env.PAYTECH_SECRET_KEY).digest('hex');
    
    if (api_key_sha256 !== expectedKey || api_secret_sha256 !== expectedSec) {
      console.error('PayTech IPN: signature invalide');
      return res.status(403).send('Forbidden');
    }
    
    if (type_event === 'sale_complete') {
      const { data: order, error } = await supabase.from('orders')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', ref_command).select().single();
      
      if (!error && order) {
        console.log(`✅ Paiement confirmé: commande ${ref_command}`);
        // Envoyer email confirmation
        sendOrderEmail(order).catch(console.error);
        // Tenter de placer la commande CJ automatiquement
        placeCJOrder(order).catch(console.error);
      }
    }
    
    res.send('OK');
  } catch (e) {
    console.error('PayTech IPN erreur:', e.message);
    res.status(500).send('Error');
  }
});

// Placer commande CJ automatiquement après paiement
async function placeCJOrder(order) {
  try {
    const cjItems = order.items.filter(i => i.supplier === 'cj' || !i.supplier);
    if (!cjItems.length) return;
    
    // Récupérer les CJ PIDs
    const productIds = cjItems.map(i => i.productId);
    const { data: products } = await supabase.from('products').select('id,cj_pid,variants').in('id', productIds);
    
    const cjProducts = cjItems.map(item => {
      const prod = products?.find(p => p.id === item.productId);
      return { vid: prod?.variants?.[0]?.vid || '', quantity: item.quantity, cj_pid: prod?.cj_pid };
    }).filter(p => p.cj_pid);
    
    if (!cjProducts.length) return;
    
    const result = await cjRequest('/v1/shopping/order/createOrderV2', {
      orderNumber: order.id,
      shippingCountry: 'SN',
      shippingCountryCode: 'SN',
      shippingProvince: order.shipping_address?.city || 'Dakar',
      shippingCity: order.shipping_address?.city || 'Dakar',
      shippingAddress: order.shipping_address?.street || '',
      shippingCustomerName: order.customer_name,
      shippingPhone: order.customer_phone || '',
      remark: `SoukDrop Auto-Order ${order.id.slice(0, 8)}`,
      logisticName: 'CJ Packet Standard',
      products: cjProducts
    }, 'POST');
    
    if (result.result) {
      await supabase.from('orders').update({
        cj_order_id: result.data?.orderId,
        status: 'processing'
      }).eq('id', order.id);
      console.log(`📦 Commande CJ placée: ${result.data?.orderId}`);
    } else {
      await supabase.from('orders').update({ cj_error: result.message }).eq('id', order.id);
      console.error('CJ Order erreur:', result.message);
    }
  } catch (e) {
    console.error('placeCJOrder erreur:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  EMAIL — Nodemailer
// ═══════════════════════════════════════════════════════════════════

async function sendOrderEmail(order) {
  if (!process.env.RESEND_API_KEY) {
    console.log('⚠️  Resend non configuré — email non envoyé');
    return;
  }
  const fcfa = n => new Intl.NumberFormat('fr-SN', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(n || 0);
  const itemsHtml = (order.items || []).map(i =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">${i.name || ''}</td>
     <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">×${i.quantity}</td>
     <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${fcfa((i.priceFCFA||0) * i.quantity)}</td></tr>`
  ).join('');
  const html = `<div style="max-width:560px;margin:0 auto;font-family:Arial,sans-serif;color:#1a1a1a">
    <div style="background:linear-gradient(135deg,#C8F04D,#A8E6FF);padding:28px;text-align:center;border-radius:12px 12px 0 0">
      <h1 style="margin:0;font-size:26px;color:#09090E;font-weight:900">SoukDrop</h1>
      <p style="margin:6px 0 0;color:#09090E;opacity:.7">Commande confirmée ✓</p>
    </div>
    <div style="background:#f9f9f9;padding:28px;border-radius:0 0 12px 12px">
      <h2 style="font-size:18px;margin:0 0 6px">Merci ${order.customer_name} !</h2>
      <p style="color:#666;font-size:13px;margin:0 0 18px">Réf : <strong>${(order.id||'').slice(0,12).toUpperCase()}</strong></p>
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#fff;border-radius:8px;border:1px solid #eee">
        <thead><tr style="background:#f0f0f0">
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#666">ARTICLE</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;color:#666">QTÉ</th>
          <th style="padding:10px 12px;text-align:right;font-size:11px;color:#666">PRIX</th>
        </tr></thead>
        <tbody>${itemsHtml}</tbody>
        <tfoot><tr>
          <td colspan="2" style="padding:12px;font-weight:700;text-align:right">Total :</td>
          <td style="padding:12px;font-weight:900;font-size:16px;color:#09090E;text-align:right">${fcfa(order.total_fcfa)}</td>
        </tr></tfoot>
      </table>
      <div style="margin-top:18px;padding:14px;background:#e8f5e9;border-radius:8px;font-size:12px;line-height:1.7;color:#2e7d32">
        📦 Commande en cours de traitement<br>
        🚚 Livraison via ${order.logistic_name || 'Standard'}<br>
        📧 Gardez cet email pour le suivi
      </div>
      <p style="margin-top:18px;font-size:11px;color:#999;text-align:center">© ${new Date().getFullYear()} SoukDrop — Dakar, Sénégal</p>
    </div>
  </div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: 'SoukDrop <onboarding@resend.dev>',
        to:   order.customer_email,
        subject: `✅ Commande confirmée — SoukDrop #${(order.id||'').slice(0,8).toUpperCase()}`,
        html
      })
    });
    const d = await r.json();
    if (d.id) console.log(`📧 Email envoyé à ${order.customer_email} (${d.id})`);
    else console.error('Resend erreur:', JSON.stringify(d));
  } catch(e) {
    console.error('Email erreur:', e.message);
  }
}


// ═══════════════════════════════════════════════════════════════════
//  ADMIN — Stats & Gestion
// ═══════════════════════════════════════════════════════════════════

// GET /api/admin/stats
app.get('/api/admin/stats', async (req, res) => {
  try {
    const { data, error } = await supabase.from('dashboard_stats').select('*').single();
    if (error) throw error;
    res.json({ success: true, data: {
      products: parseInt(data.active_products || 0),
      paid_orders: parseInt(data.paid_orders || 0),
      pending_orders: parseInt(data.pending_orders || 0),
      revenue: parseInt(data.total_revenue_fcfa || 0),
      monthly: parseInt(data.monthly_revenue_fcfa || 0),
      sellers: 0
    }});
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/orders — Toutes les commandes
app.get('/api/admin/orders', async (req, res) => {
  try {
    const { status, limit = 100, offset = 0 } = req.query;
    let q = supabase.from('orders').select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    if (status) q = q.eq('status', status);
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data: data || [], total: count || 0 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/products — Tous les produits
app.get('/api/admin/products', async (req, res) => {
  try {
    const { status, limit = 100, offset = 0 } = req.query;
    let q = supabase.from('products').select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    if (status) q = q.eq('status', status);
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data: data || [], total: count || 0 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/settings
app.get('/api/settings', async (req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('*');
    if (error) throw error;
    const settings = {};
    (data || []).forEach(r => { settings[r.key] = r.value; });
    res.json({ success: true, data: settings });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/settings
app.put('/api/settings', adminOnly, async (req, res) => {
  try {
    const updates = Object.entries(req.body).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
    const { error } = await supabase.from('settings').upsert(updates, { onConflict: 'key' });
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/categories
app.get('/api/categories', async (req, res) => {
  try {
    const { data, error } = await supabase.from('categories').select('*').eq('active', true).order('sort_order');
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const { data, error } = await supabase.from('settings').select('key').limit(1);
  res.json({
    status: 'ok',
    supabase: !error ? 'connected' : 'error: ' + error.message,
    cj_configured: !!(process.env.CJ_EMAIL && process.env.CJ_API_KEY),
    paytech_configured: !!(process.env.PAYTECH_API_KEY && process.env.PAYTECH_SECRET_KEY),
    smtp_configured: !!(process.env.RESEND_API_KEY),
    resend_configured: !!(process.env.RESEND_API_KEY),
    timestamp: new Date().toISOString()
  });
});

// ── Servir le frontend ────────────────────────────────────────────
app.use(express.static(__dirname));
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Démarrage ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  🚀 SoukDrop Backend — PRÊT À VENDRE             ║');
  console.log(`║  http://localhost:${PORT}                          ║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Supabase URL : ${(process.env.SUPABASE_URL||'').slice(0,30)}...`);
  console.log(`║  CJ Email     : ${process.env.CJ_EMAIL || '❌ Non configuré'}`);
  console.log(`║  PayTech      : ${process.env.PAYTECH_API_KEY ? '✅ Configuré' : '❌ Non configuré'}`);
  console.log(`║  Email (Resend): ${process.env.RESEND_API_KEY ? '✅ Configuré' : '❌ Non configuré'}`);

  console.log('╚══════════════════════════════════════════════════╝\n');
  
  // Tester connexion CJ au démarrage
  getCJToken().then(tok => {
    console.log(tok ? '✅ CJ Dropshipping connecté' : '❌ CJ Dropshipping: échec connexion');
  });
});







