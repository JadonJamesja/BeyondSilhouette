/* Beyond Silhouette — Admin (DB-backed, no localStorage)
   - Uses same-domain /api/* endpoints (Railway)
   - Customers + Orders + Dashboard + Settings now pull from DB
   - Admin Settings = Home Page CMS + Admin Config
*/
(() => {
  'use strict';

  // -----------------------------
  // DOM utils
  // -----------------------------
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const fmtJMD = (n) => {
    const v = Number(n);
    const safe = Number.isFinite(v) ? v : 0;
    return `J$ ${safe.toLocaleString('en-JM')}`;
  };

  const escapeHtml = (s) =>
    String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

  // -----------------------------
  // API helper
  // -----------------------------
  async function apiJSON(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });

    const data = await res.json().catch(() => null);
    return { res, data };
  }

  // -----------------------------
  // Auth / gate
  // -----------------------------
  let __ME_CACHE = null;

  async function fetchMe() {
    if (__ME_CACHE) return __ME_CACHE;
    const { res, data } = await apiJSON('/api/me');
    if (!res.ok || !data?.ok) return null;
    __ME_CACHE = data.user || null;
    return __ME_CACHE;
  }

  function isAdminUser(u) {
    return !!u && String(u.role || '').toLowerCase() === 'admin';
  }

  function inAdminFolder() {
    return location.pathname.includes('/admin/');
  }

  function isAdminLoginPage() {
    return location.pathname.endsWith('/admin/login.html');
  }

  async function requireAdminGate() {
    if (!inAdminFolder()) return;

    const me = await fetchMe();

    // Allow unauthenticated users to remain on admin login page
    if (!me && isAdminLoginPage()) return;

    if (!me) {
      location.href = './login.html';
      return;
    }

    if (!isAdminUser(me)) {
      location.href = '../index.html';
      return;
    }

    if (isAdminLoginPage()) {
      location.href = './dashboard.html';
    }
  }

  async function logoutEverywhere() {
    await apiJSON('/api/auth/logout', { method: 'POST' }).catch(() => null);
    __ME_CACHE = null;
  }

  function hydrateAdminName() {
    const me = __ME_CACHE;
    const display = me && (me.name || me.email) ? String(me.name || me.email) : 'Admin';
    qsa('[data-ui="adminName"]').forEach((n) => (n.textContent = display));
  }

  // -----------------------------
  // Theme toggle (non-persistent)
  // -----------------------------
  function bindThemeToggle() {
    qsa('[data-action="toggle-theme"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const html = document.documentElement;
        const cur = html.getAttribute('data-theme') || 'light';
        const next = cur === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
      });
    });
  }

  // Sidebar toggle (non-persistent)
  function bindSidebarToggle() {
    const toggle = qs('[data-action="toggle-sidebar"]');
    const sidebar = qs('.sidebar');
    const main = qs('.main');
    if (!toggle || !sidebar || !main) return;

    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      main.classList.toggle('expanded');
    });
  }

  // Toast helper (uses existing data-action="toast" buttons)
  function bindToasts() {
    qsa('[data-action="toast"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const msg = btn.getAttribute('data-toast') || 'Done.';
        alert(msg);
      });
    });
  }

  // -----------------------------
  // Admin Login (email/password + Google)
  // -----------------------------
  async function initAdminLogin() {
    if (!isAdminLoginPage()) return;

    const form = qs('#loginForm');
    const errorBox = qs('[data-ui="error"]');
    const setError = (msg) => {
      if (!errorBox) return;
      if (!msg) {
        errorBox.hidden = true;
        errorBox.textContent = '';
      } else {
        errorBox.hidden = false;
        errorBox.textContent = msg;
      }
    };

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        setError('');

        const email = String(qs('#email')?.value || '').trim().toLowerCase();
        const password = String(qs('#password')?.value || '');

        const { res, data } = await apiJSON('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });

        if (!res.ok || !data?.ok) {
          setError(data?.error || 'Login failed.');
          return;
        }

        __ME_CACHE = data.user || null;
        const me = await fetchMe();

        if (!isAdminUser(me)) {
          await logoutEverywhere();
          setError('This account is not an admin.');
          return;
        }

        location.href = './dashboard.html';
      });
    }

    // Google Sign-In
    const googleBtn = qs('#adminGoogleBtn');
    if (!googleBtn) return;

    const { res: cfgRes, data: cfg } = await apiJSON('/api/public/config');
    const clientId = cfg?.googleClientId;
    if (!cfgRes.ok || !clientId || !window.google?.accounts?.id) {
      // Hide if not configured
      googleBtn.hidden = true;
      return;
    }

    function onCredential(resp) {
      setError('');
      const credential = String(resp?.credential || '').trim();
      if (!credential) return;

      apiJSON('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential }),
      })
        .then(async ({ res, data }) => {
          if (!res.ok || !data?.ok) throw new Error(data?.error || 'Google login failed');
          __ME_CACHE = data.user || null;
          const me = await fetchMe();
          if (!isAdminUser(me)) {
            await logoutEverywhere();
            setError('This account is not an admin.');
            return;
          }
          location.href = './dashboard.html';
        })
        .catch((e) => setError(String(e?.message || 'Google login failed.')));
    }

    // Render the button into the container
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: onCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    window.google.accounts.id.renderButton(googleBtn, {
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      width: 280,
    });
  }

  // -----------------------------
  // Dashboard (DB stats)
  // -----------------------------
  async function initDashboard() {
    if (!location.pathname.endsWith('/admin/dashboard.html')) return;

    const [statsResp, ordersResp] = await Promise.all([
      apiJSON('/api/admin/stats'),
      apiJSON('/api/admin/orders'),
    ]);

    if (statsResp.res.ok && statsResp.data?.ok) {
      const s = statsResp.data.stats || {};
      const revenue = qs('#statRevenueValue');
      const orders = qs('#statOrdersValue');
      const customers = qs('#statCustomersValue');
      const lowStock = qs('#statLowStockValue');

      if (revenue) revenue.textContent = fmtJMD(s.revenueJMD);
      if (orders) orders.textContent = String(s.ordersCount ?? 0);
      if (customers) customers.textContent = String(s.usersCount ?? 0);
      if (lowStock) lowStock.textContent = String(s.lowStockCount ?? 0);

      const lowSub = qs('#statLowStockSub');
      if (lowSub) lowSub.textContent = `≤ ${Number(s.lowStockThreshold ?? 3)} in stock`;
    }

    const tbody = qs('#recentOrdersTbody');
    if (!tbody) return;

    if (!ordersResp.res.ok || !ordersResp.data?.ok) {
      tbody.innerHTML = `
      <tr>
        <td colspan="4" class="muted">Could not load recent orders.</td>
      </tr>
    `;
      return;
    }

    const orders = Array.isArray(ordersResp.data.orders) ? ordersResp.data.orders.slice(0, 4) : [];

    if (!orders.length) {
      tbody.innerHTML = `
      <tr>
        <td colspan="4" class="muted">No orders yet.</td>
      </tr>
    `;
      return;
    }

    tbody.innerHTML = orders.map((o) => `
    <tr>
      <td class="mono">${escapeHtml(o.id || '')}</td>
      <td>${escapeHtml(o.customerName || o.email || '')}</td>
      <td>${escapeHtml(String(o.status || '').toUpperCase())}</td>
      <td class="right">${fmtJMD(o.totalJMD)}</td>
    </tr>
  `).join('');
  }

  // -----------------------------
  // Orders
  // -----------------------------
  async function initOrders() {
    if (!location.pathname.endsWith('/admin/orders.html')) return;

    const tbody = qs('#ordersTbody');
    const search = qs('#orderSearch');
    const modal = qs('#orderModal');
    const modalClose = qs('#orderModalClose');
    const modalTitle = qs('#orderModalTitle');
    const modalMeta = qs('#orderModalMeta');
    const modalHistory = qs('#orderModalHistory');
    const modalItems = qs('#orderModalItems');

    const setModalOpen = (open) => {
      if (!modal) return;
      modal.hidden = !open;
    };
    modalClose?.addEventListener('click', () => setModalOpen(false));
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) setModalOpen(false);
    });

    let orders = [];

    async function load() {
      const { res, data } = await apiJSON('/api/admin/orders');
      if (!res.ok || !data?.ok) return;
      orders = Array.isArray(data.orders) ? data.orders : [];
      render();
    }

    function render() {
      if (!tbody) return;
      const q = String(search?.value || '').trim().toLowerCase();

      const rows = orders.filter((o) => {
        if (!q) return true;
        return (
          String(o.id || '').toLowerCase().includes(q) ||
          String(o.email || '').toLowerCase().includes(q) ||
          String(o.status || '').toLowerCase().includes(q)
        );
      });

      tbody.innerHTML = rows
        .map((o) => {
          const date = o.createdAt ? new Date(o.createdAt).toLocaleString() : '';
          return `
            <tr data-order-id="${escapeHtml(o.id)}">
              <td class="mono">${escapeHtml(o.id)}</td>
              <td>${escapeHtml(o.email || '')}</td>
              <td>${escapeHtml(String(o.status || '').toUpperCase())}</td>
              <td>${fmtJMD(o.totalJMD)}</td>
              <td>${escapeHtml(date)}</td>
              <td><button class="btn btn-ghost btn-sm" type="button" data-action="view-order">View</button></td>
            </tr>
          `;
        })
        .join('');
    }

    async function openOrder(id) {
      const { res, data } = await apiJSON(`/api/admin/orders/${encodeURIComponent(id)}`);
      if (!res.ok || !data?.ok) return;

      const o = data.order;
      if (modalTitle) modalTitle.textContent = `Order ${o.id}`;
      if (modalMeta) {
        const date = o.createdAt ? new Date(o.createdAt).toLocaleString() : '';
        modalMeta.innerHTML = `
          <div class="grid grid-2 gap-12">
            <div><div class="muted">Customer</div><div>${escapeHtml(o.customerName || o.email || '')}</div></div>
            <div><div class="muted">Status</div><div>${escapeHtml(String(o.status || '').toUpperCase())}</div></div>
            <div><div class="muted">Total</div><div>${fmtJMD(o.totalJMD)}</div></div>
            <div><div class="muted">Placed</div><div>${escapeHtml(date)}</div></div>
          </div>
        `;
      }

      if (modalItems) {
        const items = Array.isArray(o.items) ? o.items : [];
        modalItems.innerHTML = `
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Item</th><th>Size</th><th>Qty</th><th>Price</th></tr></thead>
              <tbody>
                ${items
            .map(
              (it) => `
                  <tr>
                    <td>${escapeHtml(it.name || 'Item')}</td>
                    <td>${escapeHtml(it.size || '')}</td>
                    <td>${escapeHtml(String(it.qty ?? ''))}</td>
                    <td>${fmtJMD(it.priceJMD)}</td>
                  </tr>
                `
            )
            .join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      if (modalHistory) {
        const hist = Array.isArray(o.history) ? o.history : [];
        modalHistory.innerHTML = hist.length
          ? `<ul class="timeline">
              ${hist
            .map(
              (h) => `
                <li>
                  <div class="muted">${escapeHtml(new Date(h.at).toLocaleString())}</div>
                  <div><strong>${escapeHtml(String(h.from || '').toUpperCase())}</strong> → <strong>${escapeHtml(
                String(h.to || '').toUpperCase()
              )}</strong></div>
                  <div class="muted">By: ${escapeHtml(h.by || 'admin')}</div>
                </li>
              `
            )
            .join('')}
            </ul>`
          : `<div class="muted">No status history yet.</div>`;
      }

      setModalOpen(true);
    }

    tbody?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="view-order"]');
      if (!btn) return;
      const tr = e.target.closest('tr');
      const id = tr?.getAttribute('data-order-id');
      if (id) openOrder(id);
    });

    search?.addEventListener('input', render);

    await load();
  }

  // -----------------------------
  // Customers
  // -----------------------------
  async function initCustomers() {
    if (!location.pathname.endsWith('/admin/customers.html')) return;

    const tbody = qs('#customersTbody');
    const search = qs('#customerSearch');

    const modal = qs('#customerModal');
    const modalClose = qs('#customerModalClose');
    const modalTitle = qs('#customerModalTitle');
    const modalMeta = qs('#customerModalMeta');
    const modalOrders = qs('#customerModalOrders');

    const setModalOpen = (open) => {
      if (!modal) return;
      modal.hidden = !open;
    };

    modalClose?.addEventListener('click', () => setModalOpen(false));
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) setModalOpen(false);
    });

    let users = [];
    let orders = [];

    async function load() {
      const [u, o] = await Promise.all([
        apiJSON('/api/admin/users'),
        apiJSON('/api/admin/orders'),
      ]);

      if (u.res.ok && u.data?.ok) users = Array.isArray(u.data.users) ? u.data.users : [];
      if (o.res.ok && o.data?.ok) orders = Array.isArray(o.data.orders) ? o.data.orders : [];

      render();
    }

    function userStatsByEmail(email) {
      const em = String(email || '').toLowerCase();
      const mine = orders.filter((o) => String(o.email || '').toLowerCase() === em);
      const count = mine.length;
      const spend = mine.reduce((sum, o) => sum + Number(o.totalJMD || 0), 0);
      return { count, spend, orders: mine };
    }

    function render() {
      if (!tbody) return;
      const q = String(search?.value || '').trim().toLowerCase();

      const rows = users.filter((u) => {
        if (!q) return true;
        return (
          String(u.email || '').toLowerCase().includes(q) ||
          String(u.name || '').toLowerCase().includes(q) ||
          String(u.role || '').toLowerCase().includes(q)
        );
      });

      tbody.innerHTML = rows
        .map((u) => {
          const stats = userStatsByEmail(u.email);
          const created = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '';
          return `
            <tr data-user-id="${escapeHtml(u.id)}">
              <td>${escapeHtml(u.name || '—')}</td>
              <td>${escapeHtml(u.email || '')}</td>
              <td>${escapeHtml(String(u.role || '').toUpperCase())}</td>
              <td>${escapeHtml(String(stats.count))}</td>
              <td>${fmtJMD(stats.spend)}</td>
              <td>${escapeHtml(created)}</td>
              <td><button class="btn btn-ghost btn-sm" type="button" data-action="view-customer">View</button></td>
            </tr>
          `;
        })
        .join('');
    }

    async function openCustomer(id) {
      const user = users.find((u) => String(u.id) === String(id));
      if (!user) return;

      const stats = userStatsByEmail(user.email);
      if (modalTitle) modalTitle.textContent = user.name ? user.name : user.email;

      if (modalMeta) {
        modalMeta.innerHTML = `
          <div class="grid grid-2 gap-12">
            <div><div class="muted">Email</div><div>${escapeHtml(user.email)}</div></div>
            <div><div class="muted">Role</div>
              <div class="row gap-8">
                <select class="select" id="userRoleSelect">
                  <option value="customer"${String(user.role).toLowerCase() === 'customer' ? ' selected' : ''}>Customer</option>
                  <option value="admin"${String(user.role).toLowerCase() === 'admin' ? ' selected' : ''}>Admin</option>
                </select>
                <button class="btn btn-primary btn-sm" type="button" data-action="save-role">Save</button>
              </div>
              <div class="hint mt-8">Role changes require DB update.</div>
            </div>
            <div><div class="muted">Orders</div><div>${escapeHtml(String(stats.count))}</div></div>
            <div><div class="muted">Total spend</div><div>${fmtJMD(stats.spend)}</div></div>
          </div>
        `;
      }

      if (modalOrders) {
        modalOrders.innerHTML = stats.orders.length
          ? `<div class="table-wrap">
              <table class="table">
                <thead><tr><th>Order</th><th>Status</th><th>Total</th><th>Date</th></tr></thead>
                <tbody>
                  ${stats.orders
            .map((o) => {
              const date = o.createdAt ? new Date(o.createdAt).toLocaleString() : '';
              return `
                        <tr>
                          <td class="mono">${escapeHtml(o.id)}</td>
                          <td>${escapeHtml(String(o.status || '').toUpperCase())}</td>
                          <td>${fmtJMD(o.totalJMD)}</td>
                          <td>${escapeHtml(date)}</td>
                        </tr>
                      `;
            })
            .join('')}
                </tbody>
              </table>
            </div>`
          : `<div class="muted">No orders yet.</div>`;
      }

      setModalOpen(true);

      // role save
      const saveBtn = qs('[data-action="save-role"]', modalMeta);
      saveBtn?.addEventListener(
        'click',
        async () => {
          const role = String(qs('#userRoleSelect', modalMeta)?.value || '').trim().toLowerCase();
          const { res, data } = await apiJSON(`/api/admin/users/${encodeURIComponent(user.id)}/role`, {
            method: 'PATCH',
            body: JSON.stringify({ role }),
          });

          if (!res.ok || !data?.ok) {
            alert(data?.error || 'Failed to update role.');
            return;
          }

          // Update local cache and rerender
          users = users.map((u) => (u.id === user.id ? data.user : u));
          alert('Role updated.');
          setModalOpen(false);
          render();
        },
        { once: true }
      );
    }

    tbody?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="view-customer"]');
      if (!btn) return;
      const tr = e.target.closest('tr');
      const id = tr?.getAttribute('data-user-id');
      if (id) openCustomer(id);
    });

    search?.addEventListener('input', render);

    await load();
  }

  async function initProducts() {
  if (!location.pathname.endsWith('/admin/products.html')) return;

  const form = qs('#productForm');
  const listWrap = qsa('.list')[0];
  const previewName = qs('#previewName');
  const previewDesc = qs('#previewDesc');
  const previewPrice = qs('#previewPrice');
  const previewStock = qs('#previewStock');
  const previewStatus = qs('#previewStatus');
  const stockTotalBadge = qs('#stockTotalBadge');

  if (!form || !listWrap) return;

  const nameInput = qs('[name="name"]', form);
  const descInput = qs('[name="description"]', form);
  const priceInput = qs('[name="price"]', form);
  const statusInput = qs('[name="status"]', form);
  const stockS = qs('[name="stockS"]', form);
  const stockM = qs('[name="stockM"]', form);
  const stockL = qs('[name="stockL"]', form);
  const stockXL = qs('[name="stockXL"]', form);

  const saveDraftBtn = qsa('button', form)[0];
  const publishBtn = qsa('button', form)[1];

  let products = [];
  let editingId = null;

  function getInventoryPayload() {
    return [
      { size: 'S', stock: Number(stockS?.value || 0) },
      { size: 'M', stock: Number(stockM?.value || 0) },
      { size: 'L', stock: Number(stockL?.value || 0) },
      { size: 'XL', stock: Number(stockXL?.value || 0) },
    ];
  }

  function updatePreview() {
    const totalStock = getInventoryPayload().reduce((sum, row) => sum + Number(row.stock || 0), 0);

    if (previewName) previewName.textContent = nameInput?.value?.trim() || '—';
    if (previewDesc) previewDesc.textContent = descInput?.value?.trim() || '—';
    if (previewPrice) previewPrice.textContent = fmtJMD(Number(priceInput?.value || 0));
    if (previewStock) previewStock.textContent = `Stock: ${totalStock}`;
    if (previewStatus) previewStatus.textContent = statusInput?.value === 'published' ? 'Published' : 'Draft';
    if (stockTotalBadge) stockTotalBadge.textContent = `Total: ${totalStock}`;
  }

  function resetForm() {
    editingId = null;
    form.reset();
    updatePreview();
  }

  function fillForm(product) {
    editingId = product.id;
    if (nameInput) nameInput.value = product.name || '';
    if (descInput) descInput.value = product.description || '';
    if (priceInput) priceInput.value = String(product.priceJMD || 0);
    if (statusInput) statusInput.value = product.isPublished ? 'published' : 'draft';

    const inv = Array.isArray(product.inventory) ? product.inventory : [];
    const bySize = Object.fromEntries(inv.map(r => [String(r.size).toUpperCase(), Number(r.stock || 0)]));

    if (stockS) stockS.value = String(bySize.S || 0);
    if (stockM) stockM.value = String(bySize.M || 0);
    if (stockL) stockL.value = String(bySize.L || 0);
    if (stockXL) stockXL.value = String(bySize.XL || 0);

    updatePreview();
  }

  function renderList() {
    if (!products.length) {
      listWrap.innerHTML = `<div class="muted" style="padding:16px;">No products yet.</div>`;
      return;
    }

    listWrap.innerHTML = products.map((p) => `
      <button
        type="button"
        class="card mini"
        data-product-id="${escapeHtml(p.id)}"
        style="width:100%;text-align:left;padding:14px;margin-bottom:10px;border:none;cursor:pointer;"
      >
        <div class="row-between">
          <div>
            <div><strong>${escapeHtml(p.name || 'Product')}</strong></div>
            <div class="muted">${escapeHtml(p.description || '')}</div>
          </div>
          <div>
            <div>${fmtJMD(p.priceJMD)}</div>
            <div class="muted">${p.isPublished ? 'Published' : 'Draft'}</div>
          </div>
        </div>
      </button>
    `).join('');
  }

  async function loadProducts() {
    const { res, data } = await apiJSON('/api/admin/products');
    if (!res.ok || !data?.ok) {
      listWrap.innerHTML = `<div class="muted" style="padding:16px;">Failed to load products.</div>`;
      return;
    }
    products = Array.isArray(data.products) ? data.products : [];
    renderList();
  }

  async function saveProduct(isPublished) {
    const payload = {
      name: String(nameInput?.value || '').trim(),
      description: String(descInput?.value || '').trim(),
      priceJMD: Number(priceInput?.value || 0),
      isPublished,
      inventory: getInventoryPayload(),
      images: [],
    };

    if (!payload.name) {
      alert('Product name is required.');
      return;
    }

    const endpoint = editingId ? `/api/admin/products/${encodeURIComponent(editingId)}` : '/api/admin/products';
    const method = editingId ? 'PATCH' : 'POST';

    const { res, data } = await apiJSON(endpoint, {
      method,
      body: JSON.stringify(payload),
    });

    if (!res.ok || !data?.ok) {
      alert(data?.error || 'Failed to save product.');
      return;
    }

    alert(isPublished ? 'Product published.' : 'Draft saved.');
    await loadProducts();
    if (data.product) fillForm(data.product);
  }

  form.addEventListener('input', updatePreview);

  listWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-product-id]');
    if (!btn) return;
    const id = btn.getAttribute('data-product-id');
    const product = products.find((p) => String(p.id) === String(id));
    if (product) fillForm(product);
  });

  saveDraftBtn?.addEventListener('click', () => saveProduct(false));
  publishBtn?.addEventListener('click', () => saveProduct(true));

  updatePreview();
  await loadProducts();
}

  // -----------------------------
  // Settings (Home CMS + Admin Config)
  // -----------------------------
  async function initSettings() {
    if (!location.pathname.endsWith('/admin/settings.html')) return;

    const homeForm = qs('#homeSettingsForm');
    const cfgForm = qs('#adminConfigForm');
    const errBox = qs('[data-ui="settingsError"]');

    const headline = qs('#homeHeadline');
    const subheadline = qs('#homeSubheadline');
    const slideshow = qs('#homeSlideshow');
    const featured = qs('#homeFeatured');

    const lowStock = qs('#lowStockThreshold');

    const picker = qs('#featuredPicker');
    const featuredList = qs('#featuredList');
    const featuredSearch = qs('#featuredSearch');
    const featuredCount = qs('#featuredCount');

    let products = [];
    let selected = new Set();

    const setError = (msg) => {
      if (!errBox) return;
      if (!msg) {
        errBox.hidden = true;
        errBox.textContent = '';
      } else {
        errBox.hidden = false;
        errBox.textContent = msg;
      }
    };

    async function loadHome() {
      const { res, data } = await apiJSON('/api/admin/site/home');
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load home settings');
      const h = data.home || {};
      if (headline) headline.value = h.headline || '';
      if (subheadline) subheadline.value = h.subheadline || '';
      if (slideshow) slideshow.value = (Array.isArray(h.slideshowUrls) ? h.slideshowUrls : []).join('\n');
      if (featured) featured.value = (Array.isArray(h.featuredProductIds) ? h.featuredProductIds : []).join('\n');
    }

    async function saveHome() {
      const payload = {
        headline: headline ? headline.value.trim() : '',
        subheadline: subheadline ? subheadline.value.trim() : '',
        slideshowUrls: slideshow ? slideshow.value.split('\n').map((s) => s.trim()).filter(Boolean) : [],
        featuredProductIds: featured ? featured.value.split('\n').map((s) => s.trim()).filter(Boolean) : [],
      };

      const { res, data } = await apiJSON('/api/admin/site/home', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to save home settings');
    }

    async function loadConfig() {
      const { res, data } = await apiJSON('/api/admin/config');
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load config');
      const c = data.config || {};
      if (lowStock) lowStock.value = String(c.lowStockThreshold ?? 3);
    }

    async function saveConfig() {
      const n = Number(lowStock?.value);
      const payload = { lowStockThreshold: Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 3 };
      const { res, data } = await apiJSON('/api/admin/config', { method: 'PUT', body: JSON.stringify(payload) });
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to save config');
    }

    async function loadProductsForPicker() {
      const { res, data } = await apiJSON('/api/admin/products');
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load products');
      products = Array.isArray(data.products) ? data.products : [];
    }

    function openPicker() {
      if (!picker) return;
      picker.hidden = false;

      const currentIds = (featured?.value || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      selected = new Set(currentIds);

      renderPicker();
    }

    function closePicker() {
      if (!picker) return;
      picker.hidden = true;
    }

    function renderPicker() {
      if (!featuredList) return;
      const q = String(featuredSearch?.value || '').trim().toLowerCase();

      const rows = products
        .filter((p) => {
          if (!q) return true;
          return (
            String(p.name || '').toLowerCase().includes(q) ||
            String(p.id || '').toLowerCase().includes(q)
          );
        })
        .slice(0, 200);

      featuredList.innerHTML = rows
        .map((p) => {
          const checked = selected.has(p.id) ? 'checked' : '';
          const badge = p.isPublished ? 'Published' : 'Draft';
          return `
            <label class="row-between card mini" style="padding:10px;margin:8px 0;">
              <div>
                <div><strong>${escapeHtml(p.name || 'Product')}</strong></div>
                <div class="muted mono">${escapeHtml(p.id)}</div>
              </div>
              <div class="row gap-8">
                <span class="badge badge-soft">${escapeHtml(badge)}</span>
                <input type="checkbox" data-pid="${escapeHtml(p.id)}" ${checked}/>
              </div>
            </label>
          `;
        })
        .join('');

      if (featuredCount) featuredCount.textContent = String(selected.size);
    }

    featuredList?.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"][data-pid]');
      if (!cb) return;
      const id = cb.getAttribute('data-pid');
      if (!id) return;

      if (cb.checked) {
        if (selected.size >= 12) {
          cb.checked = false;
          alert('Limit: 12 featured products.');
          return;
        }
        selected.add(id);
      } else {
        selected.delete(id);
      }

      if (featuredCount) featuredCount.textContent = String(selected.size);
    });

    featuredSearch?.addEventListener('input', renderPicker);

    qs('[data-action="pick-featured"]')?.addEventListener('click', async () => {
      setError('');
      try {
        if (!products.length) await loadProductsForPicker();
        openPicker();
      } catch (e) {
        setError(String(e?.message || 'Failed to open picker'));
      }
    });

    qs('[data-action="close-featured"]')?.addEventListener('click', closePicker);
    qs('[data-action="apply-featured"]')?.addEventListener('click', () => {
      if (featured) featured.value = Array.from(selected.values()).join('\n');
      closePicker();
    });

    qs('[data-action="home-refresh"]')?.addEventListener('click', async () => {
      setError('');
      try {
        await loadHome();
        alert('Refreshed.');
      } catch (e) {
        setError(String(e?.message || 'Failed to refresh'));
      }
    });

    qs('[data-action="home-save"]')?.addEventListener('click', async () => {
      setError('');
      try {
        await saveHome();
        alert('Home settings saved.');
      } catch (e) {
        setError(String(e?.message || 'Failed to save home settings'));
      }
    });

    qs('[data-action="config-save"]')?.addEventListener('click', async () => {
      setError('');
      try {
        await saveConfig();
        alert('Config saved.');
      } catch (e) {
        setError(String(e?.message || 'Failed to save config'));
      }
    });

    // initial load
    try {
      await Promise.all([loadHome(), loadConfig()]);
    } catch (e) {
      setError(String(e?.message || 'Failed to load settings'));
    }
  }

  // -----------------------------
  // Boot
  // -----------------------------
  async function init() {
    // Year
    qsa('[data-ui="year"]').forEach((n) => (n.textContent = String(new Date().getFullYear())));

    bindThemeToggle();
    bindSidebarToggle();
    bindToasts();

    await requireAdminGate();
    await fetchMe();
    hydrateAdminName();

    await initDashboard();
    await initOrders();
    await initCustomers();
    await initProducts();
    await initSettings();
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((e) => console.error(e));
  });
})();
