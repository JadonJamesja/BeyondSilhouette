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

  function pathIsAdminPage(name) {
    const path = String(location.pathname || '').replace(/\/$/, '');
    return path.endsWith(`/admin/${name}`) || path.endsWith(`/admin/${name}.html`);
  }

  function isAdminLoginPage() {
    return pathIsAdminPage('login');
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
    if (!pathIsAdminPage('dashboard')) return;

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

    const recent = Array.isArray(ordersResp.data.orders) ? ordersResp.data.orders.slice(0, 6) : [];
    if (!recent.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="muted">No orders yet.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = recent.map((o) => `
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
    if (!pathIsAdminPage('orders')) return;

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
    if (!pathIsAdminPage('customers')) return;

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


  // -----------------------------
  // Products
  // -----------------------------
  async function initProducts() {
    if (!pathIsAdminPage('products')) return;

    const form = qs('#productForm');
    const lists = qsa('.list');
    const listWrap = lists[0] || null;
    const previewName = qs('#previewName');
    const previewDesc = qs('#previewDesc');
    const previewPrice = qs('#previewPrice');
    const previewStock = qs('#previewStock');
    const previewStatus = qs('#previewStatus');
    const imageGrid = qs('#imageGrid');
    const previewMedia = qs('#previewMedia');

    if (!form || !listWrap) return;

    const nameInput = qs('[name="name"]', form);
    const descInput = qs('[name="description"]', form);
    const priceInput = qs('[name="price"]', form);
    const statusInput = qs('[name="status"]', form);
    const stockS = qs('[name="stockS"]', form);
    const stockM = qs('[name="stockM"]', form);
    const stockL = qs('[name="stockL"]', form);
    const stockXL = qs('[name="stockXL"]', form);
    const imagesInput = qs('#productImages', form);
    const buttons = qsa('button', form);
    const saveDraftBtn = buttons[0] || null;
    const publishBtn = buttons[1] || null;
    const deleteBtn = buttons[2] || null;

    let products = [];
    let editingId = null;
    let images = [];

    function inventoryPayload() {
      return [
        { size: 'S', stock: Number(stockS?.value || 0) },
        { size: 'M', stock: Number(stockM?.value || 0) },
        { size: 'L', stock: Number(stockL?.value || 0) },
        { size: 'XL', stock: Number(stockXL?.value || 0) },
      ];
    }

    function totalStock() {
      return inventoryPayload().reduce((sum, row) => sum + Number(row.stock || 0), 0);
    }

    function renderImagePreview() {
      if (previewMedia) {
        const first = images[0]?.url || '';
        previewMedia.innerHTML = first
          ? `<img src="${escapeHtml(first)}" alt="Preview" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`
          : `<span class="muted">No image</span>`;
      }
      if (imageGrid) {
        imageGrid.innerHTML = images.map((img, i) => `
          <div class="card mini" style="padding:10px;display:flex;gap:10px;align-items:center;">
            <img src="${escapeHtml(img.url)}" alt="Image ${i+1}" style="width:72px;height:72px;object-fit:cover;border-radius:12px;" />
            <div class="muted">Image ${i + 1}</div>
          </div>
        `).join('');
      }
    }

    function updatePreview() {
      if (previewName) previewName.textContent = nameInput?.value?.trim() || '—';
      if (previewDesc) previewDesc.textContent = descInput?.value?.trim() || '—';
      if (previewPrice) previewPrice.textContent = fmtJMD(Number(priceInput?.value || 0));
      if (previewStock) previewStock.textContent = `Stock: ${totalStock()}`;
      if (previewStatus) previewStatus.textContent = statusInput?.value === 'published' ? 'Published' : 'Draft';
      renderImagePreview();
    }

    function fillForm(product) {
      editingId = product.id;
      nameInput.value = product.name || '';
      descInput.value = product.description || '';
      priceInput.value = String(product.priceJMD || 0);
      statusInput.value = product.isPublished ? 'published' : 'draft';
      const bySize = Object.fromEntries((product.inventory || []).map((r) => [String(r.size).toUpperCase(), Number(r.stock || 0)]));
      stockS.value = String(bySize.S || 0);
      stockM.value = String(bySize.M || 0);
      stockL.value = String(bySize.L || 0);
      stockXL.value = String(bySize.XL || 0);
      images = Array.isArray(product.images) ? product.images.map((img) => ({ url: img.url, alt: img.alt || '', sortOrder: Number(img.sortOrder || 0) })) : [];
      updatePreview();
    }

    function resetForm() {
      editingId = null;
      form.reset();
      images = [];
      updatePreview();
    }

    function renderList() {
      if (!products.length) {
        listWrap.innerHTML = `<div class="muted" style="padding:16px;">No products yet.</div>`;
        return;
      }
      listWrap.innerHTML = products.map((p) => `
        <button type="button" class="card mini" data-product-id="${escapeHtml(p.id)}" style="width:100%;text-align:left;padding:14px;margin-bottom:10px;border:none;cursor:pointer;">
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
        inventory: inventoryPayload(),
        images,
      };
      if (!payload.name) {
        alert('Product name is required.');
        return;
      }
      const endpoint = editingId ? `/api/admin/products/${encodeURIComponent(editingId)}` : '/api/admin/products';
      const method = editingId ? 'PATCH' : 'POST';
      const { res, data } = await apiJSON(endpoint, { method, body: JSON.stringify(payload) });
      if (!res.ok || !data?.ok) {
        alert(data?.error || 'Failed to save product.');
        return;
      }
      await loadProducts();
      if (data.product) fillForm(data.product);
      alert(isPublished ? 'Product published.' : 'Draft saved.');
    }

    async function deleteProduct() {
      if (!editingId) return;
      alert('Delete is not wired yet on the backend for products.');
    }

    form.addEventListener('input', updatePreview);
    imagesInput?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      images = await Promise.all(files.map((file, i) => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ url: String(reader.result || ''), alt: file.name || '', sortOrder: i });
        reader.readAsDataURL(file);
      })));
      updatePreview();
    });
    listWrap.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-product-id]');
      if (!btn) return;
      const id = btn.getAttribute('data-product-id');
      const product = products.find((p) => String(p.id) === String(id));
      if (product) fillForm(product);
    });
    saveDraftBtn?.addEventListener('click', () => saveProduct(false));
    publishBtn?.addEventListener('click', () => saveProduct(true));
    deleteBtn?.addEventListener('click', deleteProduct);

    resetForm();
    await loadProducts();
  }

  // -----------------------------
  // Settings (Home CMS + Admin Config)
  // -----------------------------
  async function initSettings() {
    if (!pathIsAdminPage('settings')) return;

    const errBox = qs('[data-ui="settingsError"]');
    const headline = qs('#homeHeadline');
    const subheadline = qs('#homeSubheadline');
    const slideshow = qs('#homeSlideshow');
    const featured = qs('#homeFeatured');
    const lowStock = qs('#lowStockThreshold');

    const slideshowSearch = qs('#slideshowSearch');
    const slideshowPicker = qs('#slideshowPicker');
    const slideshowSelected = qs('#slideshowSelected');
    const slideshowCount = qs('#slideshowCount');

    const featuredSearch = qs('#featuredSearch');
    const featuredList = qs('#featuredList');
    const featuredSelected = qs('#featuredSelected');
    const featuredCount = qs('#featuredCount');

    let products = [];
    let slideshowSelectedUrls = [];
    let featuredSelectedIds = [];

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

    function syncHiddenFields() {
      if (slideshow) slideshow.value = slideshowSelectedUrls.join('
');
      if (featured) featured.value = featuredSelectedIds.join('
');
      if (slideshowCount) slideshowCount.textContent = String(slideshowSelectedUrls.length);
      if (featuredCount) featuredCount.textContent = String(featuredSelectedIds.length);
    }

    function productCover(product) {
      const img = Array.isArray(product?.images) ? product.images[0] : null;
      return String(img?.url || '');
    }

    function productImages(product) {
      return Array.isArray(product?.images) ? product.images.filter((img) => img?.url).map((img) => ({
        url: String(img.url),
        alt: String(img.alt || product?.name || 'Product image'),
        productId: String(product?.id || ''),
        productName: String(product?.name || 'Product'),
      })) : [];
    }

    function getAllSlideshowOptions() {
      return products.flatMap((product) => productImages(product));
    }

    async function loadHome() {
      const { res, data } = await apiJSON('/api/admin/site/home');
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load home settings');
      const h = data.home || {};
      if (headline) headline.value = h.headline || '';
      if (subheadline) subheadline.value = h.subheadline || '';
      slideshowSelectedUrls = Array.isArray(h.slideshowUrls) ? h.slideshowUrls.slice(0, 6) : [];
      featuredSelectedIds = Array.isArray(h.featuredProductIds) ? h.featuredProductIds.slice(0, 3) : [];
      syncHiddenFields();
      renderSlideshowPicker();
      renderFeaturedPicker();
      renderSelectedSlideshow();
      renderSelectedFeatured();
    }

    async function saveHome() {
      const payload = {
        headline: headline ? headline.value.trim() : '',
        subheadline: subheadline ? subheadline.value.trim() : '',
        slideshowUrls: slideshowSelectedUrls.slice(0, 6),
        featuredProductIds: featuredSelectedIds.slice(0, 3),
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

    async function loadProductsLibrary() {
      const { res, data } = await apiJSON('/api/admin/products');
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load products');
      products = Array.isArray(data.products) ? data.products : [];
    }

    function renderSlideshowPicker() {
      if (!slideshowPicker) return;
      const q = String(slideshowSearch?.value || '').trim().toLowerCase();
      const rows = getAllSlideshowOptions().filter((img) => {
        if (!q) return true;
        return img.productName.toLowerCase().includes(q) || img.url.toLowerCase().includes(q);
      }).slice(0, 100);

      if (!rows.length) {
        slideshowPicker.innerHTML = '<div class="muted">No product images found.</div>';
        return;
      }

      slideshowPicker.innerHTML = rows.map((img) => {
        const active = slideshowSelectedUrls.includes(img.url) ? ' is-selected' : '';
        return `
          <button type="button" class="picker-card${active}" data-action="toggle-slideshow" data-url="${escapeHtml(img.url)}">
            <div class="picker-thumb"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt)}" /></div>
            <div class="picker-meta">
              <strong>${escapeHtml(img.productName)}</strong>
              <span class="muted">${slideshowSelectedUrls.includes(img.url) ? 'Selected' : 'Add to slideshow'}</span>
            </div>
          </button>
        `;
      }).join('');
    }

    function renderFeaturedPicker() {
      if (!featuredList) return;
      const q = String(featuredSearch?.value || '').trim().toLowerCase();
      const rows = products.filter((product) => {
        if (!q) return true;
        return String(product?.name || '').toLowerCase().includes(q) || String(product?.id || '').toLowerCase().includes(q);
      }).slice(0, 100);

      if (!rows.length) {
        featuredList.innerHTML = '<div class="muted">No products found.</div>';
        return;
      }

      featuredList.innerHTML = rows.map((product) => {
        const cover = productCover(product);
        const active = featuredSelectedIds.includes(product.id) ? ' is-selected' : '';
        return `
          <button type="button" class="picker-card${active}" data-action="toggle-featured" data-pid="${escapeHtml(product.id)}">
            <div class="picker-thumb">${cover ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(product.name || 'Product')}" />` : '<span class="muted">No image</span>'}</div>
            <div class="picker-meta">
              <strong>${escapeHtml(product.name || 'Product')}</strong>
              <span class="muted">${product.isPublished ? 'Published' : 'Draft'}</span>
            </div>
          </button>
        `;
      }).join('');
    }

    function renderSelectedSlideshow() {
      if (!slideshowSelected) return;
      if (!slideshowSelectedUrls.length) {
        slideshowSelected.innerHTML = '<div class="muted">No slideshow images selected yet.</div>';
        return;
      }
      slideshowSelected.innerHTML = slideshowSelectedUrls.map((url, index) => `
        <div class="selected-card">
          <div class="selected-thumb"><img src="${escapeHtml(url)}" alt="Selected slideshow image ${index + 1}" /></div>
          <div class="selected-body">
            <strong>Slide ${index + 1}</strong>
            <div class="selected-actions">
              <button class="btn btn-ghost btn-sm" type="button" data-action="move-slide-left" data-index="${index}" ${index === 0 ? 'disabled' : ''}>Up</button>
              <button class="btn btn-ghost btn-sm" type="button" data-action="move-slide-right" data-index="${index}" ${index === slideshowSelectedUrls.length - 1 ? 'disabled' : ''}>Down</button>
              <button class="btn btn-ghost btn-sm" type="button" data-action="remove-slide" data-url="${escapeHtml(url)}">Remove</button>
            </div>
          </div>
        </div>
      `).join('');
    }

    function renderSelectedFeatured() {
      if (!featuredSelected) return;
      if (!featuredSelectedIds.length) {
        featuredSelected.innerHTML = '<div class="muted">No featured products selected yet.</div>';
        return;
      }
      const cards = featuredSelectedIds.map((id, index) => {
        const product = products.find((p) => String(p.id) === String(id));
        const cover = productCover(product);
        return `
          <div class="selected-card">
            <div class="selected-thumb">${cover ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(product?.name || 'Product')}" />` : '<span class="muted">No image</span>'}</div>
            <div class="selected-body">
              <strong>${escapeHtml(product?.name || 'Product')}</strong>
              <span class="muted">Featured slot ${index + 1}</span>
              <div class="selected-actions">
                <button class="btn btn-ghost btn-sm" type="button" data-action="move-featured-left" data-index="${index}" ${index === 0 ? 'disabled' : ''}>Left</button>
                <button class="btn btn-ghost btn-sm" type="button" data-action="move-featured-right" data-index="${index}" ${index === featuredSelectedIds.length - 1 ? 'disabled' : ''}>Right</button>
                <button class="btn btn-ghost btn-sm" type="button" data-action="remove-featured" data-pid="${escapeHtml(id)}">Remove</button>
              </div>
            </div>
          </div>
        `;
      });
      featuredSelected.innerHTML = cards.join('');
    }

    function moveItem(arr, from, to) {
      if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
      const copy = arr.slice();
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    }

    slideshowPicker?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="toggle-slideshow"]');
      if (!btn) return;
      const url = String(btn.getAttribute('data-url') || '').trim();
      if (!url) return;
      if (slideshowSelectedUrls.includes(url)) {
        slideshowSelectedUrls = slideshowSelectedUrls.filter((item) => item !== url);
      } else {
        if (slideshowSelectedUrls.length >= 6) {
          alert('You can select up to 6 slideshow images.');
          return;
        }
        slideshowSelectedUrls = [...slideshowSelectedUrls, url];
      }
      syncHiddenFields();
      renderSlideshowPicker();
      renderSelectedSlideshow();
    });

    featuredList?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="toggle-featured"]');
      if (!btn) return;
      const id = String(btn.getAttribute('data-pid') || '').trim();
      if (!id) return;
      if (featuredSelectedIds.includes(id)) {
        featuredSelectedIds = featuredSelectedIds.filter((item) => item !== id);
      } else {
        if (featuredSelectedIds.length >= 3) {
          alert('You can select up to 3 featured products.');
          return;
        }
        featuredSelectedIds = [...featuredSelectedIds, id];
      }
      syncHiddenFields();
      renderFeaturedPicker();
      renderSelectedFeatured();
    });

    slideshowSelected?.addEventListener('click', (e) => {
      const remove = e.target.closest('[data-action="remove-slide"]');
      const moveLeft = e.target.closest('[data-action="move-slide-left"]');
      const moveRight = e.target.closest('[data-action="move-slide-right"]');
      if (remove) {
        const url = String(remove.getAttribute('data-url') || '').trim();
        slideshowSelectedUrls = slideshowSelectedUrls.filter((item) => item !== url);
      } else if (moveLeft) {
        const index = Number(moveLeft.getAttribute('data-index') || -1);
        slideshowSelectedUrls = moveItem(slideshowSelectedUrls, index, index - 1);
      } else if (moveRight) {
        const index = Number(moveRight.getAttribute('data-index') || -1);
        slideshowSelectedUrls = moveItem(slideshowSelectedUrls, index, index + 1);
      } else {
        return;
      }
      syncHiddenFields();
      renderSlideshowPicker();
      renderSelectedSlideshow();
    });

    featuredSelected?.addEventListener('click', (e) => {
      const remove = e.target.closest('[data-action="remove-featured"]');
      const moveLeft = e.target.closest('[data-action="move-featured-left"]');
      const moveRight = e.target.closest('[data-action="move-featured-right"]');
      if (remove) {
        const id = String(remove.getAttribute('data-pid') || '').trim();
        featuredSelectedIds = featuredSelectedIds.filter((item) => item !== id);
      } else if (moveLeft) {
        const index = Number(moveLeft.getAttribute('data-index') || -1);
        featuredSelectedIds = moveItem(featuredSelectedIds, index, index - 1);
      } else if (moveRight) {
        const index = Number(moveRight.getAttribute('data-index') || -1);
        featuredSelectedIds = moveItem(featuredSelectedIds, index, index + 1);
      } else {
        return;
      }
      syncHiddenFields();
      renderFeaturedPicker();
      renderSelectedFeatured();
    });

    slideshowSearch?.addEventListener('input', renderSlideshowPicker);
    featuredSearch?.addEventListener('input', renderFeaturedPicker);

    qs('[data-action="home-refresh"]')?.addEventListener('click', async () => {
      setError('');
      try {
        await Promise.all([loadProductsLibrary(), loadHome()]);
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

    try {
      await Promise.all([loadProductsLibrary(), loadHome(), loadConfig()]);
      syncHiddenFields();
      renderSlideshowPicker();
      renderFeaturedPicker();
      renderSelectedSlideshow();
      renderSelectedFeatured();
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

    await initAdminLogin();
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
