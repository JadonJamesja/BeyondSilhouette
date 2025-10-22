/**
 * site.js — Unified client-side app for Beyond Silhouette
 * Single-file drop-in replacement for main.js / shop.js / cart.js.
 *
 * Local/demo behavior:
 *  - Cart persisted in localStorage under 'bs_cart' (migrates old format automatically)
 *  - Session persisted in localStorage under 'bs_session' (demo user creation)
 *  - Checkout simulated locally (delay + success) and clears cart
 *
 * Main selectors observed in your HTML:
 *  - product card container: .product-card (data-id, data-name, data-price, data-stock)
 *  - size select: .product-size-select
 *  - add-to-cart buttons: .add-to-cart
 *  - stock: .stock-count
 *  - cart badge: .cart-count
 *  - cart page container: .cart-container
 *
 * Notes:
 *  - This script is defensive and skips missing elements
 *  - It supports cross-tab sync using window.storage events
 */

/* =================== Utilities =================== */
const S_KEYS = {
  CART: 'bs_cart',
  SESSION: 'bs_session'
};

const now = () => Date.now();
const uid = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

const formatJMD = (n) => {
  const num = Number(n) || 0;
  return 'J$' + num.toLocaleString('en-JM', { maximumFractionDigits: 0 });
};

const safeJSONParse = (s) => {
  try { return JSON.parse(s); } catch (e) { return null; }
};

const isElement = (x) => x instanceof Element;

/* =================== Cart Module (single source of truth) =================== */
/*
  Storage shape (new):
  {
    version: 1,
    users: {
      "<userId_or_guest>": {
         items: { "<prodId|size>": { id, productId, size, name, price, qty } },
         updatedAt: 123456
      },
      ...
    },
    activeUserId: null | "<userId>"
  }

  Backwards compatibility: If localStorage[S_KEYS.CART] is an ARRAY (old), migrate into users.guest
*/
const Cart = (function () {
  const STORAGE_KEY = S_KEYS.CART;
  let state = { version: 1, users: {}, activeUserId: null };

  function _load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      state = { version: 1, users: {}, activeUserId: null };
      _save();
      return;
    }
    const parsed = safeJSONParse(raw);
    if (!parsed) {
      // fallback: wipe and reinit
      state = { version: 1, users: {}, activeUserId: null };
      _save();
      return;
    }
    // migration: if parsed is an array (old shape), convert
    if (Array.isArray(parsed)) {
      const guestItems = {};
      parsed.forEach((it) => {
        // create a unique key per product+size to avoid collisions
        const key = `${String(it.id || it.productId)}::${String(it.size || '')}`;
        guestItems[key] = {
          id: key,
          productId: it.id || it.productId,
          size: it.size || '',
          name: it.name || it.title || 'Product',
          price: Number(it.price) || 0,
          qty: Number(it.qty) || 1
        };
      });
      state = { version: 1, users: { guest: { items: guestItems, updatedAt: now() } }, activeUserId: null };
      _save();
      return;
    }
    // otherwise assume new shape
    state = parsed;
    // ensure minimal shape
    if (!state.users) state.users = {};
    if (!('activeUserId' in state)) state.activeUserId = null;
  }

  function _save() {
    state.updatedAt = now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      // let other listeners know
      window.dispatchEvent(new CustomEvent('bs:cart:updated', { detail: { state } }));
    } catch (e) {
      console.error('Cart save failed', e);
    }
  }

  _load();

  function _ensureUser(uid) {
    const k = uid == null ? 'guest' : String(uid);
    if (!state.users[k]) state.users[k] = { items: {}, updatedAt: now() };
    return state.users[k];
  }

  function getActiveUserId() {
    return state.activeUserId;
  }

  function setActiveUserId(uid) {
    state.activeUserId = uid == null ? null : String(uid);
    _save();
  }

  function listItems(userId = state.activeUserId) {
    const key = userId == null ? 'guest' : String(userId);
    if (!state.users[key]) return [];
    return Object.values(state.users[key].items || {});
  }

  function itemCount(userId = state.activeUserId) {
    return listItems(userId).reduce((s, it) => s + (Number(it.qty) || 0), 0);
  }

  function subtotal(userId = state.activeUserId) {
    return listItems(userId).reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
  }

  function _itemKey(productId, size) {
    return `${String(productId)}::${String(size || '')}`;
  }

  function add(productId, { name = '', price = 0, size = '', qty = 1 } = {}, userId = state.activeUserId) {
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    const key = userId == null ? 'guest' : String(userId);
    _ensureUser(key);
    const itemKey = _itemKey(productId, size);
    const existing = state.users[key].items[itemKey];
    if (existing) {
      existing.qty = existing.qty + qty;
    } else {
      state.users[key].items[itemKey] = {
        id: itemKey,
        productId: String(productId),
        size: String(size || ''),
        name: name || '',
        price: Number(price) || 0,
        qty
      };
    }
    state.users[key].updatedAt = now();
    _save();
  }

  function updateQuantity(productId, size, qty, userId = state.activeUserId) {
    qty = Math.floor(Number(qty) || 0);
    const key = userId == null ? 'guest' : String(userId);
    const itemKey = _itemKey(productId, size);
    if (!state.users[key] || !state.users[key].items[itemKey]) return;
    if (qty <= 0) {
      delete state.users[key].items[itemKey];
    } else {
      state.users[key].items[itemKey].qty = qty;
    }
    state.users[key].updatedAt = now();
    _save();
  }

  function remove(productId, size, userId = state.activeUserId) {
    const key = userId == null ? 'guest' : String(userId);
    const itemKey = _itemKey(productId, size);
    if (!state.users[key]) return;
    delete state.users[key].items[itemKey];
    state.users[key].updatedAt = now();
    _save();
  }

  function clear(userId = state.activeUserId) {
    const key = userId == null ? 'guest' : String(userId);
    state.users[key] = { items: {}, updatedAt: now() };
    _save();
  }

  function mergeGuestIntoUser(userId) {
    const guest = state.users['guest'];
    if (!guest || !guest.items || Object.keys(guest.items).length === 0) return;
    const targetKey = String(userId);
    _ensureUser(targetKey);
    const target = state.users[targetKey];
    Object.values(guest.items).forEach((it) => {
      const k = _itemKey(it.productId, it.size);
      if (target.items[k]) {
        target.items[k].qty = Number(target.items[k].qty || 0) + Number(it.qty || 0);
      } else {
        target.items[k] = { ...it };
      }
    });
    // clear guest
    state.users['guest'] = { items: {}, updatedAt: now() };
    _save();
  }

  // respond to storage events (cross-tab)
  window.addEventListener('storage', (ev) => {
    if (ev.key === STORAGE_KEY) {
      _load();
      window.dispatchEvent(new CustomEvent('bs:cart:remote', { detail: { state } }));
    }
  });

  return {
    _rawState: () => JSON.parse(JSON.stringify(state)),
    getActiveUserId,
    setActiveUserId,
    listItems,
    itemCount,
    subtotal,
    add,
    updateQuantity,
    remove,
    clear,
    mergeGuestIntoUser,
  };
})();

/* =================== Session (local demo) =================== */
/*
  Session shape: { user: { id, name, email } }
  Stored under S_KEYS.SESSION
*/
const Session = (function () {
  const KEY = S_KEYS.SESSION;
  let session = null;

  function _load() {
    const raw = localStorage.getItem(KEY);
    session = safeJSONParse(raw);
    if (!session || !session.user) session = null;
  }

  function _save() {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent('bs:session:changed', { detail: { session } }));
  }

  _load();

  function getUser() { return session ? session.user : null; }

  function isLoggedIn() { return !!(session && session.user && session.user.id); }

  async function login({ email }) {
    // demo: create a user
    const user = { id: 'u_' + uid(), name: (email && email.split('@')[0]) || 'User', email: email || '' };
    session = { user };
    _save();
    // merge guest cart into user
    Cart.mergeGuestIntoUser(user.id);
    Cart.setActiveUserId(user.id);
    return user;
  }

  async function register({ name, email }) {
    // demo register behaves same as login for local flow
    const user = { id: 'u_' + uid(), name: name || (email && email.split('@')[0]) || 'User', email: email || '' };
    session = { user };
    _save();
    Cart.mergeGuestIntoUser(user.id);
    Cart.setActiveUserId(user.id);
    return user;
  }

  function logout() {
    session = null;
    _save();
    Cart.setActiveUserId(null);
    // session change event already dispatched in _save
  }

  // Cross-tab: respond to session storage changes
  window.addEventListener('storage', (ev) => {
    if (ev.key === KEY) {
      _load();
      window.dispatchEvent(new CustomEvent('bs:session:remote', { detail: { session } }));
    }
  });

  return { getUser, isLoggedIn, login, register, logout };
})();

/* =================== UI Helper (toasts + dom utilities) =================== */

const UI = (function () {
  // toast container
  let toastRoot = document.getElementById('bs-toast-root');
  if (!toastRoot) {
    toastRoot = document.createElement('div');
    toastRoot.id = 'bs-toast-root';
    Object.assign(toastRoot.style, {
      position: 'fixed', right: '12px', bottom: '12px', zIndex: 99999, maxWidth: '360px'
    });
    document.body.appendChild(toastRoot);
  }

  function toast(msg, { type = 'info', duration = 3500 } = {}) {
    const el = document.createElement('div');
    el.className = `bs-toast bs-toast-${type}`;
    el.style.padding = '8px 12px';
    el.style.marginTop = '8px';
    el.style.borderRadius = '8px';
    el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.08)';
    el.style.background = type === 'error' ? '#ffecec' : (type === 'success' ? '#ecffe8' : '#fff');
    el.style.border = '1px solid rgba(0,0,0,0.06)';
    el.innerText = msg;
    toastRoot.appendChild(el);
    setTimeout(() => { try { el.remove(); } catch (e) { } }, duration);
    return el;
  }

  function find(selector) {
    try { return document.querySelector(selector); } catch (e) { return null; }
  }

  function findAll(selector) {
    try { return Array.from(document.querySelectorAll(selector)); } catch (e) { return []; }
  }

  return { toast, find, findAll };
})();

/* =================== Product Helpers (reads static DOM product-cards) =================== */
const ProductStore = (function () {
  // Read product cards present in DOM (shop page static markup)
  function _readAllFromDOM() {
    const elems = UI.findAll('.product-card');
    return elems.map((el) => {
      const id = el.dataset.id || el.getAttribute('data-id') || uid();
      const name = el.dataset.name || el.getAttribute('data-name') || (el.querySelector('h3') ? el.querySelector('h3').innerText : 'Product');
      const priceRaw = el.dataset.price || el.getAttribute('data-price') || (el.querySelector('.price') ? el.querySelector('.price').innerText.replace(/[^\d]/g, '') : '0');
      const price = Number(priceRaw) || 0;
      const stockRaw = el.dataset.stock || el.getAttribute('data-stock') || (el.querySelector('.stock-count') ? el.querySelector('.stock-count').innerText : null);
      const stock = stockRaw == null ? null : Number(String(stockRaw).replace(/[^\d]/g, '')) || 0;
      return {
        id: String(id),
        name: String(name),
        price,
        stock,
        el
      };
    });
  }

  const products = _readAllFromDOM();

  function find(productId) {
    return products.find(p => String(p.id) === String(productId)) || null;
  }

  return { all: () => products.slice(), find };
})();

/* =================== Core App Behavior =================== */

const App = (function () {
  function updateCartBadge() {
    const badges = UI.findAll('.cart-count');
    const count = Cart.itemCount() || 0;
    badges.forEach(b => { b.textContent = String(count); });
  }

  function updateProductStockUI(product) {
    if (!product || !product.el) return;
    const stockSpan = product.el.querySelector('.stock-count');
    if (stockSpan) {
      // compute available qty in local cart (guest)
      const key = Cart.getActiveUserId() || null;
      // find total qty reserved in cart for this product across active user
      const items = Cart.listItems();
      const reserved = items.filter(it => String(it.productId) === String(product.id)).reduce((s, it) => s + Number(it.qty || 0), 0);
      const displayedStock = (product.stock == null) ? '' : Math.max(0, (product.stock - reserved));
      stockSpan.textContent = displayedStock;
      const addBtn = product.el.querySelector('.add-to-cart');
      if (addBtn) addBtn.disabled = displayedStock <= 0;
      if (displayedStock <= 0 && addBtn) addBtn.textContent = 'Sold Out';
    }
  }

  function refreshAllProductStockUI() {
    ProductStore.all().forEach(updateProductStockUI);
  }

  /* Product page: wire add-to-cart buttons */
  function initProductInteractions() {
    // delegated click handler for add-to-cart buttons
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest && ev.target.closest('.add-to-cart');
      if (!btn) return;
      ev.preventDefault();
      const card = btn.closest('.product-card');
      if (!card) return;
      const pid = card.dataset.id || card.getAttribute('data-id');
      const product = ProductStore.find(pid);
      if (!product) {
        UI.toast('Product not found', { type: 'error' });
        return;
      }
      // require size if select present
      const sizeSelect = card.querySelector('.product-size-select');
      const selectedSize = sizeSelect ? (sizeSelect.value || '') : '';
      if (sizeSelect && (!selectedSize || selectedSize === '')) {
        // small UI feedback
        UI.toast('Please select a size', { type: 'error', duration: 1800 });
        sizeSelect.classList.add('bs-shake');
        setTimeout(() => sizeSelect.classList.remove('bs-shake'), 500);
        return;
      }
      // check stock
      const stockSpan = card.querySelector('.stock-count');
      const available = (stockSpan ? Number(stockSpan.textContent || 0) : (product.stock == null ? Infinity : product.stock));
      if (available <= 0) {
        UI.toast('Item is sold out', { type: 'error' });
        if (btn) btn.disabled = true;
        return;
      }
      // add to cart (active user)
      Cart.add(product.id, { name: product.name, price: product.price, size: selectedSize, qty: 1 });
      UI.toast(`${product.name} added to cart`, { type: 'success' });
      updateCartBadge();
      refreshAllProductStockUI();
      // button feedback
      const original = btn.textContent;
      btn.textContent = 'Added';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = original || 'Add to Cart';
        // re-evaluate stock
        updateProductStockUI(product);
      }, 700);
    });
  }

  /* Cart page rendering */
  function renderCartPage() {
    const container = UI.find('.cart-container');
    if (!container) return;
    const items = Cart.listItems();
    container.innerHTML = '';
    if (!items || items.length === 0) {
      const emp = document.createElement('div');
      emp.className = 'cart-empty';
      emp.innerText = 'Your cart is empty.';
      container.appendChild(emp);
      return;
    }

    const table = document.createElement('div');
    table.className = 'bs-cart-list';
    items.forEach(it => {
      const row = document.createElement('div');
      row.className = 'bs-cart-row';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.padding = '10px 0';
      const left = document.createElement('div');
      left.style.flex = '1';
      left.innerHTML = `<strong>${it.name}</strong><div style="font-size:0.9rem;color:#666">Size: ${it.size || '—'}</div>`;
      const mid = document.createElement('div');
      mid.style.width = '120px';
      mid.style.display = 'flex';
      mid.style.alignItems = 'center';
      mid.style.gap = '6px';
      const dec = document.createElement('button'); dec.textContent = '-'; dec.className = 'bs-dec';
      const qty = document.createElement('span'); qty.textContent = String(it.qty);
      const inc = document.createElement('button'); inc.textContent = '+'; inc.className = 'bs-inc';
      mid.appendChild(dec); mid.appendChild(qty); mid.appendChild(inc);
      const right = document.createElement('div');
      right.style.width = '140px';
      right.style.textAlign = 'right';
      right.innerHTML = `<div>${formatJMD(it.price * it.qty)}</div><button class="bs-remove" style="display:block;margin-top:6px">Remove</button>`;

      // attach handlers
      dec.addEventListener('click', () => {
        Cart.updateQuantity(it.productId, it.size, Math.max(0, Number(it.qty) - 1));
        renderCartPage();
        updateCartBadge();
        refreshAllProductStockUI();
      });
      inc.addEventListener('click', () => {
        Cart.updateQuantity(it.productId, it.size, Number(it.qty) + 1);
        renderCartPage();
        updateCartBadge();
        refreshAllProductStockUI();
      });
      right.querySelector('.bs-remove').addEventListener('click', () => {
        Cart.remove(it.productId, it.size);
        renderCartPage();
        updateCartBadge();
        refreshAllProductStockUI();
      });

      row.appendChild(left);
      row.appendChild(mid);
      row.appendChild(right);
      table.appendChild(row);
    });

    // subtotal + checkout
    const subtotal = Cart.subtotal();
    const footer = document.createElement('div');
    footer.style.marginTop = '16px';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'space-between';
    const subEl = document.createElement('div'); subEl.innerHTML = `<strong>Subtotal:</strong> ${formatJMD(subtotal)}`;
    const checkoutBtn = document.createElement('button');
    checkoutBtn.textContent = Session.isLoggedIn ? 'Checkout' : 'Login to Checkout';
    checkoutBtn.className = 'bs-checkout-btn';
    checkoutBtn.style.padding = '8px 12px';
    checkoutBtn.style.cursor = 'pointer';
    checkoutBtn.addEventListener('click', async () => {
      if (!Session.isLoggedIn()) {
        // simple prompt or redirect flow
        UI.toast('Please login to checkout', { type: 'error' });
        return;
      }
      // simulate checkout
      UI.toast('Processing checkout...', { type: 'info' });
      await new Promise(res => setTimeout(res, 1000));
      const orderId = 'order_' + uid();
      UI.toast(`Order ${orderId} placed — thank you!`, { type: 'success' });
      Cart.clear();
      renderCartPage();
      updateCartBadge();
      refreshAllProductStockUI();
    });

    footer.appendChild(subEl);
    footer.appendChild(checkoutBtn);

    container.appendChild(table);
    container.appendChild(footer);
  }

  /* Nav login/logout flow (very small/demo) */
  function initAuthButtons() {
    // your HTML has a .loginIcon anchor and e.g. logout links — but we will attach to any element with .login-toggle and .logout-toggle
    const loginEls = UI.findAll('.loginIcon, .login-toggle, .loginBtn');
    const logoutEls = UI.findAll('.logout-toggle, .logoutBtn');
    loginEls.forEach(el => {
      el.addEventListener('click', async (ev) => {
        ev && ev.preventDefault && ev.preventDefault();
        const action = prompt('Type "login" to login or "register" to register (demo). Cancel to abort.');
        if (!action) return;
        if (action.toLowerCase().startsWith('register')) {
          const email = prompt('Enter email for registration (demo):');
          const name = prompt('Enter name (optional):', email ? email.split('@')[0] : '');
          try {
            const user = await Session.register({ name, email });
            UI.toast(`Registered as ${user.name}`, { type: 'success' });
            // update badge and cart merge handled in Session.register
            updateCartBadge();
            refreshAllProductStockUI();
            refreshAuthUI();
          } catch (e) {
            UI.toast('Registration failed', { type: 'error' });
          }
        } else {
          const email = prompt('Enter email to login (demo):');
          if (!email) return;
          try {
            const user = await Session.login({ email });
            UI.toast(`Logged in as ${user.name}`, { type: 'success' });
            updateCartBadge();
            refreshAllProductStockUI();
            refreshAuthUI();
          } catch (e) {
            UI.toast('Login failed', { type: 'error' });
          }
        }
      });
    });
    logoutEls.forEach(el => {
      el.addEventListener('click', (ev) => {
        ev && ev.preventDefault && ev.preventDefault();
        Session.logout();
        UI.toast('Logged out', { type: 'info' });
        updateCartBadge();
        refreshAllProductStockUI();
        refreshAuthUI();
      });
    });
  }

  function refreshAuthUI() {
    const user = Session.getUser();
    // update any element with .login-name or .account-name
    UI.findAll('.account-name, .login-name, .user-name').forEach(el => {
      el.textContent = user ? (user.name || user.email || 'Account') : 'Guest';
    });
    // change login/logout visibility if needed
    UI.findAll('.login-required').forEach(el => {
      el.style.display = user ? 'none' : '';
    });
    UI.findAll('.logout-required').forEach(el => {
      el.style.display = user ? '' : 'none';
    });
  }

  /* Cross-tab sync handlers */
  function bindCrossTab() {
    window.addEventListener('storage', (ev) => {
      if (ev.key === S_KEYS.CART) {
        // cart changed in other tab
        updateCartBadge();
        refreshAllProductStockUI();
        // if on cart page, re-render
        if (document.body && document.body.id === 'cart-page') {
          renderCartPage();
        }
      }
      if (ev.key === S_KEYS.SESSION) {
        refreshAuthUI();
        updateCartBadge();
      }
    });
    window.addEventListener('bs:cart:updated', () => {
      updateCartBadge();
      refreshAllProductStockUI();
    });
  }

  /* init on DOM ready */
  function init() {
    // product interactions only on pages that have product cards
    initProductInteractions();
    updateCartBadge();
    refreshAllProductStockUI();
    initAuthButtons();
    refreshAuthUI();
    bindCrossTab();
    // if this is cart page, render
    if (document.body && document.body.id === 'cart-page') {
      renderCartPage();
    }
    // small accessibility: update badge aria-live if present
    UI.findAll('.cart-count').forEach(el => el.setAttribute('aria-live', 'polite'));
  }

  return { init, renderCartPage, updateCartBadge };
})();

/* =================== Boot =================== */
document.addEventListener('DOMContentLoaded', () => {
  try {
    App.init();
  } catch (e) {
    console.error('App init error', e);
  }
});
