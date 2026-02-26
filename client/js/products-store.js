/* Beyond Silhouette — Products Store (API-backed with safe fallback)
   - Primary source: Railway API (/api/products)
   - Keeps the SAME public API your main.js expects: window.BSProducts.readAll(), listPublished(), etc.
*/

(() => {
  "use strict";

  const API_BASE = "https://bs-api-live.up.railway.app";
  const CACHE_KEY = "bs_products_cache_v1";
  const CACHE_TTL_MS = 60 * 1000; // 60s

  function safeParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  function writeCache(products) {
    const payload = { at: Date.now(), products: Array.isArray(products) ? products : [] };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  }

  function readCache() {
    const raw = localStorage.getItem(CACHE_KEY);
    const obj = raw ? safeParse(raw) : null;
    if (!obj || !Array.isArray(obj.products) || !Number.isFinite(obj.at)) return null;
    if (Date.now() - obj.at > CACHE_TTL_MS) return null;
    return obj.products;
  }

  function normalizeApiProduct(p) {
    const id = String(p?.id || "");

    const name = String(p?.name || p?.title || "").trim();
    const title = name; // main.js currently uses product.name in places; we keep both

    const priceJMD = Number.isFinite(Number(p?.priceJMD)) ? Number(p.priceJMD) : 0;

    // cover image: prefer first image url if present
    const coverUrl =
      (Array.isArray(p?.images) && p.images[0]?.url) ? String(p.images[0].url) :
      (p?.media?.coverUrl ? String(p.media.coverUrl) : "");

    // build stockBySize from inventory[] if present
    const stockBySize = {};
    if (Array.isArray(p?.inventory)) {
      p.inventory.forEach(row => {
        const size = String(row?.size || "").trim();
        const stock = Number(row?.stock);
        if (size) stockBySize[size] = Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0;
      });
    }

    // sizes: from stock map keys, else default
    const sizes = Object.keys(stockBySize).length
      ? Object.keys(stockBySize)
      : (Array.isArray(p?.sizes) && p.sizes.length ? p.sizes.map(String) : ["S", "M", "L", "XL"]);

    const isPublished = !!p?.isPublished;

    return {
      id,
      name,
      title,
      priceJMD,
      description: p?.description || "",
      isPublished,
      sizes,
      stockBySize,
      media: { coverUrl }
    };
  }

  async function fetchProductsFromApi() {
    const url = `${API_BASE}/api/products`;
    const res = await fetch(url, { credentials: "include" });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data || data.ok !== true || !Array.isArray(data.products)) {
      return null;
    }

    const normalized = data.products.map(normalizeApiProduct);
    return normalized;
  }

  // Optional fallback demo list (keeps UI non-empty if API returns [])
  function demoFallback() {
    // Minimal, clean fallback (no broken “test image” paths)
    return [];
  }

  let _products = [];

  async function bootstrap() {
    // quick cache first
    const cached = readCache();
    if (cached) {
      _products = cached;
      return;
    }

    const apiList = await fetchProductsFromApi().catch(() => null);
    if (apiList && apiList.length) {
      _products = apiList;
      writeCache(_products);
      return;
    }

    // API empty or unreachable
    _products = demoFallback();
    writeCache(_products);
  }

  // Start loading ASAP
  bootstrap();

  window.BSProducts = {
    readAll() {
      return Array.isArray(_products) ? _products : [];
    },
    listPublished() {
      return this.readAll().filter(p => !!p?.isPublished);
    },
    findById(id) {
      const pid = String(id || "");
      return this.readAll().find(p => String(p?.id) === pid) || null;
    },
    // allow manual refresh (handy for admin after publishing)
    async refresh() {
      const apiList = await fetchProductsFromApi().catch(() => null);
      if (apiList && Array.isArray(apiList)) {
        _products = apiList;
        writeCache(_products);
      }
      return this.readAll();
    }
  };
})();