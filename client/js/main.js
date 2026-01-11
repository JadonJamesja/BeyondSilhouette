/**
 * Beyond Silhouette — main.js (FULL SITE)
 * - Shop renders from Products Store (window.BSProducts)
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
  window.BS = window.BS || {};

  // -----------------------------
  // KEYS / STORAGE
  // -----------------------------
  const KEYS = {
    state: 'bs_state_v1',          // { cartByUser, productCache, ordersByUser, soldBySize }
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
  const page = () => (location.pathname.split('/').pop() || '').toLowerCase();

  const money = (n) => `J$${Number(n || 0).toFixed(2)}`;
  const nowISO = () => new Date().toISOString();
  const uid = (p = '') => p + Math.random().toString(36).slice(2) + Date.now().toString(36);

  function safeParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  function escapeHtml(str) {
    return String(str || '')
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
    const s = document.createElement('style');
    s.id = 'bs-toast-style';
    s.textContent = `
      .bs-toast {
        position: fixed;
        z-index: 9999;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        background: rgba(0,0,0,.85);
        color: #fff;
        padding: 10px 14px;
        border-radius: 10px;
        font-size: 14px;
        max-width: 90vw;
        box-shadow: 0 10px 22px rgba(0,0,0,.25);
        opacity: 0;
        pointer-events: none;
        transition: opacity .15s ease, transform .15s ease;
      }
      .bs-toast.show {
        opacity: 1;
        transform: translateX(-50%) translateY(-4px);
      }
    `;
    document.head.appendChild(s);
  }

  function toast(message, opts = {}) {
    ensureToastStyles();
    const t = document.createElement('div');
    t.className = 'bs-toast';
    t.textContent = message || '';
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    const ms = opts.important ? 1800 : 1200;
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 250);
    }, ms);
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
    st.soldBySize = st.soldBySize || {};
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

  function hashPassword(pw) {
    const s = String(pw || '');
    // simple local demo hash (NOT for production)
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
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
      if (users[em]) throw new Error('An account with that email already exists.');

      const user = {
        email: em,
        name: String(fullname || '').trim(),
        passwordHash: hashPassword(password),
        createdAt: nowISO(),
        role: 'customer'
      };

      users[em] = user;
      writeUsers(users);

      writeSession({ email: em, token: uid('tok_'), createdAt: nowISO(), provider: 'local' });
      return user;
    },

    login({ email, password }) {
      const em = String(email || '').trim().toLowerCase();
      if (!em || !password) throw new Error('Please enter your email and password.');

      const users = readUsers();
      const user = users[em];
      if (!user) throw new Error('No account found for that email.');
      if (user.passwordHash !== hashPassword(password)) throw new Error('Incorrect password.');

      writeSession({ email: em, token: uid('tok_'), createdAt: nowISO(), provider: 'local' });
      return user;
    },

    logout() {
      clearSession();
    }
  };

  // -----------------------------
  // PRODUCT CACHE (fill cart items from store)
  // -----------------------------
  const ProductCache = {
    cacheFromStore() {
      const st = readState();
      const store = window.BSProducts;
      if (!store || typeof store.readAll !== 'function') return;

      (store.readAll() || []).forEach(p => {
        if (!p || !p.id) return;
        st.productCache[p.id] = {
          id: p.id,
          name: p.name || '',
          image: (p.media && p.media.coverUrl) ? p.media.coverUrl : '',
          price: Number(p.priceJMD || 0),
          sizes: Array.isArray(p.sizes) ? p.sizes : []
        };
      });

      writeState(st);
    },

    get(id) {
      const st = readState();
      return st.productCache[id] || null;
    },

    fillCartItem(item) {
      if (!item) return item;
      const id = item.id || item.productId;
      const cached = id ? this.get(id) : null;
      if (!cached) return item;

      return {
        ...item,
        productId: item.productId || cached.id,
        name: item.name || cached.name,
        image: item.image || cached.image,
        price: Number(item.price || cached.price || 0),
      };
    }
  };

  // -----------------------------
  // CART (local, per user)
  // -----------------------------
  const Cart = {
    userKey() {
      const u = Auth.currentUser();
      return u?.email || USER_GUEST;
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

    add(item) {
      const items = this.load();
      const idx = items.findIndex(x => (x.productId === item.productId) && (String(x.size || '') === String(item.size || '')));
      if (idx >= 0) {
        items[idx].qty = Number(items[idx].qty || 0) + Number(item.qty || 1);
      } else {
        items.push({ ...item, qty: Number(item.qty || 1) });
      }
      this.save(items);
    },

    remove(productId, size) {
      const items = this.load().filter(x => !(x.productId === productId && String(x.size || '') === String(size || '')));
      this.save(items);
    },

    setQty(productId, size, qty) {
      const items = this.load();
      const it = items.find(x => x.productId === productId && String(x.size || '') === String(size || ''));
      if (!it) return;
      it.qty = Math.max(1, Number(qty || 1));
      this.save(items);
    },

    subtotal(items) {
      return (items || []).reduce((sum, it) => sum + (Number(it.price || 0) * Number(it.qty || 0)), 0);
    }
  };

  // -----------------------------
  // ORDERS (local, per user)
  // -----------------------------
  const Orders = {
    _key(email) {
      return String(email || '').trim().toLowerCase();
    },

    listFor(email) {
      const st = readState();
      const key = this._key(email);
      const arr = st.ordersByUser[key] || [];
      return Array.isArray(arr) ? arr : [];
    },

    addFor(email, order) {
      const st = readState();
      const key = this._key(email);
      st.ordersByUser[key] = st.ordersByUser[key] || [];
      st.ordersByUser[key].unshift(order);
      writeState(st);
    }
  };

  // -----------------------------
  // STOCK HELPERS (includes SOLD ledger)
  // -----------------------------
  function remainingStockFor(productId, size) {
    const store = window.BSProducts;
    if (!store || typeof store.readAll !== 'function') return 0;

    const pid = String(productId || '');
    const sz = String(size || '');

    const product = (store.readAll() || []).find(p => String(p?.id) === pid);
    if (!product) return 0;

    const base = Number(product.stockBySize?.[sz] ?? 0);
    const st = readState();
    const sold = Number(st.soldBySize?.[pid]?.[sz] ?? 0);

    const inCart = Cart.load().reduce((sum, it) => {
      if (String(it.productId) === pid && String(it.size || '') === sz) return sum + Number(it.qty || 0);
      return sum;
    }, 0);

    return Math.max(0, base - sold - inCart);
  }

  // -----------------------------
  // PAGE-SPECIFIC LOGIC
  // -----------------------------
  function bindLogoutIntercept() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('.logout-link');
      if (!link) return;
      e.preventDefault();
      Auth.logout();
      toast('Logged out.');
      location.href = 'index.html';
    });
  }

  // -----------------------------
  // SHOP PAGE
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

    // Keep cache fresh for cart fill
    ProductCache.cacheFromStore();

    // Create a quick lookup of how many of each product+size are already in cart
    const cartItems = Cart.load();
    const cartQtyByKey = new Map();
    for (const it of cartItems) {
      const pid = String(it.productId || '');
      const sz = it.size ? String(it.size) : '__nosize__';
      const key = `${pid}::${sz}`;
      cartQtyByKey.set(key, (cartQtyByKey.get(key) || 0) + Number(it.qty || 0));
    }

    const soldBySize = readState().soldBySize || {};

    grid.innerHTML = products.map((p, idx) => {
      const baseStockBySize = (p.stockBySize && typeof p.stockBySize === 'object') ? p.stockBySize : {};
      const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ['S', 'M', 'L', 'XL'];

      const remainingBySize = {};
      sizes.forEach((s) => {
        const base = Number(baseStockBySize?.[s] ?? 0);
        const inCart = Number(cartQtyByKey.get(`${String(p.id)}::${String(s)}`) || 0);
        const sold = Number(soldBySize?.[String(p.id)]?.[String(s)] ?? 0);
        remainingBySize[s] = Math.max(0, base - sold - inCart);
      });

      const totalRemaining = Object.values(remainingBySize).reduce((sum, n) => sum + Number(n || 0), 0);

      const imageUrl = (p.media && p.media.coverUrl) ? p.media.coverUrl : '';
      const sizeSelectId = `size-${p.id}-${idx}`;

      const stockLine = totalRemaining > 0
        ? `<p class="stock">In Stock: <span class="stock-count">${Number(totalRemaining || 0)
          }</span></p>`
        : `<p class="stock">New stock coming soon.</p>`;

      const sizeOptions = sizes.map((s) => {
        const r = Number(remainingBySize[s] || 0);
        const disabled = r <= 0 ? 'disabled' : '';
        const label = r <= 0 ? `${escapeHtml(s)} (Out)` : escapeHtml(s);
        return `<option value="${escapeHtml(s)}" ${disabled}>${label}</option>`;
      }).join('');

      const disabledBtn = totalRemaining <= 0 ? 'disabled' : '';

      return `
        <div class="product-card" data-product-id="${escapeHtml(p.id)}">
          <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(p.name || 'Product')}" />
          <h3>${escapeHtml(p.name || '')}</h3>
          <p class="price">${money(p.priceJMD || 0)}</p>

          <div class="row">
            <select id="${escapeHtml(sizeSelectId)}" class="size-select" ${disabledBtn}>
              <option value="">Select size</option>
              ${sizeOptions}
            </select>
          </div>

          <button class="add-to-cart ${disabledBtn ? 'disabled' : ''}" ${disabledBtn}>
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

      if (btn.hasAttribute('disabled')) {
        toast('New stock coming soon.', { important: true });
        return;
      }

      const card = btn.closest('.product-card');
      if (!card) {
        toast('Could not add item (product card not found).', { important: true });
        return;
      }

      const productId = String(card.getAttribute('data-product-id') || '');
      if (!productId) {
        toast('Could not add item (missing product id).', { important: true });
        return;
      }

      const name = card.querySelector('h3')?.textContent?.trim() || 'Item';
      const priceText = card.querySelector('.price')?.textContent || '';
      const price = Number(String(priceText).replace(/[^0-9.]/g, '')) || 0;
      const image = card.querySelector('img')?.getAttribute('src') || '';

      const size = card.querySelector('.size-select')?.value || '';
      if (!size) {
        toast('Please select a size before adding to cart.', { important: true });
        return;
      }

      const remaining = remainingStockFor(productId, size);
      if (remaining <= 0) {
        toast('Not enough stock available for this size.', { important: true });
        return;
      }

      Cart.add({ productId, name, price, image, size: size || null, qty: 1 });

      toast(`Added to cart: ${name}`);
      renderCartIfOnCartPage();

      // Refresh the shop UI so the stock count updates immediately
      renderShopFromStore();
    });
  }

  // -----------------------------
  // CART PAGE
  // -----------------------------
  function renderCartIfOnCartPage() {
    if (!page().includes('cart.html')) return;

    const list = document.getElementById('cartItems');
    const subtotalEl = document.getElementById('cartSubtotal');
    const totalEl = document.getElementById('cartTotal');
    const emptyEl = document.getElementById('cartEmpty');

    if (!list || !subtotalEl || !totalEl || !emptyEl) return;

    const items = Cart.load();
    const subtotal = Cart.subtotal(items);

    const isEmpty = items.length === 0;
    emptyEl.hidden = !isEmpty;

    if (isEmpty) {
      list.innerHTML = '';
      subtotalEl.textContent = money(0);
      totalEl.textContent = money(0);
      return;
    }

    list.innerHTML = items.map(it => `
      <div class="cart-item" data-id="${escapeHtml(it.productId)}" data-size="${escapeHtml(it.size || '')}">
        <img src="${escapeHtml(it.image || '')}" alt="${escapeHtml(it.name || 'Product')}" />
        <div class="ci-info">
          <div class="ci-title">${escapeHtml(it.name || 'Item')}</div>
          <div class="ci-meta">Size: ${escapeHtml(it.size || '')}</div>
          <div class="ci-actions">
            <button class="qty-btn minus">−</button>
            <span class="qty">${Number(it.qty || 0)}</span>
            <button class="qty-btn plus">+</button>
            <button class="remove-btn">Remove</button>
          </div>
        </div>
        <div class="ci-price">${money(Number(it.price || 0) * Number(it.qty || 0))}</div>
      </div>
    `).join('');

    subtotalEl.textContent = money(subtotal);
    totalEl.textContent = money(subtotal);

    list.addEventListener('click', (e) => {
      const row = e.target.closest('.cart-item');
      if (!row) return;
      const id = row.getAttribute('data-id');
      const size = row.getAttribute('data-size');

      if (e.target.classList.contains('remove-btn')) {
        Cart.remove(id, size);
        renderCartIfOnCartPage();
        renderShopFromStore();
        return;
      }

      if (e.target.classList.contains('plus') || e.target.classList.contains('minus')) {
        const items = Cart.load();
        const it = items.find(x => x.productId === id && String(x.size || '') === String(size || ''));
        if (!it) return;
        const next = Number(it.qty || 0) + (e.target.classList.contains('plus') ? 1 : -1);
        if (next <= 0) {
          Cart.remove(id, size);
        } else {
          Cart.setQty(id, size, next);
        }
        renderCartIfOnCartPage();
        renderShopFromStore();
      }
    }, { once: true });
  }

  // -----------------------------
  // LOGIN / REGISTER
  // -----------------------------
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

        const rt = safeParse(localStorage.getItem(KEYS.returnTo));
        localStorage.removeItem(KEYS.returnTo);
        location.href = rt?.href || 'index.html';
      } catch (err) {
        toast(err.message || 'Registration failed.', { important: true });
      }
    });
  }

  // -----------------------------
  // ACCOUNT PAGE
  // -----------------------------
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

  // -----------------------------
  // ORDERS PAGE
  // -----------------------------
  function renderOrdersPage() {
    if (!page().includes('orders.html')) return;
    const u = Auth.currentUser();
    if (!u) {
      localStorage.setItem(KEYS.returnTo, JSON.stringify({ href: 'orders.html' }));
      toast('Please log in to view your orders.', { important: true });
      location.href = 'login.html';
      return;
    }

    const container = document.querySelector('main.orders-container');
    if (!container) return;

    container.querySelectorAll('.order-card').forEach(el => el.remove());
    container.querySelectorAll('.no-orders').forEach(el => el.remove());

    const orders = Orders.listFor(u.email);

    if (!orders.length) {
      const msg = document.createElement('p');
      msg.className = 'no-orders';
      msg.innerHTML = `No orders yet. <a href="shop-page.html">Shop now</a>`;
      container.appendChild(msg);
      return;
    }

    orders.forEach((o) => {
      const orderId = o.id || '—';
      const createdAt = o.createdAt || '';
      const dateTxt = createdAt ? new Date(createdAt).toLocaleDateString() : '';

      const items = Array.isArray(o.items) ? o.items : [];
      const total = Number(o.total ?? o.subtotal ?? 0);

      const card = document.createElement('div');
      card.className = 'order-card';
      card.innerHTML = `
        <div class="order-header">
          <h2>Order #${escapeHtml(String(orderId))}</h2>
          <p><strong>Date:</strong> ${escapeHtml(dateTxt)}</p>
        </div>
        <div class="order-body">
          <p><strong>Status:</strong> <span class="status processing">Processing</span></p>
          <p><strong>Total:</strong> ${money(total)}</p>
          <p><strong>Items:</strong></p>
          <ul>
            ${items.map((it) => {
              const name = escapeHtml(it.name || 'Item');
              const size = it.size ? ` - Size ${escapeHtml(String(it.size))}` : '';
              const qty = Number(it.qty || 0);
              const qtyTxt = qty > 1 ? ` (x${qty})` : '';
              return `<li>${name}${size}${qtyTxt}</li>`;
            }).join('')}
          </ul>
          <button class="btn order-details-btn" data-order="${escapeHtml(String(orderId))}">View Details</button>
        </div>
      `;
      container.appendChild(card);
    });

    const modal = document.getElementById('order-modal');
    const modalBody = document.getElementById('modal-body');
    const closeBtn = modal ? modal.querySelector('.close-btn') : null;

    function closeModal() {
      if (!modal) return;
      modal.style.display = 'none';
    }

    function openModal(order) {
      if (!modal || !modalBody) return;
      const orderId = order.id || '—';
      const createdAt = order.createdAt || '';
      const dateTxt = createdAt ? new Date(createdAt).toLocaleString() : '';
      const items = Array.isArray(order.items) ? order.items : [];
      const subtotal = Number(order.subtotal ?? 0);
      const total = Number(order.total ?? subtotal);

      modalBody.innerHTML = `
        <p><strong>Order:</strong> #${escapeHtml(String(orderId))}</p>
        <p><strong>Date:</strong> ${escapeHtml(dateTxt)}</p>
        <p><strong>Subtotal:</strong> ${money(subtotal)}</p>
        <p><strong>Total:</strong> ${money(total)}</p>
        <hr />
        <ul>
          ${items.map(it => {
            const name = escapeHtml(it.name || 'Item');
            const size = it.size ? ` - Size ${escapeHtml(String(it.size))}` : '';
            const qty = Number(it.qty || 0);
            const lineTotal = money(Number(it.price || 0) * qty);
            return `<li>${name}${size} (x${qty}) — ${lineTotal}</li>`;
          }).join('')}
        </ul>
      `;
      modal.style.display = 'flex';
    }

    container.querySelectorAll('.order-details-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-order');
        const order = orders.find(x => String(x.id) === String(id));
        if (order) openModal(order);
      });
    });

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }
  }

  // -----------------------------
  // CHECKOUT PAGE
  // -----------------------------
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
      // Validate inventory against SOLD ledger before placing order
      const store = window.BSProducts;
      if (!store || typeof store.readAll !== 'function') {
        toast('Products store is unavailable. Please try again.', { important: true });
        return;
      }

      const all = store.readAll() || [];
      const st = readState();
      const soldBySize = st.soldBySize || {};
      const reqByKey = new Map();

      items.forEach((it) => {
        const pid = String(it.productId || '');
        const sz = String(it.size || '');
        const key = `${pid}::${sz}`;
        reqByKey.set(key, (Number(reqByKey.get(key) || 0) + Number(it.qty || 0)));
      });

      let ok = true;
      for (const [key, reqQty] of reqByKey.entries()) {
        const [pid, sz] = key.split('::');
        const product = all.find(p => String(p?.id) === pid);
        const base = Number(product?.stockBySize?.[sz] ?? 0);
        const sold = Number(soldBySize?.[pid]?.[sz] ?? 0);

        if (!product) {
          ok = false;
          toast('One or more items are no longer available. Please update your cart.', { important: true });
          break;
        }

        if ((base - sold) < Number(reqQty || 0)) {
          ok = false;
          toast('Not enough stock for one or more items. Please update your cart.', { important: true });
          break;
        }
      }

      if (!ok) return;

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

      // Reduce inventory locally by recording SOLD quantities (backend-ready sales ledger)
      const st2 = readState();
      st2.soldBySize = st2.soldBySize || {};
      items.forEach((it) => {
        const pid = String(it.productId || '');
        const sz = String(it.size || '');
        const qty = Number(it.qty || 0);
        if (!pid || !sz || qty <= 0) return;

        st2.soldBySize[pid] = st2.soldBySize[pid] || {};
        st2.soldBySize[pid][sz] = Number(st2.soldBySize[pid][sz] || 0) + qty;
      });
      writeState(st2);

      Cart.clear();
      toast('Order placed successfully!');
      renderCheckoutPage();
    }, { once: true });
  }

  // -----------------------------
  // INIT
  // -----------------------------
  function init() {
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
