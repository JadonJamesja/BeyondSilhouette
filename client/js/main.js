/**
 * Beyond Silhouette — main.js (FULL SITE)
 * - Shop renders from Products Store (window.BSProducts) if present
 * - If total stock = 0 => prints "New stock coming soon."
 * - Cart + auth + checkout + orders remain local demo (localStorage)
 *
 * IMPORTANT:
 * - Checkout will ONLY render into an existing <main> element (to avoid wiping the header/nav).
 * - Put your checkout layout CSS in css/checkout.css (no inline styles here).
 */

(() => {
  'use strict';

  // -----------------------------
  // GLOBAL NAMESPACE
  // -----------------------------
  window.BeyondSilhouette = window.BeyondSilhouette || {};
  const BS = window.BeyondSilhouette;

  // -----------------------------
  // KEYS / STORAGE
  // -----------------------------
  const KEYS = {
    state: 'bs_state_v1',          // { cartByUser, productCache, ordersByUser }
    session: 'bs_session_v1',      // { email, token, createdAt, provider }
    users: 'bs_users_v1',          // { [email]: { email, name, passwordHash, createdAt, role } }
    returnTo: 'bs_return_to_v1',   // { href }
    pwReset: 'bs_pw_reset_v1'      // { [email]: { code, expiresAt }
  };

  const USER_GUEST = '__guest__';

  // -----------------------------
  // UTILS
  // -----------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const nowISO = () => new Date().toISOString();
  const uid = (p = '') => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const money = (n) => `J$${Number(n || 0).toFixed(2)}`;
  const page = () => (location.pathname.split('/').pop() || '').toLowerCase();

  function escapeHtml(s) {
    return String(s || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatMemberSince(iso) {
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  }

  // -----------------------------
  // TOAST
  // -----------------------------
  function ensureToastStyles() {
    if (document.getElementById('bs-toast-style')) return;
    const style = document.createElement('style');
    style.id = 'bs-toast-style';
    style.textContent = `
      .bs-toast{
        position:fixed;
        left:50%;
        bottom:24px;
        transform:translateX(-50%);
        background:rgba(0,0,0,.88);
        color:#fff;
        padding:10px 14px;
        border-radius:12px;
        font-size:14px;
        z-index:999999;
        opacity:0;
        transition:opacity .2s ease, transform .2s ease;
        pointer-events:none;
        max-width:min(92vw,520px);
        text-align:center;
      }
      .bs-toast.show{
        opacity:1;
        transform:translateX(-50%) translateY(-6px);
      }
    `;
    document.head.appendChild(style);
  }

  function toast(msg, { important = false } = {}) {
    ensureToastStyles();

    if (important) {
      try { alert(msg); } catch (_) { }
    }

    const el = document.createElement('div');
    el.className = 'bs-toast';
    el.textContent = msg;
    document.body.appendChild(el);

    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 220);
    }, 2400);
  }

  // -----------------------------
  // STATE
  // -----------------------------
  function readState() {
    const raw = localStorage.getItem(KEYS.state);
    const st = raw ? (safeParse(raw) || {}) : {};
    st.cartByUser = st.cartByUser || {};
    st.productCache = st.productCache || {};
    st.ordersByUser = st.ordersByUser || {};
    return st;
  }

  function writeState(st) {
    localStorage.setItem(KEYS.state, JSON.stringify(st));
  }

  function readSession() {
    const raw = localStorage.getItem(KEYS.session);
    return raw ? (safeParse(raw) || null) : null;
  }

  function writeSession(sess) {
    localStorage.setItem(KEYS.session, JSON.stringify(sess));
  }

  function clearSession() {
    localStorage.removeItem(KEYS.session);
  }

  function readUsers() {
    const raw = localStorage.getItem(KEYS.users);
    return raw ? (safeParse(raw) || {}) : {};
  }

  function writeUsers(users) {
    localStorage.setItem(KEYS.users, JSON.stringify(users || {}));
  }

  // -----------------------------
  // PASSWORD RESET STORE (OPTION B)
  // -----------------------------
  function readPwResets() {
    const raw = localStorage.getItem(KEYS.pwReset);
    const obj = raw ? (safeParse(raw) || {}) : {};
    return (obj && typeof obj === 'object') ? obj : {};
  }

  function writePwResets(map) {
    localStorage.setItem(KEYS.pwReset, JSON.stringify(map || {}));
  }

  function isExpiredISO(iso) {
    if (!iso) return true;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return true;
    return Date.now() > t;
  }

  function generateResetCode6() {
    // 6-digit numeric code (100000 - 999999)
    const n = Math.floor(100000 + Math.random() * 900000);
    return String(n);
  }

  // -----------------------------
  // DEMO HASH (NOT SECURE)
  // -----------------------------
  function demoHash(pwd) {
    let h = 0;
    const s = String(pwd || '');
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return btoa(`${h}:${s.length}`);
  }

  // -----------------------------
  // API helper (server cookie session)
  // -----------------------------
  async function apiJson(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include'
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }

  // -----------------------------
  // AUTH (SERVER FIRST, DEMO FALLBACK)
  // -----------------------------
  const Auth = {
    _serverUser: null, // { id, email, name, role, createdAt, ... } from /api/me

    async bootstrap() {
      // Try to hydrate auth from server cookie session
      try {
        const { ok, data } = await apiJson('/api/me');
        if (ok && data?.user?.email) {
          this._serverUser = data.user;

          // Mirror into local users store for UI pages that read from readUsers()
          const em = String(data.user.email).trim().toLowerCase();
          const users = readUsers();
          users[em] = users[em] || {};
          users[em].email = em;
          users[em].name = users[em].name || data.user.name || em;
          users[em].createdAt = users[em].createdAt || data.user.createdAt || nowISO();
          users[em].role = data.user.role || users[em].role || 'customer';
          writeUsers(users);

          // Mark session provider as server (cookie is source of truth)
          writeSession({ email: em, token: uid('sess_'), createdAt: nowISO(), provider: 'server' });

          Cart.mergeGuestIntoUser(em);
          return true;
        }

        // Not logged in on server
        this._serverUser = null;
        // DO NOT clear local demo session automatically; allow fallback
        return false;
      } catch (_) {
        // If server not reachable or not running API, keep demo behavior
        this._serverUser = null;
        return false;
      }
    },

    currentUser() {
      // Prefer server user if present
      if (this._serverUser?.email) {
        const em = String(this._serverUser.email).trim().toLowerCase();
        const users = readUsers();
        // prefer locally-stored user fields if they exist, otherwise server fields
        return users[em] || {
          email: em,
          name: this._serverUser.name || em,
          createdAt: this._serverUser.createdAt || nowISO(),
          role: this._serverUser.role || 'customer'
        };
      }

      // Demo fallback
      const sess = readSession();
      if (!sess || !sess.email) return null;
      const users = readUsers();
      return users[sess.email] || null;
    },

    async registerServer({ fullname, email, password }) {
      const name = String(fullname || '').trim();
      const em = String(email || '').trim().toLowerCase();
      const pw = String(password || '').trim();

      const { ok, data, status } = await apiJson('/api/auth/register', {
        method: 'POST',
        body: { name, email: em, password: pw }
      });

      if (!ok) {
        const msg = data?.error || `Registration failed (${status})`;
        throw new Error(msg);
      }

      // After register, cookie session should be set; bootstrap from /api/me for consistency
      await this.bootstrap();
      return data?.user || null;
    },

    async loginServer({ email, password }) {
      const em = String(email || '').trim().toLowerCase();
      const pw = String(password || '').trim();

      const { ok, data, status } = await apiJson('/api/auth/login', {
        method: 'POST',
        body: { email: em, password: pw }
      });

      if (!ok) {
        const msg = data?.error || `Login failed (${status})`;
        throw new Error(msg);
      }

      await this.bootstrap();
      return data?.user || null;
    },

    async logoutServer() {
      // Cookie session clear
      await apiJson('/api/auth/logout', { method: 'POST' }).catch(() => null);
      this._serverUser = null;
      // Also clear demo session so UI resets
      clearSession();
    },

    // Public API used by forms (server-first, demo fallback)
    async register({ fullname, email, password, confirmPassword }) {
      const em = String(email || '').trim().toLowerCase();
      const name = String(fullname || '').trim();

      const pw = String(password || '').trim();
      const cpw = String(confirmPassword || '').trim();

      if (!name || !em || !pw) throw new Error('Please fill in all required fields.');

      if (confirmPassword != null && cpw !== '' && pw !== cpw) {
        throw new Error('Passwords do not match.');
      }

      // Try server first
      try {
        const u = await this.registerServer({ fullname: name, email: em, password: pw });
        return u;
      } catch (err) {
        // Only fallback if server endpoint is missing/unreachable
        const msg = String(err?.message || '').toLowerCase();
        const canFallback =
          msg.includes('failed to fetch') ||
          msg.includes('networkerror') ||
          msg.includes('not found') ||
          msg.includes('unexpected token');

        if (!canFallback) throw err;
      }

      // ---- DEMO FALLBACK ----
      const users = readUsers();
      if (users[em]) throw new Error('An account already exists for this email.');

      users[em] = {
        email: em,
        name: name,
        passwordHash: demoHash(pw),
        createdAt: nowISO(),
        role: 'customer'
      };

      writeUsers(users);
      writeSession({ email: em, token: uid('sess_'), createdAt: nowISO(), provider: 'local' });

      Cart.mergeGuestIntoUser(em);
      return users[em];
    },

    async login({ email, password }) {
      const em = String(email || '').trim().toLowerCase();
      const pw = String(password || '').trim();

      // Try server first
      try {
        const u = await this.loginServer({ email: em, password: pw });
        return u;
      } catch (err) {
        const msg = String(err?.message || '').toLowerCase();
        const canFallback =
          msg.includes('failed to fetch') ||
          msg.includes('networkerror') ||
          msg.includes('not found') ||
          msg.includes('unexpected token');

        if (!canFallback) throw err;
      }

      // ---- DEMO FALLBACK ----
      const users = readUsers();
      const u = users[em];

      if (!u) throw new Error('No account found for this email.');
      if (u.passwordHash !== demoHash(pw)) throw new Error('Incorrect password.');

      writeSession({ email: em, token: uid('sess_'), createdAt: nowISO(), provider: 'local' });
      Cart.mergeGuestIntoUser(em);
      return u;
    },

    updateProfile({ name, currentPassword, newPassword }) {
      // NOTE: still demo-only in this file (we can add server endpoint later if you want)
      const user = this.currentUser();
      if (!user || !user.email) throw new Error('Please log in to continue.');

      const em = String(user.email).trim().toLowerCase();
      const nm = String(name || '').trim();
      const curr = String(currentPassword || '').trim();
      const next = (newPassword == null) ? '' : String(newPassword).trim();

      if (!nm) throw new Error('Please enter your display name.');
      if (!curr) throw new Error('Please enter your current password.');

      const users = readUsers();
      const u = users[em];
      if (!u) throw new Error('Account not found.');

      if (!u.passwordHash) {
        throw new Error('Password is not set for this account.');
      }

      if (u.passwordHash !== demoHash(curr)) {
        throw new Error('Current password is incorrect.');
      }

      u.name = nm;

      if (next) {
        u.passwordHash = demoHash(next);
      }

      u.email = u.email || em;
      u.createdAt = u.createdAt || user.createdAt || nowISO();
      u.role = u.role || user.role || 'customer';

      users[em] = u;
      writeUsers(users);

      const sess = readSession();
      if (sess && String(sess.email || '').toLowerCase() === em) {
        writeSession(sess);
      }

      return u;
    },

    requestPasswordReset(email) {
      const em = String(email || '').trim().toLowerCase();
      if (!em) throw new Error('Please enter your email.');

      const users = readUsers();
      const u = users[em];
      if (!u) throw new Error('No account found for this email.');

      const code = generateResetCode6();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

      const resets = readPwResets();
      resets[em] = { code, expiresAt };
      writePwResets(resets);

      return { code, expiresAt };
    },

    resetPassword({ email, code, newPassword }) {
      const em = String(email || '').trim().toLowerCase();
      const cd = String(code || '').trim();
      const np = String(newPassword || '').trim();

      if (!em) throw new Error('Please enter your email.');
      if (!cd) throw new Error('Please enter your reset code.');
      if (!np) throw new Error('Please enter a new password.');

      const users = readUsers();
      const u = users[em];
      if (!u) throw new Error('No account found for this email.');

      const resets = readPwResets();
      const entry = resets[em];
      if (!entry || !entry.code) throw new Error('No active reset request found. Please generate a new code.');

      if (isExpiredISO(entry.expiresAt)) {
        delete resets[em];
        writePwResets(resets);
        throw new Error('This reset code has expired. Please generate a new one.');
      }

      if (String(entry.code) !== cd) {
        throw new Error('Reset code is incorrect.');
      }

      u.passwordHash = demoHash(np);

      u.email = u.email || em;
      u.createdAt = u.createdAt || nowISO();
      u.role = u.role || 'customer';

      users[em] = u;
      writeUsers(users);

      delete resets[em];
      writePwResets(resets);

      return true;
    },

    async logout() {
      // Try server logout first if we appear to be server-authenticated
      const sess = readSession();
      if (sess?.provider === 'server' || this._serverUser?.email) {
        await this.logoutServer();
        return;
      }

      // Demo logout
      clearSession();
      this._serverUser = null;
    }
  };

  // -----------------------------
  // CART
  // -----------------------------
  const Cart = {
    userKey() {
      const u = Auth.currentUser();
      return u ? u.email : USER_GUEST;
    },

    load() {
      const st = readState();
      const key = this.userKey();
      const items = st.cartByUser[key]?.items || [];
      return Array.isArray(items) ? items : [];
    },

    save(items) {
      const st = readState();
      const key = this.userKey();
      st.cartByUser[key] = { items: Array.isArray(items) ? items : [] };
      writeState(st);
    },

    add(productId, size, qty = 1) {
      const items = this.load();
      const pid = String(productId);
      const sz = String(size || '');
      const qAdd = Math.max(1, Number(qty || 1));

      const product = Products.findById(pid);
      const hasStockMap = !!(product && product.stockBySize && typeof product.stockBySize === 'object' && sz);
      const base = hasStockMap ? Number(product.stockBySize?.[sz] ?? 0) : null;

      const existing = items.find(i => String(i.productId) === pid && String(i.size || '') === sz);

      if (base !== null && Number.isFinite(base)) {
        const otherQty = items.reduce((sum, row) => {
          if (row !== existing && String(row.productId) === pid && String(row.size || '') === sz) {
            return sum + Number(row.qty || 0);
          }
          return sum;
        }, 0);

        const maxAllowed = Math.max(0, base - otherQty);
        if (maxAllowed <= 0) return;

        const current = existing ? Number(existing.qty || 0) : 0;
        const next = Math.min(maxAllowed, current + qAdd);

        if (existing) existing.qty = next;
        else items.push({ productId: pid, size: sz, qty: next });

        this.save(items);
        return;
      }

      if (existing) {
        existing.qty = Number(existing.qty || 0) + qAdd;
      } else {
        items.push({ productId: pid, size: sz, qty: qAdd });
      }

      this.save(items);
    },

    remove(productId, size) {
      const pid = String(productId);
      const sz = String(size || '');
      const items = this.load().filter(i => !(String(i.productId) === pid && String(i.size || '') === sz));
      this.save(items);
    },

    setQty(productId, size, qty) {
      const pid = String(productId);
      const sz = String(size || '');
      const items = this.load();
      const it = items.find(i => String(i.productId) === pid && String(i.size || '') === sz);
      if (!it) return null;

      const desired = Math.max(1, Number(qty || 1));

      const product = Products.findById(pid);
      const hasStockMap = !!(product && product.stockBySize && typeof product.stockBySize === 'object' && sz);
      const base = hasStockMap ? Number(product.stockBySize?.[sz] ?? 0) : null;

      if (base !== null && Number.isFinite(base)) {
        const otherQty = items.reduce((sum, row) => {
          if (row !== it && String(row.productId) === pid && String(row.size || '') === sz) {
            return sum + Number(row.qty || 0);
          }
          return sum;
        }, 0);

        const maxAllowed = Math.max(0, base - otherQty);

        if (maxAllowed <= 0) {
          const nextItems = items.filter(row => row !== it);
          this.save(nextItems);
          return 0;
        }

        const applied = Math.min(maxAllowed, desired);
        it.qty = applied;
        this.save(items);
        return applied;
      }

      it.qty = desired;
      this.save(items);
      return desired;
    },

    clear() {
      this.save([]);
    },

    totalQty(items) {
      return (items || []).reduce((sum, it) => sum + Number(it.qty || 0), 0);
    },

    mergeGuestIntoUser(email) {
      const st = readState();
      const guest = st.cartByUser[USER_GUEST]?.items || [];
      if (!guest.length) return;

      const userItems = st.cartByUser[email]?.items || [];
      const merged = Array.isArray(userItems) ? userItems.slice() : [];

      guest.forEach(g => {
        const pid = String(g.productId);
        const sz = String(g.size || '');
        const existing = merged.find(i => String(i.productId) === pid && String(i.size || '') === sz);
        if (existing) existing.qty = Number(existing.qty || 0) + Number(g.qty || 0);
        else merged.push({ productId: pid, size: sz, qty: Number(g.qty || 0) });
      });

      st.cartByUser[email] = { items: merged };
      st.cartByUser[USER_GUEST] = { items: [] };
      writeState(st);
    }
  };

  // -----------------------------
  // PRODUCTS STORE (API-backed)
  // -----------------------------
  const Products = (() => {
    let _cache = [];

    return {
      setAll(products) {
        _cache = Array.isArray(products) ? products : [];
      },

      readAll() {
        return _cache;
      },

      listPublished() {
        return _cache.filter(p => p?.status === "published");
      },

      findById(id) {
        const pid = String(id || "");
        return _cache.find(p => String(p?.id) === pid) || null;
      }
    };
  })();
  // -----------------------------
  // ORDERS (LOCAL DEMO)
  // -----------------------------
  const Orders = {
    listFor(email) {
      const st = readState();
      const arr = st.ordersByUser[email] || [];
      return Array.isArray(arr) ? arr : [];
    },

    addFor(email, order) {
      const st = readState();
      st.ordersByUser[email] = st.ordersByUser[email] || [];
      st.ordersByUser[email].unshift(order);
      writeState(st);
    }
  };

  // -----------------------------
  // UI
  // -----------------------------
  const UI = {
    updateCartBadges() {
      const total = Cart.totalQty(Cart.load());
      $$('.cart-count').forEach(el => el.textContent = String(total));
    },

    updateNavAuthState() {
      const user = Auth.currentUser();
      const allLoginLinks = $$('a[href="login.html"]');
      const allRegisterLinks = $$('a[href="register.html"]');
      const allAccountLinks = $$('a[href="account.html"]');
      const allOrdersLinks = $$('a[href="orders.html"]');
      const allLogoutLinks = $$('a[href="logout.html"]');

      allLoginLinks.forEach(a => a.style.display = user ? 'none' : '');
      allRegisterLinks.forEach(a => a.style.display = user ? 'none' : '');
      allAccountLinks.forEach(a => a.style.display = user ? '' : 'none');
      allOrdersLinks.forEach(a => a.style.display = user ? '' : 'none');
      allLogoutLinks.forEach(a => a.style.display = user ? '' : 'none');
    },

    ensureHeaderFooter() {
      // Non-negotiable: do not inject full HTML layouts from JS.
      // Each page must include its own real header/footer markup.
      return;
    },

    bindLoginDropdown() {
      const icon = $('.loginIcon');
      const menu = $('.login-menu');
      if (!icon || !menu) return;

      icon.addEventListener('click', (e) => {
        e.preventDefault();
        menu.classList.toggle('show');
      });

      document.addEventListener('click', (e) => {
        if (!menu.contains(e.target) && !icon.contains(e.target)) {
          menu.classList.remove('show');
        }
      });
    },

    bindNavActive() {
      const current = page() || 'index.html';
      $$('#main-nav .nav-link').forEach(link => {
        const href = (link.getAttribute('href') || '').split('/').pop().toLowerCase();
        if (href === current) link.classList.add('active');
      });
    }
  };

  // -----------------------------
  // GOOGLE SIGN-IN (client-side hook)
  // -----------------------------
  async function handleGoogleCredential(credential) {
    if (!credential) return;

    try {
      const { ok, data } = await apiJson('/api/auth/google', {
        method: 'POST',
        body: { credential }
      });

      if (!ok) {
        toast(data?.error || 'Google sign-in is not configured on the server yet.', { important: true });
        return;
      }

      // cookie session should be set by server
      await Auth.bootstrap();

      const rt = safeParse(localStorage.getItem(KEYS.returnTo));
      localStorage.removeItem(KEYS.returnTo);
      location.href = (rt && rt.href) ? rt.href : 'account.html';
    } catch (err) {
      toast('Google sign-in is not available yet (server endpoint missing).', { important: true });
    }
  }

  function bindGoogleSignInIfPresent() {
    const p = page();
    if (p !== 'login.html' && p !== 'register.html' && p !== 'login' && p !== 'register') return;

    const hasOnload = !!document.getElementById('g_id_onload');
    const hasSignin = !!document.querySelector('.g_id_signin');
    if (!hasOnload && !hasSignin) return;

    window.BSGoogleLoginCallback = async (response) => {
      const credential = response?.credential;
      await handleGoogleCredential(credential);
    };
  }

  // -----------------------------
  // SHOP: RENDER FROM STORE
  // -----------------------------
  function renderProducts(container, products) {
  if (!container) return;

  const list = Array.isArray(products) ? products : [];
  if (!list.length) {
    container.innerHTML = `<div class="muted">No products available.</div>`;
    return;
  }

  container.innerHTML = list.map((p) => {
    const cover = (p?.media?.coverUrl) ? String(p.media.coverUrl) : "";
    const name = String(p?.title || p?.name || "").trim();
    const priceNum = Number(p?.priceJMD ?? 0);
    const price = Number.isFinite(priceNum) ? priceNum.toLocaleString("en-JM") : "0";

    return `
      <div class="product-card" data-product-id="${String(p?.id || "")}">
        <img src="${cover}" alt="${name || "Product"}" />
        <h3>${name}</h3>
        <p class="price">JMD ${price}</p>
      </div>
    `;
  }).join("");
}
  async function renderShopFromStore() {
  const container = document.getElementById("productsGrid");
  if (!container) return;

  container.innerHTML = `<div class="muted">Loading products…</div>`;

  // 1) Try same-origin first (works if you proxy API or serve frontend from same host)
  const sameOriginUrl = "/api/products";

  // 2) Fallback to Railway API (works for static hosting)
  const railwayUrl = "https://bs-api-live.up.railway.app/api/products";

  async function tryFetch(url) {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || data.ok !== true || !Array.isArray(data.products)) {
      throw new Error("Bad response shape");
    }
    return data.products;
  }

  try {
    const products = await tryFetch(sameOriginUrl);
    Products.setAll(products);
    renderProducts(container, products);
    return;
  } catch (e1) {
    // ignore, fallback to Railway
  }

  try {
    const products = await tryFetch(railwayUrl);
    Products.setAll(products);
    renderProducts(container, products);
    return;
  } catch (e2) {
    console.warn("Products fetch failed (same-origin + Railway).", e2);
  }

  // Final fallback to localStorage (so you never show nothing)
  try {
    const raw = localStorage.getItem("bs_products_v1");
    const products = raw ? JSON.parse(raw) : [];
    Products.setAll(products);
    renderProducts(container, products);
  } catch {
    container.innerHTML = `<div class="muted">No products available.</div>`;
  }
}

  function bindAddToCart() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.add-to-cart');
      if (!btn) return;

      const card = btn.closest('.product-card');
      if (!card) return;

      const productId = String(card.getAttribute('data-product-id') || '');
      const product = Products.findById(productId);
      if (!product) {
        toast('This product is unavailable right now.', { important: true });
        return;
      }

      const size = card.querySelector('.product-size-select')?.value || '';
      if (!size) {
        toast('Please select a size before adding to cart.', { important: true });
        return;
      }

      const stockBySize = product.stockBySize || {};
      const base = Number(stockBySize?.[size] ?? 0);

      const inCart = Cart.load().reduce((sum, it) => {
        if (String(it.productId) === String(productId) && String(it.size || '') === String(size)) {
          return sum + Number(it.qty || 0);
        }
        return sum;
      }, 0);

      const remaining = Math.max(0, base - inCart);
      if (remaining <= 0) {
        toast('Not enough stock available for this size.', { important: true });
        return;
      }

      Cart.add(productId, size, 1);
      UI.updateCartBadges();
      toast(`Added to cart: ${product.name}`);

      renderShopFromStore();
    });
  }

  // -----------------------------
  // CART PAGE
  // -----------------------------
  function renderCartIfOnCartPage() {
    if (!page().includes('cart.html')) return;

    const itemsEl = $('#cartItems');
    const emptyEl = $('#cartEmpty');
    const subtotalEl = $('#cartSubtotal');
    const totalEl = $('#cartTotal');

    const legacyContainer = $('.cart-container');

    const items = Cart.load();

    const st = readState();
    const cache = st.productCache || {};

    function resolveProduct(it) {
      const pid = String(it.productId || '');
      const p = Products.findById(pid);

      if (p) {
        return {
          name: p.title || p.name || it.name || 'Item',
          image: (p.media && p.media.coverUrl) ? p.media.coverUrl : (it.image || ''),
          price: Number(p.priceJMD || it.price || 0)
        };
      }

      const c = cache[pid];
      if (c) {
        return {
          name: c.name || it.name || 'Item',
          image: c.image || it.image || '',
          price: Number(c.price || it.price || 0)
        };
      }

      return {
        name: it.name || 'Item',
        image: it.image || '',
        price: Number(it.price || 0)
      };
    }

    function maxAllowedForItem(it) {
      const pid = String(it.productId || '');
      const sz = String(it.size || '');
      if (!sz) return null;

      const p = Products.findById(pid);
      if (!p || !p.stockBySize || typeof p.stockBySize !== 'object') return null;

      const base = Number(p.stockBySize?.[sz] ?? 0);
      if (!Number.isFinite(base)) return null;

      const otherQty = items.reduce((sum, row) => {
        if (row !== it && String(row.productId) === pid && String(row.size || '') === sz) {
          return sum + Number(row.qty || 0);
        }
        return sum;
      }, 0);

      return Math.max(0, base - otherQty);
    }

    if (itemsEl && emptyEl && subtotalEl && totalEl) {
      const isEmpty = items.length === 0;
      emptyEl.hidden = !isEmpty;

      const clearBtn = document.getElementById('clearCartBtn');
      if (clearBtn) {
        clearBtn.hidden = isEmpty;

        if (!clearBtn.dataset.bound) {
          clearBtn.dataset.bound = '1';
          clearBtn.addEventListener('click', () => {
            Cart.clear();
            UI.updateCartBadges();
            renderCartIfOnCartPage();
            toast('Cart cleared.');
          });
        }
      }

      if (isEmpty) {
        itemsEl.innerHTML = '';
        subtotalEl.textContent = money(0);
        totalEl.textContent = money(0);
        return;
      }

      const filled = items.map((it) => {
        const meta = resolveProduct(it);
        return { ...it, ...meta };
      });

      const subtotal = filled.reduce((sum, it) => sum + (Number(it.price || 0) * Number(it.qty || 0)), 0);

      itemsEl.innerHTML = filled.map((it) => `
        <div class="cart-item" data-id="${escapeHtml(it.productId)}" data-size="${escapeHtml(it.size || '')}">
          <img src="${escapeHtml(it.image || '')}" alt="${escapeHtml(it.name || 'Product')}" />
          <div class="cart-item-info">
            <h4>${escapeHtml(it.name || 'Item')}</h4>
            <p class="cart-item-meta">Size: ${escapeHtml(it.size || '')}</p>
            <p class="cart-item-price">${money(Number(it.price || 0) * Number(it.qty || 0))}</p>
          </div>

          <div class="cart-item-qty">
            <input type="number" min="1" ${(() => { const m = maxAllowedForItem(it); return (typeof m === "number" && Number.isFinite(m)) ? `max="${Number(m || 0)}"` : ""; })()} value="${Number(it.qty || 1)}" />
            <button class="remove-from-cart" type="button">Remove</button>
          </div>
        </div>
      `).join('');

      subtotalEl.textContent = money(subtotal);
      totalEl.textContent = money(subtotal);

      itemsEl.addEventListener('change', (e) => {
        const input = e.target.closest('input[type="number"]');
        if (!input) return;

        const row = input.closest('.cart-item');
        if (!row) return;

        const pid = row.getAttribute('data-id');
        const size = row.getAttribute('data-size') || null;
        const q = Math.max(1, Number(input.value || 1));

        const applied = Cart.setQty(pid, size, q);

        if (applied === 0) {
          toast('That size is out of stock. Item removed from cart.', { important: true });
        } else if (typeof applied === 'number' && applied < q) {
          input.value = String(applied);
          toast(`Only ${applied} available for that size.`, { important: true });
        }

        UI.updateCartBadges();
        renderCartIfOnCartPage();
      });

      itemsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.remove-from-cart');
        if (!btn) return;

        const row = btn.closest('.cart-item');
        if (!row) return;

        const pid = row.getAttribute('data-id');
        const size = row.getAttribute('data-size') || null;

        Cart.remove(pid, size);
        UI.updateCartBadges();
        renderCartIfOnCartPage();
      });

      return;
    }

    if (!legacyContainer) return;

    legacyContainer.innerHTML = '';

    if (items.length === 0) {
      legacyContainer.innerHTML = `
        <div class="empty-cart">
          Your cart is empty. <a href="shop-page.html">Shop Now</a>
        </div>
      `;
      return;
    }

    let subtotal = 0;

    items.forEach((it) => {
      const meta = resolveProduct(it);
      const lineTotal = Number(meta.price || 0) * Number(it.qty || 0);
      subtotal += lineTotal;

      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <img src="${escapeHtml(meta.image || '')}" alt="${escapeHtml(meta.name || 'Product')}" class="cart-item-img" />
        <div class="cart-item-info">
          <h4>${escapeHtml(meta.name || 'Item')}</h4>
          <p class="cart-item-meta">Size: ${escapeHtml(it.size || '')}</p>
          <p class="cart-item-price">${money(lineTotal)}</p>
        </div>
        <div class="cart-item-qty">
          <input type="number" min="1" ${(() => { const m = maxAllowedForItem(it); return (typeof m === "number" && Number.isFinite(m)) ? `max="${Number(m || 0)}"` : ""; })()} value="${Number(it.qty || 1)}" />
          <button class="remove-from-cart" type="button">Remove</button>
        </div>
      `;

      const qtyInput = row.querySelector('input[type="number"]');
      const removeBtn = row.querySelector('.remove-from-cart');

      qtyInput.addEventListener('change', () => {
        const q = Math.max(1, Number(qtyInput.value || 1));
        const applied = Cart.setQty(it.productId, it.size || null, q);

        if (applied === 0) {
          toast('That size is out of stock. Item removed from cart.', { important: true });
        } else if (typeof applied === 'number' && applied < q) {
          qtyInput.value = String(applied);
          toast(`Only ${applied} available for that size.`, { important: true });
        }

        UI.updateCartBadges();
        renderCartIfOnCartPage();
      });

      removeBtn.addEventListener('click', () => {
        Cart.remove(it.productId, it.size || null);
        UI.updateCartBadges();
        renderCartIfOnCartPage();
      });

      legacyContainer.appendChild(row);
    });

    const summary = document.createElement('div');
    summary.className = 'cart-summary';
    summary.innerHTML = `
      <p><strong>Subtotal:</strong> ${money(subtotal)}</p>
      <p><strong>Total:</strong> ${money(subtotal)}</p>
      <a href="shop-page.html" class="btn continue-shopping-btn">Continue Shopping</a>
      <a href="checkout.html" class="btn checkout-btn proceed-checkout-btn">Proceed to Checkout</a>
    `;

    legacyContainer.appendChild(summary);
  }

  // -----------------------------
  // AUTH GATE (uses Auth.currentUser() which now prefers server session)
  // -----------------------------
  function gateCheckoutAndOrders() {
    const p = page();
    const needsAuth = (p === 'checkout.html' || p === 'orders.html' || p === 'account.html' || p === 'edit-profile.html');
    if (!needsAuth) return;

    const user = Auth.currentUser();
    if (user) return;

    localStorage.setItem(KEYS.returnTo, JSON.stringify({ href: `${p}` }));
    toast('Please log in to continue.', { important: true });
    location.href = 'login.html';
  }

  // -----------------------------
  // LOGIN / REGISTER FORMS
  // -----------------------------
  function bindLoginForm() {
    if (page() !== 'login.html' && page() !== 'login') return;

    const form = document.querySelector('form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const email = (form.querySelector('input[type="email"]')?.value || '').trim();
      const password = (form.querySelector('input[type="password"]')?.value || '').trim();

      try {
        await Auth.login({ email, password });
        UI.updateNavAuthState();
        UI.updateCartBadges();

        const rt = safeParse(localStorage.getItem(KEYS.returnTo));
        localStorage.removeItem(KEYS.returnTo);
        location.href = (rt && rt.href) ? rt.href : 'account.html';
      } catch (err) {
        toast(err?.message || 'Login failed.', { important: true });
      }
    });
  }

  function bindRegisterForm() {
    if (page() !== 'register.html' && page() !== 'register') return;

    const form = document.querySelector('form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const fullname = (form.querySelector('input[name="fullname"]')?.value || '').trim();
      const email = (form.querySelector('input[type="email"]')?.value || '').trim();

      const password =
        (form.querySelector('input[name="password"], input#password, input[type="password"]')?.value || '').trim();

      const confirmPassword =
        (form.querySelector(
          'input[name="confirmPassword"], input[name="confirm_password"], input[name="confirm"], input#confirmPassword, input#confirm_password'
        )?.value || '').trim();

      try {
        await Auth.register({ fullname, email, password, confirmPassword });
        UI.updateNavAuthState();
        UI.updateCartBadges();
        toast('Account created.');
        location.href = 'account.html';
      } catch (err) {
        toast(err?.message || 'Registration failed.', { important: true });
      }
    });
  }

  // -----------------------------
  // FORGOT PASSWORD / RESET PASSWORD / EDIT PROFILE (unchanged)
  // -----------------------------
  function bindForgotPasswordForm() {
    if (page() !== 'forgot-password.html' && page() !== 'forgot-password') return;

    const form = document.getElementById('forgotPasswordForm');
    if (!form) return;

    const emailInput = document.getElementById('fpEmail');
    const codeWrap = document.getElementById('fpCodeWrap');
    const codeEl = document.getElementById('fpResetCode');
    const copyBtn = document.getElementById('fpCopyCodeBtn');

    if (form.dataset.bound) return;
    form.dataset.bound = '1';

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const email = String(emailInput?.value || '').trim();

      try {
        const { code } = Auth.requestPasswordReset(email);

        if (codeEl) codeEl.textContent = String(code);
        if (codeWrap) codeWrap.hidden = false;

        toast('Reset code generated (demo).');
      } catch (err) {
        toast(err?.message || 'Could not generate reset code.', { important: true });
      }
    });

    if (copyBtn && !copyBtn.dataset.bound) {
      copyBtn.dataset.bound = '1';
      copyBtn.addEventListener('click', async () => {
        try {
          const txt = String(codeEl?.textContent || '').trim();
          if (!txt) throw new Error('No code to copy.');
          await navigator.clipboard.writeText(txt);
          toast('Code copied.');
        } catch (err) {
          toast('Could not copy code.', { important: true });
        }
      });
    }
  }

  function bindResetPasswordForm() {
    if (page() !== 'reset-password.html' && page() !== 'reset-password') return;

    const form = document.getElementById('resetPasswordForm');
    if (!form) return;

    const emailInput = document.getElementById('rpEmail');
    const codeInput = document.getElementById('rpCode');
    const newPwInput = document.getElementById('rpNewPassword');
    const confirmPwInput = document.getElementById('rpConfirmNewPassword');

    if (form.dataset.bound) return;
    form.dataset.bound = '1';

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      try {
        const email = String(emailInput?.value || '').trim();
        const code = String(codeInput?.value || '').trim();
        const newPassword = String(newPwInput?.value || '').trim();
        const confirm = String(confirmPwInput?.value || '').trim();

        if (!email) throw new Error('Please enter your email.');
        if (!code) throw new Error('Please enter your reset code.');
        if (!newPassword) throw new Error('Please enter a new password.');
        if (newPassword !== confirm) throw new Error('New passwords do not match.');

        Auth.resetPassword({ email, code, newPassword });

        toast('Password reset successfully. Please log in.');
        location.href = 'login.html';
      } catch (err) {
        toast(err?.message || 'Could not reset password.', { important: true });
      }
    });
  }

  function bindEditProfileForm() {
    if (page() !== 'edit-profile.html' && page() !== 'edit-profile') return;

    const user = Auth.currentUser();
    if (!user) {
      localStorage.setItem(KEYS.returnTo, JSON.stringify({ href: 'edit-profile.html' }));
      toast('Please log in to continue.', { important: true });
      location.href = 'login.html';
      return;
    }

    const form = document.getElementById('editProfileForm');
    if (!form) return;

    const nameInput = document.getElementById('epName');
    const emailInput = document.getElementById('epEmail');
    const currentPwInput = document.getElementById('epCurrentPassword');
    const newPwInput = document.getElementById('epNewPassword');
    const confirmPwInput = document.getElementById('epConfirmNewPassword');
    const cancelBtn = document.getElementById('epCancelBtn');

    if (emailInput) emailInput.value = user.email || '';
    if (nameInput) nameInput.value = user.name || '';

    if (cancelBtn && !cancelBtn.dataset.bound) {
      cancelBtn.dataset.bound = '1';
      cancelBtn.addEventListener('click', () => {
        location.href = 'account.html';
      });
    }

    if (form.dataset.bound) return;
    form.dataset.bound = '1';

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      try {
        const name = String(nameInput?.value || '').trim();
        const currentPassword = String(currentPwInput?.value || '').trim();
        const newPassword = String(newPwInput?.value || '').trim();
        const confirmNewPassword = String(confirmPwInput?.value || '').trim();

        if (!name) throw new Error('Please enter your display name.');
        if (!currentPassword) throw new Error('Please enter your current password.');

        const wantsPwChange = (newPassword !== '' || confirmNewPassword !== '');
        if (wantsPwChange) {
          if (!newPassword) throw new Error('Please enter a new password.');
          if (newPassword !== confirmNewPassword) throw new Error('New passwords do not match.');
        }

        Auth.updateProfile({
          name,
          currentPassword,
          newPassword: wantsPwChange ? newPassword : null
        });

        UI.updateNavAuthState();
        toast('Profile updated successfully.');
        location.href = 'account.html';
      } catch (err) {
        toast(err?.message || 'Could not update profile.', { important: true });
      }
    });
  }

  // -----------------------------
  // LOGOUT + ACCOUNT
  // -----------------------------
  function bindLogoutLinks() {
    document.addEventListener('click', async (e) => {
      const a = e.target.closest('a[href="logout.html"]');
      if (!a) return;
      e.preventDefault();

      await Auth.logout();
      UI.updateNavAuthState();
      UI.updateCartBadges();
      toast('Logged out.');
      location.href = 'index.html';
    });
  }

  function renderAccountIfOnAccountPage() {
    if (page() !== 'account.html' && page() !== 'account') return;

    const user = Auth.currentUser();
    const nameEl = $('#accountName');
    const emailEl = $('#accountEmail');
    const sinceEl = $('#accountSince');

    if (nameEl) nameEl.textContent = user?.name || '';
    if (emailEl) emailEl.textContent = user?.email || '';
    if (sinceEl) sinceEl.textContent = formatMemberSince(user?.createdAt);
  }

  // -----------------------------
  // ORDERS PAGE
  // -----------------------------
  async function renderOrdersIfOnOrdersPage() {
    if (page() !== 'orders.html' && page() !== 'orders') return;

    const user = Auth.currentUser();
    const listEl = $('#ordersList');
    if (!listEl) return;

    if (!user || !user.email) {
      listEl.innerHTML = `<p class="muted">Please log in to view your orders.</p>`;
      return;
    }

    const fmtDate = (iso) => {
      const d = iso ? new Date(iso) : null;
      if (!d || !Number.isFinite(d.getTime())) return '—';
      return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });
    };

    const safe = (s) => escapeHtml(String(s || ''));

    const renderList = (orders) => {
      if (!Array.isArray(orders) || !orders.length) {
        listEl.innerHTML = `
          <div class="order-card">
            <div class="order-row">
              <strong>No orders yet</strong>
              <span class="muted">Once you check out, your orders will appear here.</span>
            </div>
            <div class="order-row">
              <a class="btn btn-primary" href="shop-page.html">Go shopping</a>
            </div>
          </div>
        `;
        return;
      }

      const sorted = orders.slice().sort((a, b) => {
        const ta = new Date(a?.createdAt || 0).getTime();
        const tb = new Date(b?.createdAt || 0).getTime();
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      });

      listEl.innerHTML = sorted.map(o => {
        const id = safe(o.id);
        const status = safe(o.status || 'Placed');
        const total = money(o.totalJMD || 0);
        const date = safe(fmtDate(o.createdAt));

        return `
          <div class="order-card">
            <div class="order-row">
              <strong>Order #</strong> <span>${id}</span>
            </div>
            <div class="order-row">
              <strong>Date</strong> <span>${date}</span>
            </div>
            <div class="order-row">
              <strong>Status</strong> <span>${status}</span>
            </div>
            <div class="order-row">
              <strong>Total</strong> <span>${total}</span>
            </div>
            <div class="order-row">
              <a class="btn btn-ghost" href="receipt.html?order=${encodeURIComponent(o.id || '')}">View receipt</a>
            </div>
          </div>
        `;
      }).join('');
    };

    // --- PRODUCTION: try backend first ---
    try {
      const res = await fetch('/api/orders/me', { credentials: 'include' });
      const data = await res.json().catch(() => null);

      if (!res.ok) throw new Error(data?.error || 'Could not load orders.');

      const orders = Array.isArray(data) ? data : (Array.isArray(data?.orders) ? data.orders : []);
      renderList(orders);
      return;
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      const canFallback =
        msg.includes('failed to fetch') ||
        msg.includes('networkerror') ||
        msg.includes('not found') ||
        msg.includes('unexpected token');

      if (!canFallback) {
        listEl.innerHTML = `<p class="muted">${escapeHtml(err?.message || 'Could not load orders.')}</p>`;
        return;
      }
    }

    // --- DEMO FALLBACK ---
    const st = readState();
    const orders = Array.isArray(st.ordersByUser?.[user.email]) ? st.ordersByUser[user.email] : [];
    renderList(orders);
  }

  // -----------------------------
  // CHECKOUT PAGE (DEMO + server order create)
  // -----------------------------
  function renderCheckoutIfOnCheckoutPage() {
    if (page() !== 'checkout.html' && page() !== 'checkout') return;

    const main = document.querySelector('main');
    if (!main) return;

    const items = Cart.load();
    const st = readState();
    const cache = st.productCache || {};

    function resolveProduct(it) {
      const pid = String(it.productId || '');
      const p = Products.findById(pid);
      if (p) {
        return {
          name: p.title || p.name || it.name || 'Item',
          image: (p.media && p.media.coverUrl) ? p.media.coverUrl : (it.image || ''),
          price: Number(p.priceJMD || it.price || 0)
        };
      }
      const c = cache[pid];
      if (c) {
        return {
          name: c.name || it.name || 'Item',
          image: c.image || it.image || '',
          price: Number(c.price || it.price || 0)
        };
      }
      return {
        name: it.name || 'Item',
        image: it.image || '',
        price: Number(it.price || 0)
      };
    }

    const emptyWrap = $('#checkoutEmpty');
    const wrap = $('#checkoutWrap');

    if (!items.length) {
      if (emptyWrap) emptyWrap.hidden = false;
      if (wrap) wrap.hidden = true;
      return;
    }

    if (emptyWrap) emptyWrap.hidden = true;
    if (wrap) wrap.hidden = false;

    const filled = items.map(it => ({ ...it, ...resolveProduct(it) }));
    const subtotal = filled.reduce((sum, it) => sum + (Number(it.price || 0) * Number(it.qty || 0)), 0);

    const listEl = $('#checkoutItems');
    const subtotalEl = $('#checkoutSubtotal');
    const totalEl = $('#checkoutTotal');
    const btn = $('#placeOrderBtn');

    if (listEl) {
      listEl.innerHTML = filled.map(it => `
        <div class="checkout-item">
          <img src="${escapeHtml(it.image || '')}" alt="${escapeHtml(it.name || 'Product')}" />
          <div class="checkout-item-info">
            <div class="checkout-item-title">${escapeHtml(it.name || 'Item')}</div>
            <div class="checkout-item-meta">Size: ${escapeHtml(it.size || '')} • Qty: ${Number(it.qty || 0)}</div>
          </div>
          <div class="checkout-item-price">${money(Number(it.price || 0) * Number(it.qty || 0))}</div>
        </div>
      `).join('');
    }

    if (subtotalEl) subtotalEl.textContent = money(subtotal);
    if (totalEl) totalEl.textContent = money(subtotal);

    if (btn) {
      btn.onclick = async () => {
        const user = Auth.currentUser();
        if (!user) {
          toast('Please log in to continue.', { important: true });
          localStorage.setItem(KEYS.returnTo, JSON.stringify({ href: 'checkout.html' }));
          location.href = 'login.html';
          return;
        }

        const orderItemsResolved = filled.map(it => ({
          productId: String(it.productId),
          size: String(it.size || ''),
          qty: Number(it.qty || 0),
          name: String(it.name || 'Item'),
          price: Number(it.price || 0),
          image: String(it.image || '')
        }));

        try {
          const payload = {
            items: orderItemsResolved.map(it => ({
              productId: it.productId,
              size: it.size,
              qty: it.qty
            }))
          };

          const res = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            credentials: 'include'
          });

          const data = await res.json().catch(() => null);

          if (!res.ok) {
            throw new Error(data?.error || 'Could not place order.');
          }

          const orderId = String(data?.orderId || data?.order?.id || '').trim();
          if (!orderId) throw new Error('Order placed but missing order id from server.');

          Cart.clear();
          UI.updateCartBadges();
          toast('Order placed.');
          location.href = `receipt.html?order=${encodeURIComponent(orderId)}`;
          return;
        } catch (err) {
          const msg = String(err?.message || '');
          const canFallback =
            msg.toLowerCase().includes('failed to fetch') ||
            msg.toLowerCase().includes('networkerror') ||
            msg.toLowerCase().includes('not found') ||
            msg.toLowerCase().includes('unexpected token');

          if (!canFallback) {
            toast(msg || 'Could not place order.', { important: true });
            return;
          }
        }

        // --- DEMO FALLBACK ---
        const now = nowISO();
        const orderId = uid('ord_');
        const totalJMD = Number(subtotal || 0);

        const order = {
          id: orderId,
          createdAt: now,
          status: 'Placed',
          history: [{ at: now, by: 'System', from: '—', to: 'Placed' }],
          totalJMD,
          items: orderItemsResolved
        };

        const st2 = readState();
        const em = String(user.email || '').trim().toLowerCase();
        st2.ordersByUser[em] = Array.isArray(st2.ordersByUser[em]) ? st2.ordersByUser[em] : [];
        st2.ordersByUser[em].unshift(order);
        writeState(st2);

        Cart.clear();
        UI.updateCartBadges();
        toast('Order placed (demo).');
        location.href = `receipt.html?order=${encodeURIComponent(orderId)}`;
      };
    }
  }

  async function renderReceiptIfOnReceiptPage() {
    if (page() !== 'receipt.html' && page() !== 'receipt') return;

    const user = Auth.currentUser();
    if (!user || !user.email) {
      location.href = 'login.html';
      return;
    }

    const params = new URLSearchParams(location.search);
    const orderId = String(params.get('order') || '').trim();

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value == null ? '' : value);
    };

    const fmtDate = (iso) => {
      const d = iso ? new Date(iso) : null;
      if (!d || !Number.isFinite(d.getTime())) return '—';
      return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });
    };

    const renderOrder = (order) => {
      if (!order) {
        setText('rcptOrderId', '—');
        setText('rcptOrderDate', '—');
        setText('rcptOrderStatus', '—');
        const itemsEl = document.getElementById('rcptItems');
        if (itemsEl) itemsEl.innerHTML = `<tr><td colspan="5" class="muted">Receipt not found.</td></tr>`;
        return;
      }

      setText('rcptOrderId', `#${order.id || ''}`);
      setText('rcptOrderDate', fmtDate(order.createdAt));
      setText('rcptOrderStatus', order.status || 'Placed');
      setText('rcptCustomer', user.name ? `${user.name} (${user.email})` : user.email);

      const items = Array.isArray(order.items) ? order.items : [];
      setText('rcptItemCount', items.reduce((sum, it) => sum + Number(it?.qty || 0), 0));
      setText('rcptTotal', money(order.totalJMD || 0));

      const tbody = document.getElementById('rcptItems');
      if (tbody) {
        if (!items.length) {
          tbody.innerHTML = `<tr><td colspan="5" class="muted">No items found for this order.</td></tr>`;
        } else {
          tbody.innerHTML = items.map(it => {
            const nm = escapeHtml(it?.name || 'Item');
            const sz = escapeHtml(it?.size || '—');
            const qty = Number(it?.qty || 0);
            const price = Number(it?.price || 0);
            const line = price * qty;

            return `
              <tr>
                <td>${nm}</td>
                <td>${sz}</td>
                <td class="right">${qty}</td>
                <td class="right">${escapeHtml(money(price))}</td>
                <td class="right">${escapeHtml(money(line))}</td>
              </tr>
            `;
          }).join('');
        }
      }
    };

    try {
      if (!orderId) throw new Error('Missing order id.');

      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, { credentials: 'include' });
      const data = await res.json().catch(() => null);

      if (!res.ok) throw new Error(data?.error || 'Could not load receipt.');

      const order = data?.order ? data.order : data;
      renderOrder(order);
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      const canFallback =
        msg.includes('failed to fetch') ||
        msg.includes('networkerror') ||
        msg.includes('not found') ||
        msg.includes('unexpected token');

      if (!canFallback) {
        renderOrder(null);
        toast(err?.message || 'Could not load receipt.', { important: true });
        return;
      }

      const st = readState();
      const orders = Array.isArray(st.ordersByUser?.[user.email]) ? st.ordersByUser[user.email] : [];
      const order = orders.find(o => String(o?.id || '') === orderId) || null;
      renderOrder(order);
    }

    const printBtn = document.getElementById('printReceiptBtn');
    if (printBtn && !printBtn.dataset.bound) {
      printBtn.dataset.bound = '1';
      printBtn.addEventListener('click', () => window.print());
    }
  }

  // -----------------------------
  // DEV-ONLY: PROMOTE USER TO ADMIN (SERVER + DEMO)
  // -----------------------------
  async function promoteToAdmin({ email, secret }) {
    const em = String(email || '').trim().toLowerCase();
    const sec = String(secret || '').trim();
    if (!em) throw new Error('promoteToAdmin: email is required.');
    if (!sec) throw new Error('promoteToAdmin: secret is required.');

    const { ok, status, data } = await apiJson('/api/dev/make-admin', {
      method: 'POST',
      body: { email: em, secret: sec }
    });

    if (!ok) {
      throw new Error(data?.error || `Failed to promote (${status})`);
    }

    await Auth.bootstrap();
    UI.updateNavAuthState();
    return data;
  }

  // (kept) DEMO local promotion
  function makeAdmin(email) {
    const em = String(email || '').trim().toLowerCase();
    if (!em) throw new Error('makeAdmin(email): email is required.');

    const users = readUsers();
    const u = users[em];
    if (!u) throw new Error('makeAdmin(email): no user found with that email.');

    u.email = u.email || em;
    u.createdAt = u.createdAt || nowISO();
    u.role = 'admin';

    users[em] = u;
    writeUsers(users);

    return true;
  }

  // -----------------------------
  // INIT
  // -----------------------------
  async function init() {
    UI.ensureHeaderFooter();

    // IMPORTANT: hydrate from server cookie session FIRST
    await Auth.bootstrap();

    UI.updateNavAuthState();
    UI.updateCartBadges();
    UI.bindLoginDropdown();
    UI.bindNavActive();

    gateCheckoutAndOrders();

    bindGoogleSignInIfPresent();

    renderShopFromStore();
    bindAddToCart();

    renderCartIfOnCartPage();
    renderCheckoutIfOnCheckoutPage();

    bindLoginForm();
    bindRegisterForm();
    bindForgotPasswordForm();
    bindResetPasswordForm();
    bindEditProfileForm();
    bindLogoutLinks();

    renderAccountIfOnAccountPage();
    renderOrdersIfOnOrdersPage();

    renderReceiptIfOnReceiptPage();
  }

  document.addEventListener('DOMContentLoaded', () => { init(); });

  // Expose tiny API (debug / future admin)
  BS.Auth = Auth;
  BS.Cart = Cart;
  BS.Products = Products;
  BS.Orders = Orders;

  // Expose DEV-only admin promotion
  BS.makeAdmin = makeAdmin;
  BS.promoteToAdmin = promoteToAdmin;

})();