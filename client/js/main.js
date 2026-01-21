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
    returnTo: 'bs_return_to_v1'    // { href }
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
      try { alert(msg); } catch (_) {}
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
  // AUTH (LOCAL DEMO)
  // -----------------------------
  const Auth = {
    currentUser() {
      const sess = readSession();
      if (!sess || !sess.email) return null;
      const users = readUsers();
      return users[sess.email] || null;
    },

    register({ fullname, email, password, confirmPassword }) {
      const em = String(email || '').trim().toLowerCase();
      if (!fullname || !em || !password) throw new Error('Please fill in all required fields.');
      if (confirmPassword != null && String(password) !== String(confirmPassword)) {
        throw new Error('Passwords do not match.');
      }

      const users = readUsers();
      if (users[em]) throw new Error('An account already exists for this email.');

      users[em] = {
        email: em,
        name: String(fullname),
        passwordHash: demoHash(password),
        createdAt: nowISO(),
        role: 'customer'
      };

      writeUsers(users);
      writeSession({ email: em, token: uid('sess_'), createdAt: nowISO(), provider: 'local' });

      Cart.mergeGuestIntoUser(em);
      return users[em];
    },

    login({ email, password }) {
      const em = String(email || '').trim().toLowerCase();
      const users = readUsers();
      const u = users[em];

      if (!u) throw new Error('No account found for this email.');
      if (u.passwordHash !== demoHash(password)) throw new Error('Incorrect password.');

      writeSession({ email: em, token: uid('sess_'), createdAt: nowISO(), provider: 'local' });
      Cart.mergeGuestIntoUser(em);
      return u;
    },

    logout() {
      clearSession();
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

      // If we can resolve stock for this size, clamp adds to available stock.
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

      // Fallback: no stock info available, allow add.
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

      // If we can resolve stock for this size, enforce per-size limits.
      if (base !== null && Number.isFinite(base)) {
        const otherQty = items.reduce((sum, row) => {
          if (row !== it && String(row.productId) === pid && String(row.size || '') === sz) {
            return sum + Number(row.qty || 0);
          }
          return sum;
        }, 0);

        const maxAllowed = Math.max(0, base - otherQty);

        if (maxAllowed <= 0) {
          // No stock available for this size => remove line from cart.
          const nextItems = items.filter(row => row !== it);
          this.save(nextItems);
          return 0;
        }

        const applied = Math.min(maxAllowed, desired);
        it.qty = applied;
        this.save(items);
        return applied;
      }

      // Fallback: no stock info available, allow.
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
  // PRODUCTS STORE ADAPTER
  // -----------------------------
  const Products = {
    readAll() {
      if (window.BSProducts && typeof window.BSProducts.readAll === 'function') {
        return window.BSProducts.readAll();
      }
      return [];
    },

    listPublished() {
      if (window.BSProducts && typeof window.BSProducts.listPublished === 'function') {
        return window.BSProducts.listPublished();
      }
      return this.readAll().filter(p => p?.isPublished);
    },

    findById(id) {
      const pid = String(id || '');
      return this.readAll().find(p => String(p?.id) === pid) || null;
    }
  };

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
  // SHOP: RENDER FROM STORE
  // -----------------------------
  function renderShopFromStore() {
    if (page() !== 'shop-page.html' && page() !== 'shop-page') return;

    const grid = $('#productsGrid');
    if (!grid) return;

    const products = Products.listPublished();
    const cartItems = Cart.load();
    const cartQtyByKey = new Map();
    cartItems.forEach(it => {
      const key = `${String(it.productId)}::${String(it.size || '')}`;
      cartQtyByKey.set(key, (cartQtyByKey.get(key) || 0) + Number(it.qty || 0));
    });

    grid.innerHTML = products.map((p, idx) => {
      const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ['S', 'M', 'L', 'XL'];
      const baseStockBySize = (p.stockBySize && typeof p.stockBySize === 'object') ? p.stockBySize : {};

      const remainingBySize = {};
      sizes.forEach(s => {
        const base = Number(baseStockBySize?.[s] ?? 0);
        const inCart = Number(cartQtyByKey.get(`${String(p.id)}::${String(s)}`) || 0);
        remainingBySize[s] = Math.max(0, base - inCart);
      });

      const totalRemaining = Object.values(remainingBySize).reduce((sum, n) => sum + Number(n || 0), 0);
      const cover = p.media?.coverUrl || '';
      const sizeSelectId = `size-${p.id}-${idx}`;

      const sizeOptions = sizes.map(s => {
        const r = Number(remainingBySize[s] || 0);
        const disabled = r <= 0 ? 'disabled' : '';
        const label = r <= 0 ? `${escapeHtml(s)} (Out)` : escapeHtml(s);
        return `<option value="${escapeHtml(s)}" ${disabled}>${label}</option>`;
      }).join('');

      const stockLine = totalRemaining > 0
        ? `<p class="stock">In Stock: <span class="stock-count">${Number(totalRemaining || 0)}</span></p>`
        : `<p class="stock">New stock coming soon.</p>`;

      return `
        <div class="product-card" data-product-id="${escapeHtml(p.id)}">
          <img src="${escapeHtml(cover)}" alt="${escapeHtml(p.name || 'Product')}" />
          <h3>${escapeHtml(p.name || '')}</h3>
          <p class="price">${money(p.priceJMD || 0)}</p>

          <div class="row">
            <select id="${escapeHtml(sizeSelectId)}" class="product-size-select" ${totalRemaining <= 0 ? 'disabled' : ''}>
              <option value="">Select size</option>
              ${sizeOptions}
            </select>
          </div>

          <button class="btn add-to-cart" ${totalRemaining <= 0 ? 'disabled aria-disabled="true"' : ''}>
            Add to Cart
          </button>

          ${stockLine}
        </div>
      `;
    }).join('');
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

      // re-render so stock counts update live
      renderShopFromStore();
    });
  }

  // -----------------------------
  // CART PAGE (supports current IDs and legacy markup)
  // -----------------------------
  function renderCartIfOnCartPage() {
    if (!page().includes('cart.html')) return;

    // Preferred (current) cart DOM targets
    const itemsEl = $('#cartItems');
    const emptyEl = $('#cartEmpty');
    const subtotalEl = $('#cartSubtotal');
    const totalEl = $('#cartTotal');

    // Legacy fallback (older markup)
    const legacyContainer = $('.cart-container');

    const items = Cart.load();

    // Helper: resolve product details without guessing
    const st = readState();
    const cache = st.productCache || {};

    function resolveProduct(it) {
      const pid = String(it.productId || '');
      const p = Products.findById(pid);

      // Prefer products store
      if (p) {
        return {
          name: p.name || it.name || 'Item',
          image: (p.media && p.media.coverUrl) ? p.media.coverUrl : (it.image || ''),
          price: Number(p.priceJMD || it.price || 0)
        };
      }

      // Fallback: cached product info (older flows)
      const c = cache[pid];
      if (c) {
        return {
          name: c.name || it.name || 'Item',
          image: c.image || it.image || '',
          price: Number(c.price || it.price || 0)
        };
      }

      // Last resort: whatever is stored on the cart item
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

    // -----------------------------
    // CURRENT MARKUP PATH
    // -----------------------------
    if (itemsEl && emptyEl && subtotalEl && totalEl) {
      const isEmpty = items.length === 0;
      emptyEl.hidden = !isEmpty;

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

      // Bind qty/remove (event delegation)
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
      }, { once: true });

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
      }, { once: true });

      return;
    }

    // -----------------------------
    // LEGACY FALLBACK PATH
    // -----------------------------
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
  // AUTH GATE (LOCAL DEMO)
  // -----------------------------
  function gateCheckoutAndOrders() {
    const p = page();
    const needsAuth = (p === 'checkout.html' || p === 'orders.html' || p === 'account.html');
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

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const email = form.querySelector('input[type="email"]')?.value || '';
      const password = form.querySelector('input[type="password"]')?.value || '';

      try {
        Auth.login({ email, password });
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

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const fullname = form.querySelector('input[name="fullname"]')?.value || '';
      const email = form.querySelector('input[type="email"]')?.value || '';
      const password = form.querySelector('#password')?.value || '';
      const confirmPassword = form.querySelector('#confirmPassword')?.value || '';

      try {
        Auth.register({ fullname, email, password, confirmPassword });
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
  // LOGOUT + ACCOUNT
  // -----------------------------
  function bindLogoutLinks() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href="logout.html"]');
      if (!a) return;
      e.preventDefault();
      Auth.logout();
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
  function renderOrdersIfOnOrdersPage() {
    if (page() !== 'orders.html' && page() !== 'orders') return;

    const user = Auth.currentUser();
    const listEl = $('#ordersList');
    if (!user || !listEl) return;

    const st = readState();
    const orders = st.ordersByUser?.[user.email] || [];

    if (!orders.length) {
      listEl.innerHTML = `<p class="muted">No orders yet.</p>`;
      return;
    }

    listEl.innerHTML = orders.map(o => `
      <div class="order-card">
        <div class="order-row">
          <strong>Order #</strong> <span>${escapeHtml(o.id || '')}</span>
        </div>
        <div class="order-row">
          <strong>Date</strong> <span>${escapeHtml(o.createdAt || '')}</span>
        </div>
        <div class="order-row">
          <strong>Total</strong> <span>${money(o.totalJMD || 0)}</span>
        </div>
      </div>
    `).join('');
  }

  // -----------------------------
  // CHECKOUT PAGE (DEMO)
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
          name: p.name || it.name || 'Item',
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
      btn.onclick = () => {
        const user = Auth.currentUser();
        if (!user) {
          toast('Please log in to continue.', { important: true });
          localStorage.setItem(KEYS.returnTo, JSON.stringify({ href: 'checkout.html' }));
          location.href = 'login.html';
          return;
        }

        const order = {
          id: uid('ord_'),
          createdAt: nowISO(),
          items: filled.map(it => ({
            productId: it.productId,
            size: it.size || '',
            qty: Number(it.qty || 0),
            name: it.name || '',
            price: Number(it.price || 0)
          })),
          totalJMD: subtotal
        };

        const st2 = readState();
        st2.ordersByUser[user.email] = st2.ordersByUser[user.email] || [];
        st2.ordersByUser[user.email].unshift(order);
        writeState(st2);

        Cart.clear();
        UI.updateCartBadges();
        toast('Order placed (demo).');
        location.href = 'orders.html';
      };
    }
  }

  // -----------------------------
  // INIT
  // -----------------------------
  function init() {
    UI.ensureHeaderFooter();
    UI.updateNavAuthState();
    UI.updateCartBadges();
    UI.bindLoginDropdown();
    UI.bindNavActive();

    gateCheckoutAndOrders();

    renderShopFromStore();
    bindAddToCart();

    renderCartIfOnCartPage();
    renderCheckoutIfOnCheckoutPage();

    bindLoginForm();
    bindRegisterForm();
    bindLogoutLinks();

    renderAccountIfOnAccountPage();
    renderOrdersIfOnOrdersPage();
  }

  document.addEventListener('DOMContentLoaded', init);

  // Expose tiny API (debug / future admin)
  BS.Auth = Auth;
  BS.Cart = Cart;
  BS.Products = Products;
})();
