/* BeyondSilhouette Admin UI (FULL FILE)
   Phase 1:
   - Admin-only access using EXISTING site localStorage auth (bs_session_v1 + bs_users_v1)
   - DEV-only promotion via console: makeAdmin(email) lives in client/js/main.js
   - Persisted theme (dark/light)
   - Settings page persists admin settings (bs_admin_settings_v1)
   - Products Manager wired to existing Products Store (bs_products_v1) and your existing UI
   - Dashboard wired to real orders + customers + products low-stock
   - Orders page wired to real orders; includes real Order Details modal (if present in HTML)
   - Customers page wired to real site users + orders
*/

(function () {
  'use strict';

  const SITE = {
    session: 'bs_session_v1',
    users: 'bs_users_v1',
    products: 'bs_products_v1',
    state: 'bs_state_v1'
  };

  const ADMIN = {
    theme: 'bs_admin_theme',
    settings: 'bs_admin_settings_v1'
  };

  const ORDER_STATUSES = ['Placed', 'Processing', 'Shipped', 'Delivered'];

  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ================= Core utils ================= */
  function safeParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function toInt(v) {
    const n = Number(String(v == null ? '' : v).replace(/[^\d-]/g, ''));
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  function toPriceJMD(v) {
    const n = Number(String(v == null ? '' : v).replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }

  function formatJ(n) {
    const num = Math.round(Number(n || 0));
    return 'J$ ' + num.toLocaleString('en-JM', { maximumFractionDigits: 0 });
  }

  function toast(message) {
    let el = qs('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = String(message || '');
    el.classList.add('show');
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(() => el.classList.remove('show'), 2200);
  }

  function setYear() {
    const year = new Date().getFullYear();
    qsa('[data-ui="year"]').forEach(n => (n.textContent = String(year)));
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function uid(prefix = 'prod_') {
    return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  }

  function slugify(s) {
    return String(s || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  function formatDateShort(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || !Number.isFinite(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });
  }

  function normalizeOrderStatus(value) {
    const v = String(value || '').trim();
    const found = ORDER_STATUSES.find(s => s.toLowerCase() === v.toLowerCase());
    return found || 'Placed';
  }

  /* ================= Theme (persisted) ================= */
  function readTheme() {
    const raw = localStorage.getItem(ADMIN.theme);
    const t = String(raw || '').trim().toLowerCase();
    return (t === 'light' || t === 'dark') ? t : 'dark';
  }

  function applyTheme(theme) {
    const t = (String(theme || '').toLowerCase() === 'light') ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(ADMIN.theme, t);
  }

  function toggleTheme() {
    const next = readTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    toast(`Theme: ${next}`);
  }

  /* ================= Admin settings ================= */
  function readAdminSettings() {
    const raw = localStorage.getItem(ADMIN.settings);
    const obj = raw ? (safeParse(raw) || {}) : {};
    const lowStockThreshold = Number(obj.lowStockThreshold);
    return {
      lowStockThreshold: Number.isFinite(lowStockThreshold) ? Math.max(0, Math.floor(lowStockThreshold)) : 3
    };
  }

  function writeAdminSettings(next) {
    const obj = next && typeof next === 'object' ? next : {};
    localStorage.setItem(ADMIN.settings, JSON.stringify(obj));
  }

  /* ================= Site auth (source of truth) ================= */
  function readSiteSession() {
    const raw = localStorage.getItem(SITE.session);
    return raw ? (safeParse(raw) || null) : null;
  }

  function readSiteUsers() {
    const raw = localStorage.getItem(SITE.users);
    const obj = raw ? (safeParse(raw) || {}) : {};
    return (obj && typeof obj === 'object') ? obj : {};
  }

  function getCurrentUser() {
    const sess = readSiteSession();
    if (!sess || !sess.email) return null;
    const users = readSiteUsers();
    return users[String(sess.email).trim().toLowerCase()] || null;
  }

  function isLoggedIn() {
    const u = getCurrentUser();
    return !!(u && u.email);
  }

  function isAdmin() {
    const u = getCurrentUser();
    return !!(u && String(u.role || '').toLowerCase() === 'admin');
  }

  function logoutSite() {
    localStorage.removeItem(SITE.session);
  }

  function inAdminFolder() {
    const path = location.pathname.replace(/\\/g, '/');
    return path.includes('/admin/');
  }

  function isAdminLoginPage() {
    const path = location.pathname.replace(/\\/g, '/').toLowerCase();
    return path.endsWith('/admin/login.html') || path.endsWith('/admin/login');
  }

  function requireAdminGate() {
    if (!inAdminFolder()) return;

    if (!isLoggedIn()) {
      // Admin pages do NOT have their own login — use site login
      location.href = '../login.html';
      return;
    }

    if (!isAdmin()) {
      location.href = '../index.html';
      return;
    }

    // If admin is logged in, never stay on /admin/login
    if (isAdminLoginPage()) {
      location.href = './dashboard.html';
    }
  }

  function hydrateAdminName() {
    const u = getCurrentUser();
    const display = (u && (u.name || u.email)) ? String(u.name || u.email) : 'Admin';
    qsa('[data-ui="adminName"]').forEach(n => (n.textContent = display));
  }

  function syncActiveNav() {
    // Keeps sidebar highlight correct on every page (prevents copy/paste drift).
    const path = location.pathname.replace(/\\/g, '/').toLowerCase();
    const file = (path.split('/').pop() || '').trim();
    if (!file) return;

    const links = qsa('.nav a');
    if (!links.length) return;

    links.forEach(a => a.classList.remove('active'));

    const target = ('./' + file).toLowerCase();
    const match = links.find(a => String(a.getAttribute('href') || '').toLowerCase() === target);
    if (match) match.classList.add('active');
  }

  /* ================= Sidebar + delegated actions ================= */
  function bindDelegatedActions() {
    document.addEventListener('click', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
      if (!el) return;

      const action = el.getAttribute('data-action');
      if (!action) return;

      if (action === 'toggle-theme') {
        e.preventDefault();
        toggleTheme();
        return;
      }

      if (action === 'toggle-sidebar') {
        e.preventDefault();
        if (window.matchMedia && window.matchMedia('(max-width: 920px)').matches) {
          document.body.classList.toggle('sidebar-open');
        } else {
          // Phase 1.1: do NOT collapse on desktop.
          toast('Sidebar collapse is disabled for now.');
        }
        return;
      }

      if (action === 'logout') {
        e.preventDefault();
        logoutSite();
        location.href = '../login.html';
        return;
      }

      if (action === 'toast') {
        e.preventDefault();
        toast(el.getAttribute('data-toast') || 'Done.');
        return;
      }
    });
  }

  /* ================= Products store helpers ================= */
  function readProductsRaw() {
    const raw = localStorage.getItem(SITE.products);
    const arr = raw ? safeParse(raw) : null;
    return Array.isArray(arr) ? arr : [];
  }

  function writeProductsRaw(products) {
    localStorage.setItem(SITE.products, JSON.stringify(Array.isArray(products) ? products : []));
  }

  function productIsPublished(p) {
    return !!(p && p.isActive !== false && String(p.status || '').toLowerCase() === 'published');
  }

  function getCoverUrl(p) {
    if (!p) return '';
    if (p.media && typeof p.media === 'object' && typeof p.media.coverUrl === 'string') return p.media.coverUrl;
    return '';
  }

  /* ================= Products Manager (products.html) ================= */
  function initProductsManager() {
    const form = qs('#productForm');
    if (!form) return;

    const name = qs('input[name="name"]', form);
    const desc = qs('textarea[name="description"]', form);
    const price = qs('input[name="price"]', form);
    const status = qs('select[name="status"]', form);
    const sS = qs('input[name="stockS"]', form);
    const sM = qs('input[name="stockM"]', form);
    const sL = qs('input[name="stockL"]', form);
    const sXL = qs('input[name="stockXL"]', form);

    const totalBadge = qs('#stockTotalBadge');

    const pvStatus = qs('#previewStatus');
    const pvName = qs('#previewName');
    const pvDesc = qs('#previewDesc');
    const pvPrice = qs('#previewPrice');
    const pvStock = qs('#previewStock');
    const pvMedia = qs('#previewMedia');

    const fileInput = qs('#productImages');
    const imageGrid = qs('#imageGrid');

    // Buttons (existing UI)
    const saveDraftBtn = qsa('button', form).find(b => (b.textContent || '').trim().toLowerCase() === 'save draft');
    const deleteBtn = qsa('button', form).find(b => (b.textContent || '').trim().toLowerCase() === 'delete');
    const publishBtn = qsa('button', form).find(b => (b.textContent || '').trim().toLowerCase() === 'publish');

    const topNewBtn = qsa('.topbar-actions button').find(b => (b.textContent || '').toLowerCase().includes('new product'));
    const topOpenShopBtn = qsa('.topbar-actions button').find(b => (b.textContent || '').toLowerCase().includes('open shop'));

    // Lists (existing UI has two .list blocks in the Preview card)
    const listBlocks = qsa('.card .list');
    const draftsList = listBlocks[0] || null;
    const publishedList = listBlocks[1] || null;

    // Editor state
    let editingId = null;
    let images = []; // [{ name, dataUrl }]
    let coverDataUrl = '';

    function totalStock() {
      return toInt(sS?.value) + toInt(sM?.value) + toInt(sL?.value) + toInt(sXL?.value);
    }

    function readStockBySizeFromForm() {
      return {
        S: toInt(sS?.value),
        M: toInt(sM?.value),
        L: toInt(sL?.value),
        XL: toInt(sXL?.value),
      };
    }

    function renderTextPreview() {
      const tName = (name?.value || '—').trim() || '—';
      const tDesc = (desc?.value || '—').trim() || '—';
      const tPrice = formatJ(toPriceJMD(price?.value));
      const tStatus = (String(status?.value || '').toLowerCase() === 'published') ? 'Published' : 'Draft';
      const tStock = totalStock();

      if (pvName) pvName.textContent = tName;
      if (pvDesc) pvDesc.textContent = tDesc;
      if (pvPrice) pvPrice.textContent = tPrice;
      if (pvStatus) pvStatus.textContent = tStatus;
      if (pvStock) pvStock.textContent = 'Stock: ' + tStock;
      if (totalBadge) totalBadge.textContent = 'Total: ' + tStock;
    }

    async function readFiles(files) {
      const arr = Array.from(files || []);
      return Promise.all(arr.map(f => new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve({ name: f.name, dataUrl: String(r.result || '') });
        r.onerror = () => reject(new Error('read failed'));
        r.readAsDataURL(f);
      })));
    }

    function renderImages(list) {
      if (imageGrid) imageGrid.innerHTML = '';

      (list || []).forEach((img, idx) => {
        const tile = document.createElement('div');
        tile.className = 'image-tile';
        tile.innerHTML = `
          <img alt="Product image ${idx + 1}" src="${img.dataUrl}">
          <div class="meta">${escapeHtml(img.name)}</div>
        `;
        imageGrid && imageGrid.appendChild(tile);
      });

      if (pvMedia) {
        pvMedia.innerHTML = '';
        const first = list && list[0] ? list[0] : null;
        const url = first ? first.dataUrl : coverDataUrl;
        if (url) {
          const im = document.createElement('img');
          im.src = url;
          im.alt = 'Preview image';
          pvMedia.appendChild(im);
        } else {
          pvMedia.innerHTML = '<span class="muted">No image</span>';
        }
      }
    }

    function clearForm() {
      editingId = null;
      images = [];
      coverDataUrl = '';
      if (name) name.value = '';
      if (desc) desc.value = '';
      if (price) price.value = '';
      if (status) status.value = 'draft';
      if (sS) sS.value = '';
      if (sM) sM.value = '';
      if (sL) sL.value = '';
      if (sXL) sXL.value = '';
      if (fileInput) fileInput.value = '';
      if (imageGrid) imageGrid.innerHTML = '';
      if (pvMedia) pvMedia.innerHTML = '<span class="muted">No image</span>';
      renderTextPreview();
    }

    function loadProductIntoForm(p) {
      if (!p) return;
      editingId = String(p.id || '');
      if (name) name.value = String(p.title || '');
      if (desc) desc.value = String(p.description || '');
      if (price) price.value = String(Number(p.priceJMD || 0));
      if (status) status.value = String(p.status || 'draft').toLowerCase() === 'published' ? 'published' : 'draft';

      const stock = (p.stockBySize && typeof p.stockBySize === 'object') ? p.stockBySize : {};
      if (sS) sS.value = String(toInt(stock.S));
      if (sM) sM.value = String(toInt(stock.M));
      if (sL) sL.value = String(toInt(stock.L));
      if (sXL) sXL.value = String(toInt(stock.XL));

      coverDataUrl = getCoverUrl(p) || '';
      images = coverDataUrl ? [{ name: 'cover', dataUrl: coverDataUrl }] : [];
      renderImages(images);
      renderTextPreview();
    }

    function upsertProduct({ forceStatus } = {}) {
      const title = (name?.value || '').trim();
      if (!title) throw new Error('Please enter a product name.');

      const products = readProductsRaw();

      const desiredStatus = forceStatus || (String(status?.value || '').toLowerCase() === 'published' ? 'published' : 'draft');
      const stockBySize = readStockBySizeFromForm();
      const sizes = ['S', 'M', 'L', 'XL'];

      const coverUrl = (images && images[0] && images[0].dataUrl) ? images[0].dataUrl : coverDataUrl;

      const isNew = !editingId;
      const id = isNew ? uid('prod_') : editingId;

      const existingIdx = products.findIndex(x => String(x && x.id) === String(id));
      const existing = existingIdx >= 0 ? (products[existingIdx] || {}) : {};

      const next = {
        ...existing,
        id,
        slug: existing.slug || slugify(title) || id,
        status: desiredStatus,
        title,
        description: String(desc?.value || ''),
        priceJMD: toPriceJMD(price?.value),
        sizes: Array.isArray(existing.sizes) && existing.sizes.length ? existing.sizes : sizes,
        stockBySize,
        media: {
          ...(existing.media && typeof existing.media === 'object' ? existing.media : {}),
          coverUrl: coverUrl || (existing.media && existing.media.coverUrl) || ''
        },
        updatedAt: nowISO(),
        createdAt: existing.createdAt || nowISO(),
        isActive: (existing.isActive === false) ? false : true,
      };

      if (existingIdx >= 0) products[existingIdx] = next;
      else products.unshift(next);

      writeProductsRaw(products);
      editingId = id;
      coverDataUrl = getCoverUrl(next) || '';
      toast(desiredStatus === 'published' ? 'Published.' : 'Saved as draft.');
      renderLists();
    }

    function deleteCurrent() {
      if (!editingId) {
        toast('No product selected.');
        return;
      }
      const products = readProductsRaw();
      const next = products.filter(p => String(p && p.id) !== String(editingId));
      writeProductsRaw(next);
      toast('Deleted.');
      clearForm();
      renderLists();
    }

    function setPublished(id, yes) {
      const products = readProductsRaw();
      const idx = products.findIndex(p => String(p && p.id) === String(id));
      if (idx < 0) return;
      const p = products[idx] || {};
      p.status = yes ? 'published' : 'draft';
      p.updatedAt = nowISO();
      products[idx] = p;
      writeProductsRaw(products);
      renderLists();
    }

    function renderListInto(el, items, kind) {
      if (!el) return;
      el.innerHTML = '';

      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'list-item';
        empty.innerHTML = `
          <div>
            <div class="list-title">No ${escapeHtml(kind)}</div>
            <div class="muted">Create a product to see it here.</div>
          </div>
          <div class="row"></div>
        `;
        el.appendChild(empty);
        return;
      }

      items.forEach(p => {
        const row = document.createElement('div');
        row.className = 'list-item';

        const title = String(p.title || 'Untitled');
        const stock = p.stockBySize && typeof p.stockBySize === 'object'
          ? (toInt(p.stockBySize.S) + toInt(p.stockBySize.M) + toInt(p.stockBySize.L) + toInt(p.stockBySize.XL))
          : 0;

        const meta = (kind === 'published')
          ? `Published • Stock: ${stock}`
          : `Draft • Stock: ${stock}`;

        row.innerHTML = `
          <div>
            <div class="list-title">${escapeHtml(title)}</div>
            <div class="muted">${escapeHtml(meta)}</div>
          </div>
          <div class="row"></div>
        `;

        const actions = qs('.row', row);

        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'btn btn-ghost btn-sm';
        edit.textContent = 'Edit';
        edit.addEventListener('click', () => loadProductIntoForm(p));

        const pub = document.createElement('button');
        pub.type = 'button';
        pub.className = (kind === 'published') ? 'btn btn-danger btn-sm' : 'btn btn-primary btn-sm';
        pub.textContent = (kind === 'published') ? 'Unpublish' : 'Publish';
        pub.addEventListener('click', () => {
          setPublished(p.id, kind !== 'published');
          toast(kind === 'published' ? 'Unpublished.' : 'Published.');
          if (String(editingId || '') === String(p.id)) {
            if (status) status.value = (kind === 'published') ? 'draft' : 'published';
            renderTextPreview();
          }
        });

        actions && actions.appendChild(edit);
        actions && actions.appendChild(pub);

        el.appendChild(row);
      });
    }

    function renderLists() {
      const products = readProductsRaw();
      const drafts = products.filter(p => p && !productIsPublished(p));
      const published = products.filter(p => p && productIsPublished(p));
      renderListInto(draftsList, drafts, 'drafts');
      renderListInto(publishedList, published, 'published');
    }

    // Bind input -> preview
    ['input', 'change'].forEach(evt => {
      [name, desc, price, status, sS, sM, sL, sXL].forEach(el => {
        if (!el) return;
        el.addEventListener(evt, renderTextPreview);
      });
    });

    // Bind image picker
    if (fileInput) {
      fileInput.addEventListener('change', async () => {
        try {
          images = await readFiles(fileInput.files);
          coverDataUrl = (images && images[0] && images[0].dataUrl) ? images[0].dataUrl : coverDataUrl;
          renderImages(images);
        } catch {
          toast('Could not read images. Try smaller files.');
        }
      });
    }

    // Override buttons with real actions
    if (saveDraftBtn && !saveDraftBtn.dataset.bound) {
      saveDraftBtn.dataset.bound = '1';
      saveDraftBtn.addEventListener('click', (e) => {
        e.preventDefault();
        try { upsertProduct({ forceStatus: 'draft' }); }
        catch (err) { toast(err && err.message ? err.message : 'Could not save.'); }
      });
    }

    if (publishBtn && !publishBtn.dataset.bound) {
      publishBtn.dataset.bound = '1';
      publishBtn.addEventListener('click', (e) => {
        e.preventDefault();
        try { upsertProduct({ forceStatus: 'published' }); }
        catch (err) { toast(err && err.message ? err.message : 'Could not publish.'); }
      });
    }

    if (deleteBtn && !deleteBtn.dataset.bound) {
      deleteBtn.dataset.bound = '1';
      deleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        deleteCurrent();
      });
    }

    if (topNewBtn && !topNewBtn.dataset.bound) {
      topNewBtn.dataset.bound = '1';
      topNewBtn.addEventListener('click', (e) => {
        e.preventDefault();
        clearForm();
        toast('New product.');
      });
    }

    if (topOpenShopBtn && !topOpenShopBtn.dataset.bound) {
      topOpenShopBtn.dataset.bound = '1';
      topOpenShopBtn.addEventListener('click', (e) => {
        e.preventDefault();
        location.href = '../shop-page.html';
      });
    }

    // Initial
    renderTextPreview();
    renderLists();
  }

  /* ================= Orders helpers (REAL) ================= */
  function readState() {
    const raw = localStorage.getItem(SITE.state);
    const st = raw ? (safeParse(raw) || {}) : {};
    st.ordersByUser = st.ordersByUser || {};
    return st;
  }

  function writeState(next) {
    const obj = next && typeof next === 'object' ? next : {};
    obj.ordersByUser = obj.ordersByUser || {};
    localStorage.setItem(SITE.state, JSON.stringify(obj));
  }

  function flattenOrders() {
    const st = readState();
    const map = (st && st.ordersByUser && typeof st.ordersByUser === 'object') ? st.ordersByUser : {};
    const out = [];

    Object.keys(map).forEach((email) => {
      const arr = map[email];
      if (!Array.isArray(arr)) return;

      arr.forEach((o, idx) => {
        if (!o || typeof o !== 'object') return;
        out.push({
          email: String(email || '').trim().toLowerCase(),
          id: String(o.id || ''),
          createdAt: String(o.createdAt || ''),
          status: normalizeOrderStatus(o.status || 'Placed'),
          totalJMD: Number(o.totalJMD || 0),
          items: Array.isArray(o.items) ? o.items : [],
          _idx: idx,
          raw: o
        });
      });
    });

    out.sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });

    return out;
  }

  function updateOrderStatusInState(email, orderId, newStatus) {
    const em = String(email || '').trim().toLowerCase();
    const oid = String(orderId || '').trim();
    const status = normalizeOrderStatus(newStatus);

    if (!em || !oid) return false;

    const st = readState();
    const map = (st.ordersByUser && typeof st.ordersByUser === 'object') ? st.ordersByUser : {};
    const arr = map[em];

    if (!Array.isArray(arr)) return false;

    const idx = arr.findIndex(o => o && String(o.id || '') === oid);
    if (idx < 0) return false;

    const o = arr[idx] || {};
    o.status = status;
    o.updatedAt = nowISO();
    arr[idx] = o;
    map[em] = arr;
    st.ordersByUser = map;

    writeState(st);
    return true;
  }

  /* ================= Orders page (REAL) ================= */
  function initOrders() {
    const tbody = qs('#ordersTbody');
    if (!tbody) return;

    const search = qs('#orderSearch');
    const users = readSiteUsers();

    // Optional modal (only if your HTML includes it)
    const modal = qs('#orderModal');
    const modalTitle = qs('#orderModalTitle');
    const modalMeta = qs('#orderModalMeta');
    const modalItems = qs('#orderModalItems');
    const modalClose = qs('#orderModalClose');

    let currentQuery = '';
    let currentOpen = { id: '', email: '' };

    function resolveCustomerLabel(email) {
      const em = String(email || '').trim().toLowerCase();
      const u = users[em];
      if (u && u.name) return `${u.name} (${em})`;
      return em || '—';
    }

    function matchesQuery(row, q) {
      const needle = String(q || '').trim().toLowerCase();
      if (!needle) return true;

      const customer = resolveCustomerLabel(row.email).toLowerCase();
      return (
        String(row.id || '').toLowerCase().includes(needle) ||
        String(row.email || '').toLowerCase().includes(needle) ||
        customer.includes(needle)
      );
    }

    function statusSelectHtml(row) {
      const opts = ORDER_STATUSES.map(s => {
        const sel = s.toLowerCase() === String(row.status || '').toLowerCase() ? 'selected' : '';
        return `<option value="${escapeHtml(s)}" ${sel}>${escapeHtml(s)}</option>`;
      }).join('');
      return `
        <select class="input input-sm" data-order-status="1"
          data-order-id="${escapeHtml(row.id)}"
          data-order-email="${escapeHtml(row.email)}"
          aria-label="Order status">
          ${opts}
        </select>
      `;
    }

    function render(list) {
      const rows = Array.isArray(list) ? list : [];
      if (!rows.length) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" class="muted">No orders found.</td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = rows.map((r) => {
        const label = r.id ? `#${escapeHtml(r.id)}` : '—';
        const date = escapeHtml(formatDateShort(r.createdAt));
        const customer = escapeHtml(resolveCustomerLabel(r.email));
        const statusChip = `<span class="chip chip-ok">${escapeHtml(r.status || 'Placed')}</span>`;
        const total = escapeHtml(formatJ(r.totalJMD));

        return `
          <tr>
            <td>${label}</td>
            <td>${date}</td>
            <td>${customer}</td>
            <td>${statusChip}</td>
            <td class="right">${total}</td>
            <td class="right">
              <div class="row" style="justify-content:flex-end;">
                ${statusSelectHtml(r)}
                <button class="btn btn-ghost btn-sm" type="button"
                  data-open-order="1"
                  data-order-id="${escapeHtml(r.id)}"
                  data-order-email="${escapeHtml(r.email)}">Open</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    function getAllFiltered() {
      const all = flattenOrders();
      return currentQuery ? all.filter(o => matchesQuery(o, currentQuery)) : all;
    }

    function rerender() {
      render(getAllFiltered());
      // If a modal is open, refresh it (so status stays in sync)
      if (modal && !modal.hidden && currentOpen.id && currentOpen.email) {
        openModalFor(currentOpen.id, currentOpen.email, { silent: true });
      }
    }

    function openModalFor(orderId, email, opts = {}) {
      const oid = String(orderId || '').trim();
      const em = String(email || '').trim().toLowerCase();
      const silent = !!opts.silent;

      const all = flattenOrders();
      const row =
        all.find(o => String(o.id || '') === oid && String(o.email || '') === em) ||
        all.find(o => String(o.id || '') === oid) ||
        null;

      if (!row) {
        if (!silent) toast('Order not found.');
        return;
      }

      currentOpen = { id: row.id || '', email: row.email || '' };

      // If modal is not present in HTML, fallback
      if (!modal || !modalTitle || !modalMeta || !modalItems) {
        if (!silent) toast(`Order #${row.id} (${row.email}) total ${formatJ(row.totalJMD)} — add modal markup to show details.`);
        return;
      }

      modalTitle.textContent = `Order #${row.id || ''}`;

      const statusControl = `
        <div class="meta-row">
          <span class="muted">Status</span>
          <span>
            <select class="input input-sm" data-order-status="1"
              data-order-id="${escapeHtml(row.id)}"
              data-order-email="${escapeHtml(row.email)}"
              aria-label="Order status">
              ${ORDER_STATUSES.map(s => {
                const sel = s.toLowerCase() === String(row.status || '').toLowerCase() ? 'selected' : '';
                return `<option value="${escapeHtml(s)}" ${sel}>${escapeHtml(s)}</option>`;
              }).join('')}
            </select>
          </span>
        </div>
      `;

      modalMeta.innerHTML = `
        <div class="meta-row"><span class="muted">Date</span><span>${escapeHtml(formatDateShort(row.createdAt))}</span></div>
        <div class="meta-row"><span class="muted">Customer</span><span>${escapeHtml(resolveCustomerLabel(row.email))}</span></div>
        ${statusControl}
        <div class="meta-row"><span class="muted">Total</span><span>${escapeHtml(formatJ(row.totalJMD))}</span></div>
      `;

      if (!row.items.length) {
        modalItems.innerHTML = `<div class="muted">No items found for this order.</div>`;
      } else {
        modalItems.innerHTML = `
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Size</th>
                  <th class="right">Qty</th>
                  <th class="right">Price</th>
                  <th class="right">Line</th>
                </tr>
              </thead>
              <tbody>
                ${row.items.map(it => {
                  const nm = escapeHtml(it.name || it.title || 'Item');
                  const sz = escapeHtml(it.size || '—');
                  const qty = toInt(it.qty || it.quantity || 0);
                  const price = Number(it.price || 0);
                  const line = price * qty;
                  return `
                    <tr>
                      <td>${nm}</td>
                      <td>${sz}</td>
                      <td class="right">${qty}</td>
                      <td class="right">${escapeHtml(formatJ(price))}</td>
                      <td class="right">${escapeHtml(formatJ(line))}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      modal.hidden = false;
      document.body.classList.add('modal-open');
    }

    function closeModal() {
      if (!modal) return;
      modal.hidden = true;
      document.body.classList.remove('modal-open');
      currentOpen = { id: '', email: '' };
    }

    // Initial render
    render(flattenOrders());

    // Search
    if (search && !search.dataset.bound) {
      search.dataset.bound = '1';
      search.addEventListener('input', () => {
        currentQuery = String(search.value || '').trim();
        rerender();
      });
    }

    // Open (button)
    if (!tbody.dataset.bound) {
      tbody.dataset.bound = '1';
      tbody.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-open-order="1"]') : null;
        if (!btn) return;
        const oid = btn.getAttribute('data-order-id') || '';
        const em = btn.getAttribute('data-order-email') || '';
        openModalFor(oid, em);
      });

      // Status change (dropdown) — delegated
      tbody.addEventListener('change', (e) => {
        const sel = e.target && e.target.closest ? e.target.closest('[data-order-status="1"]') : null;
        if (!sel) return;

        const oid = sel.getAttribute('data-order-id') || '';
        const em = sel.getAttribute('data-order-email') || '';
        const next = sel.value;

        const ok = updateOrderStatusInState(em, oid, next);
        if (!ok) {
          toast('Could not update status.');
          rerender();
          return;
        }

        toast('Status updated.');
        rerender();
      });
    }

    // Modal close
    if (modalClose && !modalClose.dataset.bound) {
      modalClose.dataset.bound = '1';
      modalClose.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal();
      });
    }

    if (modal && !modal.dataset.bound) {
      modal.dataset.bound = '1';
      modal.addEventListener('click', (e) => {
        const panel = qs('.modal-panel', modal);
        if (panel && !panel.contains(e.target)) closeModal();
      });

      // Status change inside modal (dropdown) — delegated
      modal.addEventListener('change', (e) => {
        const sel = e.target && e.target.closest ? e.target.closest('[data-order-status="1"]') : null;
        if (!sel) return;

        const oid = sel.getAttribute('data-order-id') || '';
        const em = sel.getAttribute('data-order-email') || '';
        const next = sel.value;

        const ok = updateOrderStatusInState(em, oid, next);
        if (!ok) {
          toast('Could not update status.');
          rerender();
          return;
        }

        toast('Status updated.');
        rerender();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && !modal.hidden) closeModal();
    });
  }

  /* ================= Dashboard helpers ================= */
  function parseDateInput(value) {
    const v = String(value || '').trim();
    if (!v) return null;
    const t = new Date(v + 'T00:00:00').getTime();
    return Number.isFinite(t) ? new Date(t) : null;
  }

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function endOfDay(d) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  function inRangeISO(iso, start, end) {
    const t = new Date(iso || 0).getTime();
    if (!Number.isFinite(t)) return false;
    return t >= start.getTime() && t <= end.getTime();
  }

  /* ================= Dashboard (REAL) ================= */
  function initDashboard() {
    const revEl = qs('#statRevenueValue');
    if (!revEl) return;

    const ordersEl = qs('#statOrdersValue');
    const customersEl = qs('#statCustomersValue');
    const lowEl = qs('#statLowStockValue');

    const revSub = qs('#statRevenueSub');
    const ordersSub = qs('#statOrdersSub');
    const customersSub = qs('#statCustomersSub');
    const lowSub = qs('#statLowStockSub');

    const preset = qs('#rangePreset');
    const startInput = qs('#rangeStart');
    const endInput = qs('#rangeEnd');
    const applyBtn = qs('#applyRangeBtn');
    const tbody = qs('#recentOrdersTbody');

    const users = readSiteUsers();
    const products = readProductsRaw();
    const settings = readAdminSettings();

    function fmtDate(d) {
      const x = new Date(d);
      return x.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });
    }

    function sumRevenue(rows) {
      return rows.reduce((sum, r) => sum + Number(r.totalJMD || 0), 0);
    }

    function defaultRange() {
      const today = new Date();
      const s = startOfDay(today);
      const e = endOfDay(today);
      return { start: s, end: e };
    }

    function setInputsFromRange(r) {
      if (startInput) startInput.valueAsDate = startOfDay(r.start);
      if (endInput) endInput.valueAsDate = startOfDay(r.end);
    }

    function deriveRangeFromPreset(p) {
      const today = new Date();
      const t0 = startOfDay(today);
      const t1 = endOfDay(today);

      if (p === 'today') return { start: t0, end: t1 };
      if (p === 'yesterday') {
        const y = new Date(t0);
        y.setDate(y.getDate() - 1);
        return { start: startOfDay(y), end: endOfDay(y) };
      }
      if (p === 'last7') {
        const s = new Date(t0);
        s.setDate(s.getDate() - 6);
        return { start: startOfDay(s), end: t1 };
      }
      if (p === 'last30') {
        const s = new Date(t0);
        s.setDate(s.getDate() - 29);
        return { start: startOfDay(s), end: t1 };
      }
      if (p === 'thisMonth') {
        const s = new Date(today.getFullYear(), today.getMonth(), 1);
        const e = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        return { start: startOfDay(s), end: endOfDay(e) };
      }
      if (p === 'custom') {
        const r = getRangeFromInputs();
        return r;
      }
      return null;
    }

    function getRangeFromInputs() {
      const s = parseDateInput(startInput?.value);
      const e = parseDateInput(endInput?.value);
      if (!s || !e) return defaultRange();
      const start = startOfDay(s);
      const end = endOfDay(e);
      if (start.getTime() > end.getTime()) return defaultRange();
      return { start, end };
    }

    function previousRange(curr) {
      const ms = curr.end.getTime() - curr.start.getTime();
      const prevEnd = new Date(curr.start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - ms);
      return { start: startOfDay(prevStart), end: endOfDay(prevEnd) };
    }

    function pctChange(curr, prev) {
      const a = Number(curr || 0);
      const b = Number(prev || 0);
      if (b <= 0) return null;
      return ((a - b) / b) * 100;
    }

    function renderRecentOrders(allOrders) {
      if (!tbody) return;

      const rows = allOrders.slice(0, 4);
      if (!rows.length) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4" class="muted">No orders yet.</td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = rows.map((r) => {
        const u = users[r.email];
        const customer = u && u.name ? `${u.name} (${r.email})` : r.email;
        return `
          <tr>
            <td>#${escapeHtml(r.id)}</td>
            <td>${escapeHtml(customer)}</td>
            <td><span class="chip chip-ok">${escapeHtml(r.status || 'Placed')}</span></td>
            <td class="right">${escapeHtml(formatJ(r.totalJMD))}</td>
          </tr>
        `;
      }).join('');
    }

    function renderForRange(range) {
      const all = flattenOrders();
      const inRange = all.filter(o => inRangeISO(o.createdAt, range.start, range.end));

      const revenue = sumRevenue(inRange);
      const ordersCount = inRange.length;

      const prev = previousRange(range);
      const prevInRange = all.filter(o => inRangeISO(o.createdAt, prev.start, prev.end));
      const prevRevenue = sumRevenue(prevInRange);

      const chg = pctChange(revenue, prevRevenue);

      // Customers (non-admin)
      const customerEmails = Object.keys(users).filter(em => String(users[em]?.role || '').toLowerCase() !== 'admin');
      const totalCustomers = customerEmails.length;
      const newCustomers = customerEmails.filter(em => {
        const createdAt = users[em]?.createdAt;
        return createdAt ? inRangeISO(createdAt, range.start, range.end) : false;
      }).length;

      // Low stock
      const lowCount = (function () {
        const thr = Number(settings.lowStockThreshold || 0);
        let count = 0;
        products.forEach((p) => {
          if (!p || p.isActive === false) return;
          const sb = (p.stockBySize && typeof p.stockBySize === 'object') ? p.stockBySize : {};
          const total = toInt(sb.S) + toInt(sb.M) + toInt(sb.L) + toInt(sb.XL);
          if (total <= thr) count += 1;
        });
        return count;
      })();

      if (revEl) revEl.textContent = formatJ(revenue);
      if (ordersEl) ordersEl.textContent = String(ordersCount);
      if (customersEl) customersEl.textContent = String(totalCustomers);
      if (lowEl) lowEl.textContent = String(lowCount);

      if (revSub) {
        if (chg == null) revSub.textContent = `Range: ${fmtDate(range.start)} – ${fmtDate(range.end)}`;
        else {
          const sign = chg >= 0 ? '+' : '';
          revSub.textContent = `${sign}${chg.toFixed(1)}% vs previous period`;
        }
      }

      if (ordersSub) ordersSub.textContent = `Range: ${fmtDate(range.start)} – ${fmtDate(range.end)}`;
      if (customersSub) customersSub.textContent = `New in range: ${newCustomers}`;
      if (lowSub) lowSub.textContent = `≤ ${Number(settings.lowStockThreshold)} in stock`;

      renderRecentOrders(all);
    }

    function applyPresetValue() {
      const p = String(preset?.value || '').trim();
      const r = deriveRangeFromPreset(p);
      if (!r) return;
      setInputsFromRange(r);
      renderForRange(r);
    }

    if (preset && !preset.dataset.bound) {
      preset.dataset.bound = '1';
      preset.addEventListener('change', () => {
        applyPresetValue();
      });
    }

    if (applyBtn && !applyBtn.dataset.bound) {
      applyBtn.dataset.bound = '1';
      applyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const r = getRangeFromInputs();
        renderForRange(r);
      });
    }

    // Initial
    if (preset && preset.value) applyPresetValue();
    else {
      const r = defaultRange();
      setInputsFromRange(r);
      renderForRange(r);
    }
  }

  /* ================= Customers (REAL) ================= */
  function initCustomers() {
    const tbody = qs('#customersTbody');
    if (!tbody) return;

    const search = qs('#customerSearch');
    const users = readSiteUsers();
    const orders = flattenOrders();

    const byEmailOrders = new Map();
    orders.forEach((o) => {
      const em = String(o.email || '').trim().toLowerCase();
      if (!byEmailOrders.has(em)) byEmailOrders.set(em, []);
      byEmailOrders.get(em).push(o);
    });

    const rows = Object.keys(users)
      .map((em) => {
        const u = users[em];
        const role = String(u?.role || '').toLowerCase();
        return { em: String(em).toLowerCase(), user: u, role };
      })
      .filter(r => r.user && r.role !== 'admin')
      .map((r) => {
        const list = byEmailOrders.get(r.em) || [];
        const count = list.length;
        const total = list.reduce((sum, o) => sum + Number(o.totalJMD || 0), 0);
        return {
          email: r.em,
          name: String(r.user.name || '').trim() || '—',
          orders: count,
          ltv: total
        };
      })
      .sort((a, b) => b.ltv - a.ltv);

    function matches(row, q) {
      const needle = String(q || '').trim().toLowerCase();
      if (!needle) return true;
      return (
        row.email.includes(needle) ||
        String(row.name || '').toLowerCase().includes(needle)
      );
    }

    function render(list) {
      if (!list.length) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" class="muted">No customers found.</td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = list.map((r) => {
        return `
          <tr>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.email)}</td>
            <td>${escapeHtml(String(r.orders))}</td>
            <td class="right">${escapeHtml(formatJ(r.ltv))}</td>
            <td class="right">
              <button class="btn btn-ghost btn-sm" type="button" data-action="toast"
                data-toast="Customer details view is next.">Open</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    render(rows);

    if (search && !search.dataset.bound) {
      search.dataset.bound = '1';
      search.addEventListener('input', () => {
        const q = String(search.value || '');
        render(rows.filter(r => matches(r, q)));
      });
    }
  }

  /* ================= Settings (REAL) ================= */
  function initSettings() {
    const form = qs('#adminSettingsForm');
    if (!form) return;

    const themeSelect = qs('#adminThemeSelect', form);
    const lowStockInput = qs('#lowStockThreshold', form);

    function hydrate() {
      const t = readTheme();
      if (themeSelect) themeSelect.value = (t === 'light' ? 'light' : 'dark');

      const st = readAdminSettings();
      if (lowStockInput) lowStockInput.value = String(st.lowStockThreshold);
    }

    function save() {
      const nextTheme = String(themeSelect?.value || '').toLowerCase() === 'light' ? 'light' : 'dark';
      applyTheme(nextTheme);

      const n = Number(lowStockInput?.value);
      const lowStockThreshold = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 3;
      writeAdminSettings({ lowStockThreshold });
      toast('Settings saved.');
    }

    function reset() {
      localStorage.removeItem(ADMIN.theme);
      localStorage.removeItem(ADMIN.settings);
      applyTheme(readTheme());
      hydrate();
      toast('Settings reset.');
    }

    if (!form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        save();
      });
    }

    const resetBtn = qs('[data-action="settings-reset"]');
    if (resetBtn && !resetBtn.dataset.bound) {
      resetBtn.dataset.bound = '1';
      resetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        reset();
      });
    }

    hydrate();
  }

  /* ================= Init ================= */
  applyTheme(readTheme());
  setYear();
  requireAdminGate();
  hydrateAdminName();
  syncActiveNav();
  bindDelegatedActions();
  initProductsManager();
  initDashboard();
  initOrders();
  initCustomers();
  initSettings();
})();
