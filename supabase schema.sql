-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  DropShip SN — Schéma Supabase v2.0                            ║
-- ║  À exécuter dans : Supabase Dashboard → SQL Editor              ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- Pour la recherche full-text

-- ─────────────────────────────────────────────────────────────────────
-- TABLE : products
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.products (
  id            UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  cj_pid        TEXT        UNIQUE NOT NULL,
  name          TEXT        NOT NULL,
  description   TEXT        DEFAULT '',
  images        JSONB       DEFAULT '[]'::jsonb,
  cj_price_usd  NUMERIC(10,2) NOT NULL DEFAULT 0,
  price_fcfa    INTEGER     NOT NULL,
  category      TEXT        DEFAULT 'Général',
  status        TEXT        DEFAULT 'active'
                CHECK (status IN ('active','draft','archived')),
  variants      JSONB       DEFAULT '[]'::jsonb,
  metadata      JSONB       DEFAULT '{}'::jsonb,
  view_count    INTEGER     DEFAULT 0,
  order_count   INTEGER     DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Index produits
CREATE INDEX IF NOT EXISTS idx_products_status   ON public.products(status);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_products_created  ON public.products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON public.products USING gin(name gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────────────
-- TABLE : orders
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orders (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  customer_name     TEXT        NOT NULL,
  customer_email    TEXT        NOT NULL,
  customer_phone    TEXT,
  shipping_address  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  items             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  subtotal_fcfa     INTEGER     NOT NULL DEFAULT 0,
  shipping_fcfa     INTEGER     DEFAULT 0,
  total_fcfa        INTEGER     NOT NULL,
  logistic_id       TEXT,
  logistic_name     TEXT        DEFAULT 'Standard',
  status            TEXT        DEFAULT 'pending_payment'
                    CHECK (status IN (
                      'pending_payment','paid','processing',
                      'shipped','delivered','cancelled','refunded'
                    )),
  paytech_ref       TEXT,
  payment_method    TEXT,
  paid_at           TIMESTAMPTZ,
  cj_order_id       TEXT,
  tracking_number   TEXT,
  cj_error          TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Index commandes
CREATE INDEX IF NOT EXISTS idx_orders_status       ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_email        ON public.orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_created      ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_cj_order     ON public.orders(cj_order_id) WHERE cj_order_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- TABLE : categories (référentiel)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.categories (
  id         SERIAL    PRIMARY KEY,
  name       TEXT      UNIQUE NOT NULL,
  slug       TEXT      UNIQUE NOT NULL,
  icon       TEXT      DEFAULT '📦',
  sort_order INTEGER   DEFAULT 0,
  active     BOOLEAN   DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.categories (name, slug, icon, sort_order) VALUES
  ('Électronique',    'electronique',  '📱', 1),
  ('Mode & Vêtements','mode',          '👗', 2),
  ('Maison & Jardin', 'maison',        '🏠', 3),
  ('Beauté & Santé',  'beaute',        '💄', 4),
  ('Sport & Fitness', 'sport',         '⚽', 5),
  ('Jouets & Enfants','jouets',        '🧸', 6),
  ('Automobile',      'auto',          '🚗', 7),
  ('Informatique',    'informatique',  '💻', 8),
  ('Cuisine',         'cuisine',       '🍳', 9),
  ('Bijoux',          'bijoux',        '💍', 10)
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- TABLE : settings
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.settings (
  key        TEXT  PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.settings (key, value) VALUES
  ('store_name',       '"DropShip SN"'),
  ('store_email',      '"contact@dropship-sn.com"'),
  ('whatsapp',         '"+221700000000"'),
  ('usd_to_fcfa',      '615'),
  ('price_margin',     '1.40'),
  ('est_shipping_usd', '8'),
  ('banner_text',      '"🚚 Livraison au Sénégal · Wave & OM acceptés · Commandez maintenant !"'),
  ('hero_title',       '"Les meilleurs produits livrés chez vous"')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- TRIGGER : updated_at automatique
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_updated ON public.products;
CREATE TRIGGER trg_products_updated
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_orders_updated ON public.orders;
CREATE TRIGGER trg_orders_updated
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.products  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings  ENABLE ROW LEVEL SECURITY;

-- Produits : lecture publique (actifs uniquement)
CREATE POLICY "Public: lire produits actifs"
  ON public.products FOR SELECT
  USING (status = 'active');

-- Produits : écriture via service_role uniquement
CREATE POLICY "Service: gérer tous produits"
  ON public.products FOR ALL
  USING (auth.role() = 'service_role');

-- Commandes : service_role seulement
CREATE POLICY "Service: gérer toutes commandes"
  ON public.orders FOR ALL
  USING (auth.role() = 'service_role');

-- Commandes : insertion publique (pour créer une commande)
CREATE POLICY "Public: créer commande"
  ON public.orders FOR INSERT
  WITH CHECK (true);

-- Catégories : lecture publique
CREATE POLICY "Public: lire catégories"
  ON public.categories FOR SELECT
  USING (active = true);

-- Settings : lecture publique
CREATE POLICY "Public: lire settings"
  ON public.settings FOR SELECT
  USING (true);

-- ─────────────────────────────────────────────────────────────────────
-- VUE : stats tableau de bord
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.dashboard_stats AS
SELECT
  (SELECT COUNT(*) FROM public.products  WHERE status = 'active')       AS active_products,
  (SELECT COUNT(*) FROM public.orders    WHERE status = 'paid')          AS paid_orders,
  (SELECT COUNT(*) FROM public.orders    WHERE status = 'pending_payment') AS pending_orders,
  (SELECT COALESCE(SUM(total_fcfa), 0) FROM public.orders WHERE status = 'paid') AS total_revenue_fcfa,
  (SELECT COALESCE(SUM(total_fcfa), 0) FROM public.orders
    WHERE status = 'paid' AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
  ) AS monthly_revenue_fcfa;

-- ─────────────────────────────────────────────────────────────────────
-- CONFIRMATION : tout est OK
-- ─────────────────────────────────────────────────────────────────────
SELECT
  'products'   AS table_name, COUNT(*) AS rows FROM public.products   UNION ALL
SELECT 'categories', COUNT(*) FROM public.categories UNION ALL
SELECT 'settings',   COUNT(*) FROM public.settings   UNION ALL
SELECT 'orders',     COUNT(*) FROM public.orders;