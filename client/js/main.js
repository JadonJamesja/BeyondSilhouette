/**
 * Beyond Silhouette — main.js (FULL SITE)
 * Single JS file for ALL pages in the BeyondSilhouette-main.zip
 *
 * Supports:
 * - Products (from shop-page.html .product-card data attributes)
 * - Size selection enforcement
 * - Cart: persistent, renders on cart.html into .cart-container
 * - Auth: local demo (login/register/forgot) using your exact form structure
 * - Checkout: requires login, injects checkout UI into checkout.html
 * - Orders: saves receipts locally and renders dynamic orders on orders.html
 * - Header/footer placeholders (#site-header/#site-footer) get populated if empty
 * - Logout link (logout.html) intercepted since file doesn't exist
 *
 * IMPORTANT:
 * - This is a LOCAL/DEMO client-side auth/cart/orders system.
 * - Server-side placeholders are included and commented for Node + DB later.
 */

(() => {
  'use strict';

  // -----------------------------
  // THEME (SYNC WITH ADMIN)
  // -----------------------------
  const THEME_KEY = 'bs_admin_theme'; // shared with admin side

  function getSavedTheme() {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'dark' || t === 'light') return t;

    // fallback to OS preference
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(THEME_KEY, t);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || getSavedTheme();
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  // Apply theme ASAP (before DOMContentLoaded work)
  applyTheme(getSavedTheme());

  // Sync theme if changed in another tab (or admin open elsewhere)
  window.addEventListener('storage', (e) => {
    if (e.key !== THEME_KEY) return;
    applyTheme(getSavedTheme());
  });

  // Delegated theme button support:
  // - <button class="theme-toggle">Theme</button>
  // - OR anything with data-action="toggle-theme"
  document.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('[data-action="toggle-theme"], .theme-toggle');
    if (!btn) return;
    e.preventDefault();
    toggleTheme();
  });

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

  // -----------------------------
  // TOAST (VISIBLE + FALLBACK)
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
      if (!u) throw new Error('No account exists for that email.');
      if (u.passwordHash !== demoHash(password)) throw new Error('Incorrect password.');

      writeSession({ email: em, token: uid('sess_'), createdAt: nowISO(), provider: 'local' });
      Cart.mergeGuestIntoUser(em);
      return u;
    },

    logout() {
      clearSession();
      UI.updateNavAuthState();
      UI.updateCartBadges();
      toast('Logged out');
    }
  };

  // -----------------------------
  // PRODUCT CACHE
  // -----------------------------
  const ProductCache = {
    upsert(product) {
      if (!product || !product.id) return;
      const st = readState();
      st.productCache[String(product.id)] = {
        id: String(product.id),
        name: product.name || '',
        price: Number(product.price || 0),
        image: product.image || ''
      };
      writeState(st);
    },

    fillCartItem(item) {
      const st = readState();
      const p = st.productCache[String(item.productId)];
      if (!p) return item;

      return {
        ...item,
        name: (item.name && item.name !== 'Unknown') ? item.name : (p.name || item.name),
        price: (item.price != null && !Number.isNaN(Number(item.price))) ? Number(item.price) : Number(p.price || 0),
        image: item.image ? item.image : (p.image || '')
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

      items = items.map((it) => ProductCache.fillCartItem({
        productId: String(it.productId ?? it.id ?? ''),
        name: it.name ?? it.title ?? 'Unknown',
        price: Number(it.price ?? 0),
        qty: Number(it.qty ?? it.quantity ?? 1),
        size: it.size ?? null,
        image: it.image ?? ''
      })).filter(it => it.productId);

      st.cartByUser[key] = { items, updatedAt: nowISO() };
      writeState(st);

      return items;
    },

    save(items) {
      const st = readState();
      const key = this.userKey();
      st.cartByUser[key] = { items: items || [], updatedAt: nowISO() };
      writeState(st);
      UI.updateCartBadges();
    },

    totalQty(items) {
      return (items || []).reduce((s, it) => s + Number(it.qty || 0), 0);
    },

    subtotal(items) {
      return (items || []).reduce((s, it) => s + Number(it.price || 0) * Number(it.qty || 0), 0);
    },

    add({ productId, name, price, image, size, qty = 1 }) {
      const items = this.load();
      const id = String(productId);
      const sz = size || null;

      const idx = items.findIndex(x => x.productId === id && (x.size || null) === (sz || null));
      if (idx >= 0) items[idx].qty += Number(qty || 1);
      else items.push({
        productId: id,
        name: name || 'Unknown',
        price: Number(price || 0),
        qty: Number(qty || 1),
        size: sz,
        image: image || ''
      });

      this.save(items);
      return items;
    },

    setQty(productId, size, qty) {
      const items = this.load();
      const id = String(productId);
      const sz = size || null;
      const q = Number(qty || 0);

      for (const it of items) {
        if (it.productId === id && (it.size || null) === (sz || null)) {
          it.qty = q;
        }
      }

      const cleaned = items.filter(it => Number(it.qty || 0) > 0);
      this.save(cleaned);
      return cleaned;
    },

    remove(productId, size) {
      const id = String(productId);
      const sz = size || null;
      const items = this.load().filter(it => !(it.productId === id && (it.size || null) === (sz || null)));
      this.save(items);
      return items;
    },

    clear() {
      this.save([]);
      return [];
    },

    mergeGuestIntoUser(userEmail) {
      const st = readState();
      st.cartByUser = st.cartByUser || {};

      const guest = (st.cartByUser[USER_GUEST] && Array.isArray(st.cartByUser[USER_GUEST].items))
        ? st.cartByUser[USER_GUEST].items : [];

      const user = (st.cartByUser[userEmail] && Array.isArray(st.cartByUser[userEmail].items))
        ? st.cartByUser[userEmail].items : [];

      const map = new Map();
      [...user, ...guest].forEach((it) => {
        const key = `${String(it.productId)}__${it.size || ''}`;
        const existing = map.get(key);
        if (existing) existing.qty += Number(it.qty || 0);
        else {
          map.set(key, {
            productId: String(it.productId),
            name: it.name || 'Unknown',
            price: Number(it.price || 0),
            qty: Number(it.qty || 1),
            size: it.size || null,
            image: it.image || ''
          });
        }
      });

      st.cartByUser[userEmail] = { items: Array.from(map.values()), updatedAt: nowISO() };
      delete st.cartByUser[USER_GUEST];
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
  // UI HELPERS
  // -----------------------------
  const UI = {
    updateCartBadges() {
      const items = Cart.load();
      const total = Cart.totalQty(items);
      $$('.cart-count').forEach(el => { el.textContent = String(total); });
    },

    updateNavAuthState() {
      const user = Auth.currentUser();

      const allLoginLinks = $$('a[href="login.html"]');
      const allRegisterLinks = $$('a[href="register.html"], a[href="CreateAccount.html"], a[href="create-account.html"]');
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
      const header = $('#site-header');
      const footer = $('#site-footer');

      if (header && header.childElementCount === 0) {
        header.innerHTML = `
          <nav id="main-nav">
            <h1><a href="./index.html" style="text-decoration:none;color:inherit;">Beyond Silhouette</a></h1>
            <ul>
              <li><a class="nav-link" href="About.html">About</a></li>
              <li><a class="nav-link" href="shop-page.html">Shop</a></li>
              <li><a class="nav-link" href="orders.html">Orders</a></li>
              <li><a class="nav-link" href="cart.html">Cart (<span class="cart-count">0</span>)</a></li>
            </ul>
            <div class="nav-right">
              <button class="theme-toggle" type="button" data-action="toggle-theme">Theme</button>
              <div class="login-dropdown">
                <a class="loginIcon" href="#"><img src="./images/user icon.png" alt="Login"/></a>
                <ul class="login-menu">
                  <li><a href="login.html">Sign In</a></li>
                  <li><a href="register.html">Create Account</a></li>
                  <li><a href="orders.html">My Orders</a></li>
                  <li><a href="account.html">Account</a></li>
                  <li><a href="logout.html">Logout</a></li>
                </ul>
              </div>
            </div>
          </nav>
        `;
      }

      if (footer && footer.childElementCount === 0) {
        footer.innerHTML = `<p>&copy; ${new Date().getFullYear()} Beyond Silhouette</p>`;
      }
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

      const card = btn.closest('.product-card');
      if (!card) {
        toast('Could not add item (product card not found).', { important: true });
        return;
      }

      const productId = card.dataset.id;
      const name = card.dataset.name;
      const price = Number(card.dataset.price || 0);
      const stock = Number(card.dataset.stock || card.dataset.qty || 0);

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

      if (stock > 0) {
        const existing = Cart.load().find(it => it.productId === String(productId) && (it.size || null) === (size || null));
        const existingQty = existing ? Number(existing.qty || 0) : 0;
        if (existingQty + 1 > stock) {
          toast('Not enough stock available for this item.', { important: true });
          return;
        }
      }

      Cart.add({ productId, name, price, image, size: size || null, qty: 1 });

      toast(`Added to cart: ${name}`);
      renderCartIfOnCartPage();
    });
  }

  function renderCartIfOnCartPage() {
    if (!page().includes('cart.html')) return;
    renderCartPage();
  }

  function renderCartPage() {
    const container = $('.cart-container');
    if (!container) return;

    const items = Cart.load();
    container.innerHTML = '';

    if (items.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Your cart is empty.';
      container.appendChild(p);
      return;
    }

    const subtotal = Cart.subtotal(items);

    const list = document.createElement('div');
    list.className = 'cart-items';

    items.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'cart-item';

      const img = document.createElement('img');
      img.className = 'cart-item-img';
      img.src = it.image || '';
      img.alt = it.name || 'Product';

      const info = document.createElement('div');
      info.className = 'cart-item-info';

      const title = document.createElement('h4');
      title.textContent = it.name || 'Unknown';

      const meta = document.createElement('p');
      meta.className = 'cart-item-meta';
      meta.textContent = it.size ? `Size: ${it.size}` : '';

      const price = document.createElement('p');
      price.className = 'cart-item-price';
      price.textContent = money(it.price);

      const qtyWrap = document.createElement('div');
      qtyWrap.className = 'cart-item-qty';

      const qty = document.createElement('input');
      qty.type = 'number';
      qty.min = '0';
      qty.value = String(it.qty);

      qty.addEventListener('change', () => {
        Cart.setQty(it.productId, it.size || null, Number(qty.value || 0));
        renderCartPage();
        UI.updateCartBadges();
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-from-cart';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        Cart.remove(it.productId, it.size || null);
        renderCartPage();
        UI.updateCartBadges();
      });

      qtyWrap.appendChild(qty);
      qtyWrap.appendChild(removeBtn);

      info.appendChild(title);
      info.appendChild(meta);
      info.appendChild(price);
      info.appendChild(qtyWrap);

      row.appendChild(img);
      row.appendChild(info);
      list.appendChild(row);
    });

    container.appendChild(list);

    const summary = document.createElement('div');
    summary.className = 'cart-summary';
    summary.innerHTML = `
      <hr/>
      <p><strong>Subtotal:</strong> ${money(subtotal)}</p>
      <button class="btn proceed-checkout-btn">Proceed to Checkout</button>
      <button class="btn clear-cart-btn" style="margin-left:10px;">Clear Cart</button>
    `;
    container.appendChild(summary);

    summary.querySelector('.clear-cart-btn').addEventListener('click', () => {
      Cart.clear();
      renderCartPage();
      UI.updateCartBadges();
      toast('Cart cleared');
    });

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
    const form = $('.login-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);

      const email = fd.get('email');
      const password = fd.get('password');

      try {
        Auth.login({ email, password });
        toast('Logged in');

        UI.updateNavAuthState();
        UI.updateCartBadges();

        const ret = safeParse(localStorage.getItem(KEYS.returnTo));
        if (ret && ret.href) {
          localStorage.removeItem(KEYS.returnTo);
          location.href = ret.href;
        } else {
          location.href = 'account.html';
        }
      } catch (err) {
        toast(err.message || 'Login failed', { important: true });
      }
    });
  }

  function bindRegisterForm() {
    const form = $('.register-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);

      const fullname = fd.get('fullname');
      const email = fd.get('email');
      const password = fd.get('password');
      const confirmPassword = fd.get('confirm-password');

      try {
        Auth.register({ fullname, email, password, confirmPassword });
        toast('Account created');

        UI.updateNavAuthState();
        UI.updateCartBadges();

        const ret = safeParse(localStorage.getItem(KEYS.returnTo));
        if (ret && ret.href) {
          localStorage.removeItem(KEYS.returnTo);
          location.href = ret.href;
        } else {
          location.href = 'account.html';
        }
      } catch (err) {
        toast(err.message || 'Registration failed', { important: true });
      }
    });
  }

  function bindForgotForm() {
    const form = $('.forgot-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      toast('Password reset will be implemented in the backend phase.', { important: true });
    });
  }

  function renderAccountPage() {
    if (!page().includes('account.html')) return;

    const user = Auth.currentUser();
    if (!user) {
      localStorage.setItem(KEYS.returnTo, JSON.stringify({ href: 'account.html' }));
      location.href = 'login.html';
      return;
    }

    const details = $('.account-details');
    if (!details) return;

    details.innerHTML = `
      <h2>Profile Information</h2>
      <p><strong>Name:</strong> ${escapeHtml(user.name || '')}</p>
      <p><strong>Email:</strong> ${escapeHtml(user.email || '')}</p>
      <p><strong>Member Since:</strong> ${formatMemberSince(user.createdAt)}</p>
      <a class="btn" href="orders.html">View Orders</a>
      <a class="btn" href="cart.html" style="margin-left:10px;">View Cart</a>
    `;
  }

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

  function renderCheckoutPage() {
    if (!page().includes('checkout.html')) return;

    const user = Auth.currentUser();
    if (!user) {
      localStorage.setItem(KEYS.returnTo, JSON.stringify({ href: 'checkout.html' }));
      location.href = 'login.html';
      return;
    }

    const items = Cart.load();
    const subtotal = Cart.subtotal(items);

    const main = $('main') || document.body;
    main.innerHTML = `
      <main class="checkout-container" style="padding:20px;">
        <h1>Checkout</h1>
        <div class="checkout-content" style="display:grid;gap:16px;grid-template-columns:1fr;max-width:900px;">
          <section class="checkout-summary" style="border:1px solid #ddd;border-radius:12px;padding:14px;">
            <h2>Order Summary</h2>
            <div class="checkout-items"></div>
            <hr/>
            <p><strong>Subtotal:</strong> <span class="checkout-subtotal">${money(subtotal)}</span></p>
          </section>

          <section class="checkout-payment" style="border:1px solid #ddd;border-radius:12px;padding:14px;">
            <h2>Payment Method</h2>
            <label style="display:block;margin-bottom:8px;">
              <select class="payment-method" style="width:100%;padding:10px;">
                <option value="card">Card (Online)</option>
                <option value="cash">Cash</option>
                <option value="paypal">PayPal</option>
                <option value="cashapp">CashApp</option>
              </select>
            </label>

            <div class="payment-note" style="font-size:14px;opacity:.85;margin-top:8px;">
              Payment processing will be connected when the Node + DB backend is added.
              For now this simulates an order locally.
            </div>

            <button class="btn place-order-btn" style="margin-top:14px;">Place Order</button>
          </section>
        </div>
      </main>
    `;

    const itemsWrap = $('.checkout-items');
    if (itemsWrap) {
      if (items.length === 0) {
        itemsWrap.innerHTML = `<p>Your cart is empty.</p><a class="btn" href="shop-page.html">Shop Now</a>`;
        $('.place-order-btn')?.setAttribute('disabled', 'disabled');
      } else {
        itemsWrap.innerHTML = items.map(it => `
          <div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;">
            <div>
              <strong>${escapeHtml(it.name || 'Unknown')}</strong>
              ${it.size ? `<span style="opacity:.8;"> (Size ${escapeHtml(it.size)})</span>` : ''}
              <div style="opacity:.8;font-size:13px;">Qty: ${it.qty}</div>
            </div>
            <div><strong>${money(Number(it.price) * Number(it.qty))}</strong></div>
          </div>
        `).join('');
      }
    }

    $('.place-order-btn')?.addEventListener('click', async () => {
      const itemsNow = Cart.load();
      if (itemsNow.length === 0) {
        toast('Cart is empty.', { important: true });
        return;
      }

      const pm = $('.payment-method')?.value || 'card';

      toast('Placing order...');
      await new Promise(r => setTimeout(r, 700));

      const order = {
        id: uid('order_').toUpperCase(),
        createdAt: nowISO(),
        userEmail: user.email,
        items: itemsNow,
        subtotal: Cart.subtotal(itemsNow),
        paymentMethod: pm,
        status: 'Processing'
      };

      Orders.addFor(user.email, order);
      Cart.clear();
      UI.updateCartBadges();

      toast(`Order placed! Ref: ${order.id}`, { important: true });
      location.href = 'orders.html';
    });
  }

  function renderOrdersPage() {
    if (!page().includes('orders.html')) return;

    const user = Auth.currentUser();
    const container = $('.orders-container');
    if (!container) return;

    if (!user) {
      localStorage.setItem(KEYS.returnTo, JSON.stringify({ href: 'orders.html' }));
      location.href = 'login.html';
      return;
    }

    const orders = Orders.listFor(user.email);

    if (orders.length === 0) {
      container.innerHTML = `
        <h1>My Orders</h1>
        <div class="no-orders">
          <p>You don’t have any orders yet. <a href="shop-page.html">Start shopping</a></p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <h1>My Orders</h1>
      ${orders.map(o => `
        <div class="order-card">
          <div class="order-header">
            <h2>Order ${escapeHtml(o.id)}</h2>
            <p><strong>Date:</strong> ${new Date(o.createdAt).toLocaleDateString()}</p>
          </div>
          <div class="order-body">
            <p><strong>Status:</strong> <span class="status shipped">${escapeHtml(o.status)}</span></p>
            <p><strong>Total:</strong> ${money(o.subtotal)}</p>
            <p><strong>Payment:</strong> ${escapeHtml(o.paymentMethod)}</p>
            <p><strong>Items:</strong></p>
            <ul>
              ${o.items.map(it => `<li>${escapeHtml(it.name || 'Unknown')} ${it.size ? `- Size ${escapeHtml(it.size)}` : ''} (x${it.qty})</li>`).join('')}
            </ul>
          </div>
        </div>
      `).join('')}
    `;
  }

  // -----------------------------
  // INIT
  // -----------------------------
  function init() {
    UI.ensureHeaderFooter();
    UI.bindNavActive();
    UI.bindLoginDropdown();
    bindLogoutIntercept();

    bindAddToCart();

    bindLoginForm();
    bindRegisterForm();
    bindForgotForm();

    UI.updateNavAuthState();
    UI.updateCartBadges();

    renderCartIfOnCartPage();
    renderCheckoutPage();
    renderOrdersPage();
    renderAccountPage();

    BS.toast = toast;
    BS.cart = {
      items: () => Cart.load(),
      clear: () => Cart.clear(),
      add: (p) => Cart.add(p)
    };
    BS.auth = {
      user: () => Auth.currentUser(),
      logout: () => Auth.logout()
    };

    console.log('✅ Beyond Silhouette main.js initialized');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
