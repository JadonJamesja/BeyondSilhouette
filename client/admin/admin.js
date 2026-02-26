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

'use strict';

const SITE = {
  session: 'bs_session_v1',
  users: 'bs_users_v1',
  products: 'bs_products_v1',
  state: 'bs_state_v1'
};

const ADMIN = {
  theme: 'bs_admin_theme',
  settings: 'bs_admin_settings_v1',
  sidebar: 'bs_admin_sidebar_v1' // NEW: persist desktop collapse across pages
};

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

/* ================= Sidebar persistence + active nav ================= */
function readSidebarPref() {
  return localStorage.getItem(ADMIN.sidebar) === 'collapsed';
}

function writeSidebarPref(isCollapsed) {
  if (isCollapsed) localStorage.setItem(ADMIN.sidebar, 'collapsed');
  else localStorage.removeItem(ADMIN.sidebar);
}

function applySidebarPref() {
  if (!document.body) return;

  // Mobile uses overlay drawer; never persist overlay-open
  const isMobile = !!(window.matchMedia && window.matchMedia('(max-width: 920px)').matches);

  // Always clear mobile overlay state on load + breakpoint changes
  document.body.classList.remove('sidebar-open');

  if (isMobile) {
    document.body.classList.remove('sidebar-collapsed');
    return;
  }

  if (readSidebarPref()) document.body.classList.add('sidebar-collapsed');
  else document.body.classList.remove('sidebar-collapsed');
}

function bindSidebarMediaListener() {
  if (!window.matchMedia) return;
  const mql = window.matchMedia('(max-width: 920px)');
  const onChange = () => applySidebarPref();
  if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
  else if (typeof mql.addListener === 'function') mql.addListener(onChange);
}

function highlightActiveNav() {
  const path = location.pathname.replace(/\\/g, '/');
  const current = (path.split('/').pop() || '').toLowerCase();

  qsa('nav.nav a.nav-item[href]').forEach(a => {
    const href = (a.getAttribute('href') || '').split('/').pop().toLowerCase();
    if (href && href === current) {
      a.classList.add('active');
      a.setAttribute('aria-current', 'page');
    } else {
      a.classList.remove('active');
      a.removeAttribute('aria-current');
    }
  });
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
        document.body.classList.toggle('sidebar-collapsed');
        writeSidebarPref(document.body.classList.contains('sidebar-collapsed'));
      }
      return;
    }

   if (action === 'logout') {
  e.preventDefault();
  Promise.resolve(logoutSite()).finally(() => {
    location.href = '../login.html';
  });
  return;
}

    if (action === 'toast') {
      e.preventDefault();
      toast(el.getAttribute('data-toast') || 'Done.');
      return;
    }
  });
}

// ===== PRODUCTS (DB-backed instead of bs_products_v1 localStorage) =====

async function apiAdminJSON(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

async function apiListAdminProducts() {
  const data = await apiAdminJSON("https://bs-api-live.up.railway.app/api/admin/products", { method: "GET" });
  return Array.isArray(data?.products) ? data.products : [];
}

async function apiCreateAdminProduct(payload) {
  const data = await apiAdminJSON("https://bs-api-live.up.railway.app/api/admin/products", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data?.product || null;
}

async function apiUpdateAdminProduct(id, payload) {
  const data = await apiAdminJSON(
    `https://bs-api-live.up.railway.app/api/admin/products/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
  return data?.product || null;
}

// DB -> UI shape (admin UI expects title/status/media/stockBySize)
function toUIProduct(db) {
  const inv = Array.isArray(db?.inventory) ? db.inventory : [];
  const stockBySize = { S: 0, M: 0, L: 0, XL: 0 };
  for (const row of inv) {
    const k = String(row?.size || "").trim().toUpperCase();
    if (k in stockBySize) stockBySize[k] = Number(row?.stock || 0);
  }

  const images = Array.isArray(db?.images) ? db.images : [];
  const coverUrl = images[0]?.url ? String(images[0].url) : "";

  return {
    id: db.id,
    title: db.name || "",
    description: db.description || "",
    priceJMD: db.priceJMD ?? 0,
    status: db.isPublished ? "published" : "draft",
    media: { coverUrl },
    stockBySize,
  };
}

// UI -> DB payload (backend expects name/isPublished)
function toDBPayload(ui) {
  const name = String(ui?.title || "").trim();
  const description = String(ui?.description || "").trim();
  const priceJMD = Number(ui?.priceJMD || 0);
  const isPublished = String(ui?.status || "draft") === "published";

  const coverUrl = String(ui?.media?.coverUrl || "").trim();
  const images = coverUrl ? [{ url: coverUrl, alt: name || null, sortOrder: 0 }] : [];

  const sb = ui?.stockBySize || {};
  const inventory = ["S", "M", "L", "XL"].map((size) => ({
    size,
    stock: Number(sb[size] || 0),
  }));

  return { name, description, priceJMD, isPublished, images, inventory };
}

// Replaces old readProductsRaw()
async function readProductsRaw() {
  const dbProducts = await apiListAdminProducts();
  return dbProducts.map(toUIProduct);
}

// Old writeProductsRaw becomes no-op (DB is truth)
function writeProductsRaw(_) { }

// Replaces old upsertProduct()
async function upsertProduct(product) {
  const ui = product || {};
  const payload = toDBPayload(ui);

  if (!payload.name) throw new Error("Title is required.");

  if (!ui.id) {
    const created = await apiCreateAdminProduct(payload);
    if (!created) throw new Error("Create failed.");
    return toUIProduct(created);
  }

  const updated = await apiUpdateAdminProduct(ui.id, payload);
  if (!updated) throw new Error("Update failed.");
  return toUIProduct(updated);
}
// Publish/unpublish via PATCH (DB-backed)
async function setPublished(id, yes) {
  const pid = String(id || '').trim();
  if (!pid) throw new Error('Missing product id.');

  // Minimal PATCH that only toggles publish
  const payload = { isPublished: !!yes };

  const data = await apiAdminJSON(
    `https://bs-api-live.up.railway.app/api/admin/products/${encodeURIComponent(pid)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );

  if (!data?.product) throw new Error("Publish update failed.");
  return toUIProduct(data.product);
}


/* ================= Products Manager (products.html) ================= */
async function initProductsManager() {
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

    coverDataUrl = (p && p.media && p.media.coverUrl) ? String(p.media.coverUrl) : '';
    images = coverDataUrl ? [{ name: 'cover', dataUrl: coverDataUrl }] : [];
    renderImages(images);
    renderTextPreview();
  }

  // --- DB/API-backed save/publish/delete/list for Products page ---

  async function saveCurrentProduct({ forceStatus } = {}) {
    const title = (name?.value || "").trim();
    if (!title) throw new Error("Please enter a product name.");

    const desiredStatus =
      forceStatus ||
      (String(status?.value || "").toLowerCase() === "published" ? "published" : "draft");

    const stockBySize = readStockBySizeFromForm();

    // NOTE: your current UI stores images as dataURLs.
    // For now we will store the FIRST image dataUrl as coverUrl.
    // (Not ideal long-term, but it gets DB-backed products working immediately.)
    const coverUrl =
      (images && images[0] && images[0].dataUrl) ? images[0].dataUrl : (coverDataUrl || "");

    const payloadUI = {
      id: editingId || null,
      title,
      description: String(desc?.value || ""),
      priceJMD: toPriceJMD(price?.value),
      status: desiredStatus,
      media: { coverUrl },
      stockBySize
    };

    // IMPORTANT: call the OUTER async upsertProduct() (DB-backed).
    // We named this saveCurrentProduct to avoid shadowing.
    const saved = await upsertProduct(payloadUI);

    // Update editor state from saved result
    editingId = String(saved.id || "");
    if (status) status.value = String(saved.status || "draft");
    coverDataUrl = (saved.media && saved.media.coverUrl) ? String(saved.media.coverUrl) : coverDataUrl;

    toast(desiredStatus === "published" ? "Published to DB ✅" : "Saved to DB ✅");
    await renderLists();
    return saved;
  }

  async function deleteCurrent() {
    // You do not have a server delete endpoint yet.
    // Don’t fake-delete locally (it will confuse production).
    if (!editingId) {
      toast("No product selected.");
      return;
    }
    toast("Delete is not implemented on the server yet.");
  }

  async function setPublishedUI(id, yes) {
    // IMPORTANT: call the OUTER async setPublished() (DB-backed).
    await setPublished(id, !!yes);
    await renderLists();
  }

  function renderListInto(listEl, items, kind) {
    if (!listEl) return;

    if (!Array.isArray(items) || items.length === 0) {
      listEl.innerHTML = `<div class="muted" style="padding:12px;">No ${kind} products.</div>`;
      return;
    }

    listEl.innerHTML = items.map((p) => {
      const title = escapeHtml(p.title || "Untitled");
      const price = formatJ(p.priceJMD || 0);
      const badge = (String(p.status || "").toLowerCase() === "published")
        ? `<span class="chip chip-ok">Published</span>`
        : `<span class="chip">Draft</span>`;

      return `
      <div class="list-item" data-id="${escapeHtml(p.id)}" style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
        <div style="min-width:0;">
          <div class="list-title">${title}</div>
          <div class="muted" style="font-size:12.5px;">${escapeHtml(price)}</div>
        </div>
        <div class="row" style="gap:10px;">
          ${badge}
          <button type="button" class="btn btn-ghost btn-sm" data-action="edit">Edit</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="toggle">
            ${kind === "published" ? "Unpublish" : "Publish"}
          </button>
        </div>
      </div>
    `;
    }).join("");

    // Bind actions
    qsa(".list-item", listEl).forEach((row) => {
      const id = row.getAttribute("data-id");

      const editBtn = qs('[data-action="edit"]', row);
      if (editBtn) {
        editBtn.addEventListener("click", () => {
          const p = items.find(x => String(x.id) === String(id));
          if (!p) return;
          loadProductIntoForm(p);
          toast("Loaded.");
        });
      }

      const toggleBtn = qs('[data-action="toggle"]', row);
      if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
          (async () => {
            try {
              await setPublishedUI(id, kind !== "published");
              toast(kind === "published" ? "Unpublished ✅" : "Published ✅");
            } catch (err) {
              toast(err?.message || "Could not update publish state.");
            }
          })();
        });
      }
    });
  }

  async function renderLists() {
    if (draftsList) draftsList.innerHTML = `<div class="muted" style="padding:12px;">Loading…</div>`;
    if (publishedList) publishedList.innerHTML = `<div class="muted" style="padding:12px;">Loading…</div>`;

    // Always fetch from DB on page load/refresh
    const data = await apiAdminJSON("https://bs-api-live.up.railway.app/api/admin/products", { method: "GET" });
    const db = Array.isArray(data?.products) ? data.products : [];

    // Convert DB -> your UI shape
    const products = db.map(toUIProduct);

    const drafts = products.filter(p => String(p?.status || "").toLowerCase() !== "published");
    const published = products.filter(p => String(p?.status || "").toLowerCase() === "published");

    renderListInto(draftsList, drafts, "drafts");
    renderListInto(publishedList, published, "published");
  }

  // Bind input -> preview (run once)
  ['input', 'change'].forEach(evt => {
    [name, desc, price, status, sS, sM, sL, sXL].forEach(el => {
      if (!el) return;
      el.addEventListener(evt, renderTextPreview);
    });
  });

  // Bind image picker (run once)
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

  // Override buttons with real actions (run once)
  if (saveDraftBtn && !saveDraftBtn.dataset.bound) {
    saveDraftBtn.dataset.bound = '1';
    saveDraftBtn.addEventListener('click', (e) => {
      e.preventDefault();
      (async () => {
        try { await saveCurrentProduct({ forceStatus: "draft" }); }
        catch (err) { toast(err && err.message ? err.message : "Could not save."); }
      })();
    });
  }

  if (publishBtn && !publishBtn.dataset.bound) {
    publishBtn.dataset.bound = '1';
    publishBtn.addEventListener('click', (e) => {
      e.preventDefault();
      (async () => {
        try { await saveCurrentProduct({ forceStatus: "published" }); }
        catch (err) { toast(err && err.message ? err.message : "Could not publish."); }
      })();
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
  // Initial load of DB products when page opens
  await renderLists();
}

/* ================= Orders helpers (REAL) ================= */
function readState() {
  const raw = localStorage.getItem(SITE.state);
  const st = raw ? (safeParse(raw) || {}) : {};
  st.ordersByUser = st.ordersByUser || {};
  return st;
}
function writeState(st) {
  const obj = (st && typeof st === 'object') ? st : {};
  if (!obj.ordersByUser || typeof obj.ordersByUser !== 'object') {
    obj.ordersByUser = {};
  }
  localStorage.setItem(SITE.state, JSON.stringify(obj));
}

function setOrderStatusInState(email, orderId, nextStatus, actor) {
  const em = String(email || '').trim().toLowerCase();
  const oid = String(orderId || '').trim();
  const status = String(nextStatus || '').trim() || 'Placed';

  if (!em || !oid) return false;

  const st = readState();
  const list = Array.isArray(st.ordersByUser[em]) ? st.ordersByUser[em] : [];
  const idx = list.findIndex(o => o && String(o.id || '') === oid);

  if (idx < 0) return false;

  const order = list[idx];
  const prev = String(order.status || 'Placed');

  // Avoid spam entries if status didn’t actually change
  if (prev === status) return true;

  // Ensure history array exists
  if (!Array.isArray(order.history)) order.history = [];

  // Who changed it?
  const by = actor && actor.by ? String(actor.by) : 'admin';
  const at = new Date().toISOString();

  order.history.push({ at, by, from: prev, to: status });

  // Update status
  order.status = status;

  list[idx] = order;
  st.ordersByUser[em] = list;
  writeState(st);

  return true;
}

function flattenOrders() {
  const st = readState();
  const map = (st && st.ordersByUser && typeof st.ordersByUser === 'object') ? st.ordersByUser : {};
  const out = [];

  Object.keys(map).forEach((email) => {
    const arr = map[email];
    if (!Array.isArray(arr)) return;

    arr.forEach((o) => {
      if (!o || typeof o !== 'object') return;
      out.push({
        email: String(email || '').trim().toLowerCase(),
        id: String(o.id || ''),
        createdAt: String(o.createdAt || ''),
        status: String(o.status || 'Placed'),
        totalJMD: Number(o.totalJMD || 0),
        items: Array.isArray(o.items) ? o.items : [],
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

function getAdminActor() {
  const u = getCurrentUser();
  const email = u && u.email ? String(u.email).trim().toLowerCase() : 'admin';
  const name = u && u.name ? String(u.name).trim() : '';
  return { by: name ? `${name} (${email})` : email };
}

/* ================= Orders page (REAL) ================= */
function initOrders() {
  const tbody = qs('#ordersTbody');
  if (!tbody) return;

  const search = qs('#orderSearch');
  const users = readSiteUsers();

  // Keep a mutable list so we can refresh it after status changes
  let all = flattenOrders();

  // Optional modal (only if your HTML includes it)
  const modal = qs('#orderModal');
  const modalTitle = qs('#orderModalTitle');
  const modalMeta = qs('#orderModalMeta');
  const modalItems = qs('#orderModalItems');
  const modalHistory = qs('#orderModalHistory');
  const modalClose = qs('#orderModalClose');

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

  function render(rows) {
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
      const st = String(r.status || 'Placed').trim();
      const stKey = st.toLowerCase();
      const stClass =
        stKey === 'delivered' ? 'chip-delivered' :
          stKey === 'shipped' ? 'chip-shipped' :
            stKey === 'processing' ? 'chip-processing' :
              stKey === 'cancelled' ? 'chip-cancelled' :
                'chip-placed';

      const statusHtml = `<span class="chip chip-status ${stClass}">${escapeHtml(st)}</span>`;
      const total = escapeHtml(formatJ(r.totalJMD));

      return `
          <tr>
            <td>${label}</td>
            <td>${date}</td>
            <td>${customer}</td>
            <td>${statusHtml}</td>
            <td class="right">${total}</td>
            <td class="right">
              <select class="input input-sm"
                data-order-status="1"
                data-order-id="${escapeHtml(r.id)}"
                data-order-email="${escapeHtml(r.email)}">
                <option value="Placed" ${String(r.status || 'Placed') === 'Placed' ? 'selected' : ''}>Placed</option>
                <option value="Processing" ${String(r.status || '') === 'Processing' ? 'selected' : ''}>Processing</option>
                <option value="Shipped" ${String(r.status || '') === 'Shipped' ? 'selected' : ''}>Shipped</option>
                <option value="Delivered" ${String(r.status || '') === 'Delivered' ? 'selected' : ''}>Delivered</option>
                <option value="Cancelled" ${String(r.status || '') === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
              </select>

              <button class="btn btn-ghost btn-sm" type="button"
                data-open-order="1"
                data-order-id="${escapeHtml(r.id)}"
                data-order-email="${escapeHtml(r.email)}">Open</button>
            </td>
          </tr>
        `;
    }).join('');
  }

  function renderHistoryInto(row) {
    if (!modalHistory) return;

    // Clear every time (prevents duplicate sections / stale content)
    modalHistory.innerHTML = '';

    const hist = Array.isArray(row?.raw?.history) ? row.raw.history : [];
    if (!hist.length) {
      modalHistory.innerHTML = `<div class="muted">No status changes yet.</div>`;
      return;
    }

    // Reverse so newest first
    const items = hist.slice().reverse();

    modalHistory.innerHTML = `
        <div class="panel" style="display:grid; gap:10px;">
          ${items.map(h => {
      const when = escapeHtml(formatDateShort(h.at));
      const by = escapeHtml(h.by || 'admin');
      const from = escapeHtml(h.from || '—');
      const to = escapeHtml(h.to || '—');
      return `
              <div class="meta-row" style="align-items:flex-start;">
                <div style="display:grid; gap:4px;">
                  <div><strong>${from}</strong> → <strong>${to}</strong></div>
                  <div class="muted" style="font-size:12.5px;">${when} • ${by}</div>
                </div>
              </div>
            `;
    }).join('')}
        </div>
      `;
  }

  function openModalFor(orderId, email) {
    const oid = String(orderId || '').trim();
    const em = String(email || '').trim().toLowerCase();

    // Refresh from storage so modal sees latest history every time
    all = flattenOrders();

    const row =
      all.find(o => String(o.id || '') === oid && String(o.email || '') === em) ||
      all.find(o => String(o.id || '') === oid) ||
      null;

    if (!row) {
      toast('Order not found.');
      return;
    }

    // If modal is not present in HTML, fallback
    if (!modal || !modalTitle || !modalMeta || !modalItems) {
      toast(`Order #${row.id} (${row.email}) total ${formatJ(row.totalJMD)} — add modal markup to show details.`);
      return;
    }

    modalTitle.textContent = `Order #${row.id || ''}`;
    modalMeta.innerHTML = `
        <div class="meta-row"><span class="muted">Date</span><span>${escapeHtml(formatDateShort(row.createdAt))}</span></div>
        <div class="meta-row"><span class="muted">Customer</span><span>${escapeHtml(resolveCustomerLabel(row.email))}</span></div>
        <div class="meta-row"><span class="muted">Status</span><span>${escapeHtml(row.status || 'Placed')}</span></div>
        <div class="meta-row"><span class="muted">Total</span><span>${escapeHtml(formatJ(row.totalJMD))}</span></div>
      `;

    // Items
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

    // History (if present)
    renderHistoryInto(row);

    modal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  // Initial render
  render(all);

  // Search
  if (search && !search.dataset.bound) {
    search.dataset.bound = '1';
    search.addEventListener('input', () => {
      const q = String(search.value || '');
      render(all.filter(row => matchesQuery(row, q)));
    });
  }

  // Open button
  if (!tbody.dataset.bound) {
    tbody.dataset.bound = '1';
    tbody.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-open-order="1"]') : null;
      if (!btn) return;
      const oid = btn.getAttribute('data-order-id') || '';
      const em = btn.getAttribute('data-order-email') || '';
      openModalFor(oid, em);
    });
  }

  // Status change (dropdown)
  if (!tbody.dataset.boundStatus) {
    tbody.dataset.boundStatus = '1';
    tbody.addEventListener('change', (e) => {
      const sel = e.target && e.target.closest ? e.target.closest('[data-order-status="1"]') : null;
      if (!sel) return;

      const oid = sel.getAttribute('data-order-id') || '';
      const em = sel.getAttribute('data-order-email') || '';
      const nextStatus = String(sel.value || '').trim() || 'Placed';

      const ok = setOrderStatusInState(em, oid, nextStatus, getAdminActor());
      if (!ok) {
        toast('Could not update status.');
        return;
      }

      // Refresh list from storage (so history + status are accurate everywhere)
      all = flattenOrders();

      const q = String(search?.value || '');
      render(all.filter(r => matchesQuery(r, q)));

      toast(`Status: ${nextStatus}`);
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
  const products = [];
  readProductsRaw()
    .then((list) => {
      products.splice(0, products.length, ...(Array.isArray(list) ? list : []));
      // Re-render after products load
      const r = defaultRange();
      setInputsFromRange(r);
      renderForRange(r);
    })
    .catch(() => {
      // ignore; dashboard can still render without product counts
    });
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

  // Optional modals (only if your HTML includes them)
  const cusModal = qs('#customerModal');
  const cusModalTitle = qs('#customerModalTitle');
  const cusModalMeta = qs('#customerModalMeta');
  const cusModalOrders = qs('#customerModalOrders');
  const cusModalClose = qs('#customerModalClose');

  // Reused order modal (if present on this page)
  const ordModal = qs('#orderModal');
  const ordModalTitle = qs('#orderModalTitle');
  const ordModalMeta = qs('#orderModalMeta');
  const ordModalItems = qs('#orderModalItems');
  const ordModalHistory = qs('#orderModalHistory');
  const ordModalClose = qs('#orderModalClose');

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

  function resolveCustomerName(email) {
    const em = String(email || '').trim().toLowerCase();
    const u = users[em];
    const nm = u && u.name ? String(u.name).trim() : '';
    return nm || '—';
  }

  function openCustomerModal(email) {
    const em = String(email || '').trim().toLowerCase();
    const u = users[em] || null;
    const list = byEmailOrders.get(em) || [];
    const count = list.length;
    const total = list.reduce((sum, o) => sum + Number(o.totalJMD || 0), 0);

    if (!cusModal || !cusModalTitle || !cusModalMeta || !cusModalOrders) {
      // Fallback if modal markup isn't present
      toast(`${resolveCustomerName(em)} (${em}) • Orders: ${count} • LTV: ${formatJ(total)}`);
      return;
    }

    const displayName = (u && u.name) ? String(u.name).trim() : 'Customer';
    cusModalTitle.textContent = displayName;

    cusModalMeta.innerHTML = `
        <div class="meta-row"><span class="muted">Name</span><span>${escapeHtml(displayName || '—')}</span></div>
        <div class="meta-row"><span class="muted">Email</span><span>${escapeHtml(em || '—')}</span></div>
        <div class="meta-row"><span class="muted">Total orders</span><span>${escapeHtml(String(count))}</span></div>
        <div class="meta-row"><span class="muted">Lifetime value</span><span>${escapeHtml(formatJ(total))}</span></div>
      `;

    const recent = list.slice(0, 8);
    if (!recent.length) {
      cusModalOrders.innerHTML = `<div class="muted">No orders yet.</div>`;
    } else {
      cusModalOrders.innerHTML = `
          <div class="modal-orders">
            ${recent.map(o => {
        const oid = String(o.id || '');
        const when = formatDateShort(o.createdAt);
        const st = String(o.status || 'Placed');
        const tot = formatJ(o.totalJMD);
        return `
                <div class="modal-order-row">
                  <div class="modal-order-main">
                    <div class="modal-order-title">#${escapeHtml(oid || '—')}</div>
                    <div class="modal-order-sub">${escapeHtml(when)} • ${escapeHtml(st)}</div>
                  </div>
                  <div class="row modal-order-actions">
                    <span class="badge badge-soft">${escapeHtml(tot)}</span>
                    <button class="btn btn-ghost btn-sm" type="button" data-open-order="1"
                      data-order-id="${escapeHtml(oid)}" data-order-email="${escapeHtml(em)}">Open</button>
                  </div>
                </div>
              `;
      }).join('')}
          </div>
        `;
    }

    cusModal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeCustomerModal() {
    if (!cusModal) return;
    cusModal.hidden = true;
    // Only remove modal-open if no other modal is visible
    const anyOpen = qsa('.modal-overlay').some(m => m && !m.hasAttribute('hidden'));
    if (!anyOpen) document.body.classList.remove('modal-open');
  }

  function renderOrderHistoryIntoModal(row) {
    if (!ordModalHistory) return;

    ordModalHistory.innerHTML = '';

    const hist = Array.isArray(row?.raw?.history) ? row.raw.history : [];
    if (!hist.length) {
      ordModalHistory.innerHTML = `<div class="muted">No status changes yet.</div>`;
      return;
    }

    const items = hist.slice().reverse();
    ordModalHistory.innerHTML = `
        <div class="panel" style="display:grid; gap:10px;">
          ${items.map(h => {
      const when = escapeHtml(formatDateShort(h.at));
      const by = escapeHtml(h.by || 'admin');
      const from = escapeHtml(h.from || '—');
      const to = escapeHtml(h.to || '—');
      return `
              <div class="meta-row" style="align-items:flex-start;">
                <div style="display:grid; gap:4px;">
                  <div><strong>${from}</strong> → <strong>${to}</strong></div>
                  <div class="muted" style="font-size:12.5px;">${when} • ${by}</div>
                </div>
              </div>
            `;
    }).join('')}
        </div>
      `;
  }

  function openOrderModal(orderId, email) {
    const oid = String(orderId || '').trim();
    const em = String(email || '').trim().toLowerCase();

    // Refresh orders so history is current
    const all = flattenOrders();

    const row =
      all.find(o => String(o.id || '') === oid && String(o.email || '') === em) ||
      all.find(o => String(o.id || '') === oid) ||
      null;

    if (!row) {
      toast('Order not found.');
      return;
    }

    if (!ordModal || !ordModalTitle || !ordModalMeta || !ordModalItems) {
      toast(`Order #${row.id} (${row.email}) total ${formatJ(row.totalJMD)}.`);
      return;
    }

    ordModalTitle.textContent = `Order #${row.id || ''}`;
    ordModalMeta.innerHTML = `
        <div class="meta-row"><span class="muted">Date</span><span>${escapeHtml(formatDateShort(row.createdAt))}</span></div>
        <div class="meta-row"><span class="muted">Customer</span><span>${escapeHtml(resolveCustomerName(row.email) === '—' ? row.email : `${resolveCustomerName(row.email)} (${row.email})`)}</span></div>
        <div class="meta-row"><span class="muted">Status</span><span>${escapeHtml(String(row.status || 'Placed'))}</span></div>
        <div class="meta-row"><span class="muted">Total</span><span>${escapeHtml(formatJ(row.totalJMD))}</span></div>
      `;

    const items = Array.isArray(row.items) ? row.items : [];
    if (!items.length) {
      ordModalItems.innerHTML = `<div class="muted">No items found for this order.</div>`;
    } else {
      ordModalItems.innerHTML = `
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
                ${items.map(it => {
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

    // History (optional if #orderModalHistory exists on this page)
    renderOrderHistoryIntoModal(row);

    ordModal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeOrderModal() {
    if (!ordModal) return;
    ordModal.hidden = true;
    const anyOpen = qsa('.modal-overlay').some(m => m && !m.hasAttribute('hidden'));
    if (!anyOpen) document.body.classList.remove('modal-open');
  }

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
              <button class="btn btn-ghost btn-sm" type="button"
                data-open-customer="1" data-customer-email="${escapeHtml(r.email)}">Open</button>
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

  // Customer open
  if (!tbody.dataset.bound) {
    tbody.dataset.bound = '1';
    tbody.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-open-customer="1"]') : null;
      if (!btn) return;
      const em = btn.getAttribute('data-customer-email') || '';
      openCustomerModal(em);
    });
  }

  // Orders open (from within customer modal)
  if (cusModalOrders && !cusModalOrders.dataset.bound) {
    cusModalOrders.dataset.bound = '1';
    cusModalOrders.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-open-order="1"]') : null;
      if (!btn) return;
      const oid = btn.getAttribute('data-order-id') || '';
      const em = btn.getAttribute('data-order-email') || '';
      openOrderModal(oid, em);
    });
  }

  // Modal close controls
  if (cusModalClose && !cusModalClose.dataset.bound) {
    cusModalClose.dataset.bound = '1';
    cusModalClose.addEventListener('click', (e) => {
      e.preventDefault();
      closeCustomerModal();
    });
  }

  if (cusModal && !cusModal.dataset.bound) {
    cusModal.dataset.bound = '1';
    cusModal.addEventListener('click', (e) => {
      const panel = qs('.modal-panel', cusModal);
      if (panel && !panel.contains(e.target)) closeCustomerModal();
    });
  }

  if (ordModalClose && !ordModalClose.dataset.bound) {
    ordModalClose.dataset.bound = '1';
    ordModalClose.addEventListener('click', (e) => {
      e.preventDefault();
      closeOrderModal();
    });
  }

  if (ordModal && !ordModal.dataset.bound) {
    ordModal.dataset.bound = '1';
    ordModal.addEventListener('click', (e) => {
      const panel = qs('.modal-panel', ordModal);
      if (panel && !panel.contains(e.target)) closeOrderModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (ordModal && !ordModal.hidden) closeOrderModal();
    else if (cusModal && !cusModal.hidden) closeCustomerModal();
  });
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

/* ================= App Boot ================= */

document.addEventListener('DOMContentLoaded', () => {
  (async () => {
    // Core setup
    applyTheme(readTheme());
    setYear();

    // Auth gate (DB session via /api/me)
    await requireAdminGate();

    applySidebarPref();
    bindSidebarMediaListener();
    highlightActiveNav();

    await hydrateAdminName();
    bindDelegatedActions();

    // Page-specific inits
    initProductsManager();
    initDashboard();
    initOrders();
    initCustomers();
    initSettings();
  })().catch((err) => {
    console.error(err);
  });
});