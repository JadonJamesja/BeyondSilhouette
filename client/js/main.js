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
      UI.updateNavAuthState();
      UI.updateCartBadges();
    }
  };

  // -----------------------------
  // PRODUCT CACHE (for cart images/names)
  // -----------------------------
  const ProductCache = {
    load() {
      const st = readState();
      return st.productCache || {};
    },

    save(cache) {
      const st = readState();
      st.productCache = cache || {};
      writeState(st);
    },

    upsert({ id, name, price, image }) {
      if (!id) return;
      const cache = this.load();
      cache[String(id)] = {
        id: String(id),
        name: String(name || ''),
        price: Number(price || 0),
        image: String(image || ''),
        updatedAt: nowISO()
      };
      this.save(cache);
    },

    fillCartItem(it) {
      const cache = this.load();
      const c = cache[String(it.productId)];
      if (!c) return it;
      return {
        ...it,
        name: it.name || c.name,
        price: it.price || c.price,
        image: it.image || c.image
      };
    }
  };

  // -----------------------------
  // CART
  // -----------------------------
  const Cart = {
    userKey() {
      const sess = readSession();
      return (sess && sess.email) ? sess.email : USER_GUEST;
    },

    load() {
      const st = readState();
      const key = this.userKey();
      const raw = st.cartByUser[key];
      let items = (raw && Array.isArray(raw.items)) ? raw.items : [];
      items = items.map(it => ProductCache.fillCartItem(it));
      return items;
    },

    save(items) {
      const st = readState();
      const key = this.userKey();
      st.cartByUser[key] = { items: Array.isArray(items) ? items : [] };
      writeState(st);
    },

    clear() {
      this.save([]);
    },

    totalQty(items) {
      return (items || []).reduce((s, it) => s + Number(it.qty || 0), 0);
    },

    subtotal(items) {
      return (items || []).reduce((s, it) => s + (Number(it.price || 0) * Number(it.qty || 0)), 0);
    },

    add({ productId, name, price, image, size = null, qty = 1 }) {
      const items = this.load();
      const id = String(productId);

      const idx = items.findIndex(it => String(it.productId) === id && (it.size || null) === (size || null));
      if (idx >= 0) {
        items[idx].qty = Number(items[idx].qty || 0) + Number(qty || 1);
      } else {
        items.push({
          productId: id,
          name: String(name || 'Unknown'),
          price: Number(price || 0),
          image: String(image || ''),
          size: size ? String(size) : null,
          qty: Number(qty || 1)
        });
      }
      this.save(items);
      UI.updateCartBadges();
    },

    remove(productId, size = null) {
      const items = this.load().filter(it => !(String(it.productId) === String(productId) && (it.size || null) === (size || null)));
      this.save(items);
      UI.updateCartBadges();
      return items;
    },

    setQty(productId, size, qty) {
      const items = this.load();
      const id = String(productId);
      const q = Math.max(1, Number(qty || 1));

      const idx = items.findIndex(it => String(it.productId) === id && (it.size || null) === (size || null));
      if (idx >= 0) items[idx].qty = q;

      this.save(items);
      UI.updateCartBadges();
      return items;
    },

    mergeGuestIntoUser(email) {
      const st = readState();
      const guest = st.cartByUser[USER_GUEST]?.items || [];
      const user = st.cartByUser[email]?.items || [];

      if (!guest.length) return;

      const merged = [...user];
      guest.forEach(g => {
        const idx = merged.findIndex(it => String(it.productId) === String(g.productId) && (it.size || null) === (g.size || null));
        if (idx >= 0) merged[idx].qty = Number(merged[idx].qty || 0) + Number(g.qty || 0);
        else merged.push(g);
      });

      st.cartByUser[email] = { items: merged };
      st.cartByUser[USER_GUEST] = { items: [] };
      writeState(st);
    }
  };

  // -----------------------------
  // ORDERS
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
    if (!page().includes('shop-page.html')) return;

    const grid = document.getElementById('productsGrid');
    const status = document.getElementById('shopStatus');
    if (!grid) return;

    const store = window.BSProducts;
    if (!store || typeof store.listPublished !== 'function') {
      if (status) status.textContent = '';
      return;
    }

    const products = store.listPublished();
    if (status) status.textContent = products.length ? '' : 'No products available yet.';

    // Build a quick lookup of how many of each product+size are already in the cart.
    // This lets the shop reflect remaining stock immediately after adding to cart.
    const cartItems = Cart.load();
    const cartQtyByKey = new Map();
    for (const it of cartItems) {
      const pid = String(it.productId || '');
      const sz = it.size ? String(it.size) : '__nosize__';
      const key = `${pid}::${sz}`;
      cartQtyByKey.set(key, (cartQtyByKey.get(key) || 0) + Number(it.qty || 0));
    }

    grid.innerHTML = products.map((p, idx) => {
      const baseStockBySize = (p.stockBySize && typeof p.stockBySize === 'object') ? p.stockBySize : {};

      // Remaining stock per size = base - qty already in cart for that size
      const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ['S', 'M', 'L', 'XL'];
      const remainingBySize = {};
      sizes.forEach((s) => {
        const base = Number(baseStockBySize?.[s] ?? 0);
        const inCart = Number(cartQtyByKey.get(`${String(p.id)}::${String(s)}`) || 0);
        remainingBySize[s] = Math.max(0, base - inCart);
      });

      const totalRemaining = Object.values(remainingBySize).reduce((sum, n) => sum + Number(n || 0), 0);

      const imageUrl = (p.media && p.media.coverUrl) ? p.media.coverUrl : '';
      const sizeSelectId = `size-${p.id}-${idx}`;

      const stockLine = totalRemaining > 0
        ? `<p class="stock">In Stock: <span class="stock-count">${Number(totalRemaining || 0)}</span></p>`
        : `<p class="stock stock-soon"><span class="stock-count">New stock coming soon.</span></p>`;

      return `
        <div class="product-card"
          data-id="${escapeHtml(p.id)}"
          data-name="${escapeHtml(p.title)}"
          data-price="${Number(p.priceJMD || 0)}"
          data-stock="${Number(totalRemaining || 0)}"
          ${imageUrl ? `data-image="${escapeHtml(imageUrl)}"` : ''}
        >
          <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(p.title)}" />
          <h3>${escapeHtml(p.title)}</h3>
          <p class="price">J$${Number(p.priceJMD || 0).toLocaleString('en-JM')}</p>

          <label for="${sizeSelectId}" class="size-label">Size:</label>
          <select id="${sizeSelectId}" class="product-size-select" ${totalRemaining <= 0 ? 'disabled' : ''}>
            <option value="" selected disabled>Select</option>
            ${sizes.map(s => {
              const left = remainingBySize?.[s] ?? 0;
              const disabled = Number(left) <= 0 ? 'disabled' : '';
              const suffix = Number(left) <= 0 ? ' (Sold out)' : ` (${Number(left)})`;
              return `<option value="${s}" ${disabled}>${s}${suffix}</option>`;
            }).join('')}
          </select>

          ${stockLine}

          <button class="btn add-to-cart" ${totalRemaining <= 0 ? 'disabled aria-disabled="true"' : ''}>
            ${totalRemaining > 0 ? 'Add to Cart' : 'Unavailable'}
          </button>
        </div>
      `;
    }).join('');
  }

  function remainingStockFor(productId, size) {
    const store = window.BSProducts;
    if (!store || typeof store.readAll !== 'function') return 0;

    const pid = String(productId || '');
    const sz = String(size || '');

    const product = (store.readAll() || []).find(p => String(p?.id) === pid);
    if (!product) return 0;

    const base = Number(product.stockBySize?.[sz] ?? 0);
    const inCart = Cart.load().reduce((sum, it) => {
      if (String(it.productId) === pid && String(it.size || '') === sz) return sum + Number(it.qty || 0);
      return sum;
    }, 0);

    return Math.max(0, base - inCart);
  }

  // -----------------------------
  // PAGE-SPECIFIC LOGIC
  // -----------------------------
  function bindLogoutIntercept() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href="logout.html"]');
      if (!a) return;
      e.preventDefault();
      Auth.logout();
      location.href = 'index.html';
    });
  }

  function bindAddToCart() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.add-to-cart');
      if (!btn) return;

      if (btn.hasAttribute('disabled')) {
        toast('New stock coming soon.', { important: true });
        return;
      }

      const card = btn.closest('.product-card');
      if (!card) {
        toast('Could not add item (product card not found).', { important: true });
        return;
      }

      const productId = card.dataset.id;
      const name = card.dataset.name;
      const price = Number(card.dataset.price || 0);

      let image = card.dataset.image || '';
      if (!image) {
        const imgEl = card.querySelector('img');
        if (imgEl && imgEl.getAttribute('src')) image = imgEl.getAttribute('src');
      }

      const sizeSelect = card.querySelector('.product-size-select');
      const size = sizeSelect ? String(sizeSelect.value || '').trim() : '';

      if (sizeSelect && (!size || size.toLowerCase().includes('select'))) {
        toast('Please select a size before adding to cart.', { important: true });
        return;
      }

      if (!productId || !name) {
        toast('Missing product details (data-id / data-name).', { important: true });
        return;
      }

      ProductCache.upsert({ id: productId, name, price, image });

      // Enforce size-level stock (stockBySize) and reflect cart usage
      const remaining = size ? remainingStockFor(productId, size) : 0;
      if (!size || size.toLowerCase().includes('select')) {
        toast('Please select a size before adding to cart.', { important: true });
        return;
      }

      if (remaining <= 0) {
        toast('Not enough stock available for this size.', { important: true });
        return;
      }

      Cart.add({ productId, name, price, image, size: size || null, qty: 1 });

      toast(`Added to cart: ${name}`);
      renderCartIfOnCartPage();

      // Refresh the shop UI so the stock count updates immediately.
      renderShopFromStore();
    });
  }

  function renderCartIfOnCartPage() {
    if (!page().includes('cart.html')) return;

    const container = $('.cart-container');
    if (!container) return;

    const items = Cart.load();

    container.innerHTML = '';

    if (items.length === 0) {
      container.innerHTML = `
        <div class="empty-cart">
          Your cart is empty. <a href="shop-page.html">Shop Now</a>
        </div>
      `;
      return;
    }

    items.forEach(it => {
      const row = document.createElement('div');
      row.className = 'cart-item';

      row.innerHTML = `
        <img class="cart-item-img" src="${escapeHtml(it.image || '')}" alt="${escapeHtml(it.name || 'Product')}" />
        <div class="cart-item-info">
          <h4>${escapeHtml(it.name || 'Unknown')}</h4>
          <p class="cart-item-meta">${it.size ? `Size: ${escapeHtml(it.size)} • ` : ''}Item</p>
          <div class="cart-item-price">${money(Number(it.price || 0))}</div>
        </div>
        <div class="cart-item-qty">
          <input type="number" min="1" value="${Number(it.qty || 1)}" />
          <button class="remove-from-cart" type="button">Remove</button>
        </div>
      `;

      const qtyInput = row.querySelector('input[type="number"]');
      const removeBtn = row.querySelector('.remove-from-cart');

      qtyInput.addEventListener('change', () => {
        const q = Math.max(1, Number(qtyInput.value || 1));
        Cart.setQty(it.productId, it.size || null, q);
        renderCartIfOnCartPage();
      });

      removeBtn.addEventListener('click', () => {
        Cart.remove(it.productId, it.size || null);
        renderCartIfOnCartPage();
      });

      container.appendChild(row);
    });

    const summary = document.createElement('div');
    summary.className = 'cart-summary';
    summary.innerHTML = `
      <hr/>
      <div><strong>Subtotal:</strong> ${money(Cart.subtotal(items))}</div>
      <button class="btn proceed-checkout-btn" type="button">Proceed to Checkout</button>
    `;
    container.appendChild(summary);

    summary.querySelector('.proceed-checkout-btn').addEventListener('click', () => {
      const user = Auth.currentUser();
      if (!user) {
        localStorage.setItem(KEYS.returnTo, JSON.stringify({ href: 'checkout.html' }));
        toast('Please log in to checkout.', { important: true });
        location.href = 'login.html';
        return;
      }
      location.href = 'checkout.html';
    });
  }

  function bindLoginForm() {
    if (!page().includes('login.html')) return;
    const form = document.querySelector('form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = form.querySelector('input[type="email"]')?.value;
      const password = form.querySelector('input[type="password"]')?.value;

      try {
        Auth.login({ email, password });
        UI.updateNavAuthState();
        UI.updateCartBadges();

        const rt = safeParse(localStorage.getItem(KEYS.returnTo));
        localStorage.removeItem(KEYS.returnTo);
        location.href = rt?.href || 'index.html';
      } catch (err) {
        toast(err.message || 'Login failed.', { important: true });
      }
    });
  }

  function bindRegisterForm() {
    if (!page().includes('register.html')) return;
    const form = document.querySelector('form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fullname = form.querySelector('input[name="fullname"], input[type="text"]')?.value;
      const email = form.querySelector('input[type="email"]')?.value;
      const password = form.querySelector('input[name="password"], input[type="password"]')?.value;
      const confirmPassword = form.querySelector('input[name="confirmPassword"]')?.value;

      try {
        Auth.register({ fullname, email, password, confirmPassword });
        UI.updateNavAuthState();
        UI.updateCartBadges();

        const rt = safeParse(localStorage.getItem(KEYS.returnTo));
        localStorage.removeItem(KEYS.returnTo);
        location.href = rt?.href || 'index.html';
      } catch (err) {
        toast(err.message || 'Registration failed.', { important: true });
      }
    });
  }

  function renderAccountPage() {
    if (!page().includes('account.html')) return;
    const u = Auth.currentUser();
    if (!u) {
      localStorage.setItem(KEYS.returnTo, JSON.stringify({ href: 'account.html' }));
      toast('Please log in to view your account.', { important: true });
      location.href = 'login.html';
      return;
    }

    const nameEl = $('#accountName');
    const emailEl = $('#accountEmail');
    const sinceEl = $('#accountSince');

    if (nameEl) nameEl.textContent = u.name || '';
    if (emailEl) emailEl.textContent = u.email || '';
    if (sinceEl) sinceEl.textContent = formatMemberSince(u.createdAt);
  }

  function renderOrdersPage() {
    if (!page().includes('orders.html')) return;
    const u = Auth.currentUser();
    if (!u) {
      localStorage.setItem(KEYS.returnTo, JSON.stringify({ href: 'orders.html' }));
      toast('Please log in to view your orders.', { important: true });
      location.href = 'login.html';
      return;
    }

    const list = $('#ordersList');
    if (!list) return;

    const orders = Orders.listFor(u.email);

    if (!orders.length) {
      list.innerHTML = `<p style="opacity:.8;">No orders yet.</p>`;
      return;
    }

    list.innerHTML = orders.map(o => {
      const items = Array.isArray(o.items) ? o.items : [];
      const lines = items.map(it => {
        const title = escapeHtml(it.name || 'Item');
        const size = it.size ? ` (Size: ${escapeHtml(it.size)})` : '';
        const qty = Number(it.qty || 0);
        return `<li>${title}${size} × ${qty}</li>`;
      }).join('');

      return `
        <div class="order-card">
          <div class="order-head">
            <strong>Order #${escapeHtml(o.id || '')}</strong>
            <span>${new Date(o.createdAt).toLocaleString()}</span>
          </div>
          <ul class="order-items">${lines}</ul>
          <div class="order-total"><strong>Total:</strong> ${money(Number(o.total || 0))}</div>
        </div>
      `;
    }).join('');
  }

  function renderCheckoutPage() {
    if (!page().includes('checkout.html')) return;

    const user = Auth.currentUser();
    if (!user) {
      localStorage.setItem(KEYS.returnTo, JSON.stringify({ href: 'checkout.html' }));
      toast('Please log in to checkout.', { important: true });
      location.href = 'login.html';
      return;
    }

    const itemsEl = $('#checkoutItems');
    const subtotalEl = $('#checkoutSubtotal');
    const totalEl = $('#checkoutTotal');
    const emptyEl = $('#checkoutEmpty');
    const placeBtn = $('#placeOrderBtn');
    const paySel = $('#paymentMethod');

    if (!itemsEl || !subtotalEl || !totalEl || !emptyEl || !placeBtn) return;

    const items = Cart.load();
    const subtotal = Cart.subtotal(items);

    const isEmpty = items.length === 0;
    emptyEl.hidden = !isEmpty;
    placeBtn.disabled = isEmpty;

    if (isEmpty) {
      itemsEl.innerHTML = '';
      subtotalEl.textContent = money(0);
      totalEl.textContent = money(0);
      return;
    }

    itemsEl.innerHTML = items.map(it => `
      <div class="checkout-item">
        <img src="${escapeHtml(it.image || '')}" alt="${escapeHtml(it.name || 'Product')}" />
        <div class="ci-info">
          <div class="ci-title">${escapeHtml(it.name || 'Item')}</div>
          <div class="ci-meta">${it.size ? `Size: ${escapeHtml(it.size)} • ` : ''}Qty: ${Number(it.qty || 0)}</div>
        </div>
        <div class="ci-price">${money(Number(it.price || 0) * Number(it.qty || 0))}</div>
      </div>
    `).join('');

    subtotalEl.textContent = money(subtotal);
    totalEl.textContent = money(subtotal);

    placeBtn.addEventListener('click', () => {
      const method = paySel ? String(paySel.value || 'cash') : 'cash';
      const order = {
        id: uid('ord_'),
        createdAt: nowISO(),
        paymentMethod: method,
        items: items.map(it => ({ ...it })),
        subtotal,
        total: subtotal
      };

      Orders.addFor(user.email, order);
      Cart.clear();
      UI.updateCartBadges();
      toast('Order placed successfully!');
      renderCheckoutPage();
    }, { once: true });
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

    bindLogoutIntercept();
    bindAddToCart();

    renderShopFromStore();
    renderCartIfOnCartPage();
    bindLoginForm();
    bindRegisterForm();
    renderAccountPage();
    renderOrdersPage();
    renderCheckoutPage();
  }

  document.addEventListener('DOMContentLoaded', init);

})();
