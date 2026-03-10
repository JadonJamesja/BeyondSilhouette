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


  const prettyStatus = (status) => {
    const raw = String(status || '').trim().toLowerCase();
    if (!raw) return '—';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  };

  const statusChip = (status) => {
    const raw = String(status || '').trim().toLowerCase() || 'placed';
    return `<span class="chip chip-status chip-${escapeHtml(raw)}">${escapeHtml(prettyStatus(raw))}</span>`;
  };

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


  function setActiveNav() {
    const path = String(location.pathname || '').replace(/\/$/, '');
    qsa('.nav-item').forEach((link) => {
      const href = String(link.getAttribute('href') || '');
      const active = href && (path.endsWith(href.replace(/^\.\//, '/admin/')) || path.endsWith(href.replace(/^\.\//, '')));
      link.classList.toggle('active', !!active);
    });
  }

  // -----------------------------
  // Theme toggle (persistent across admin pages)
  // -----------------------------
  const THEME_KEY = 'bs_admin_theme';

  function applyAdminTheme(theme) {
    const safe = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', safe);
    try { localStorage.setItem(THEME_KEY, safe); } catch (_) {}
  }

  function bindThemeToggle() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved) applyAdminTheme(saved);
    } catch (_) {}

    qsa('[data-action="toggle-theme"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const html = document.documentElement;
        const cur = html.getAttribute('data-theme') || 'light';
        const next = cur === 'dark' ? 'light' : 'dark';
        applyAdminTheme(next);
      });
    });
  }

  // Sidebar toggle (non-persistent)
  function bindSidebarToggle() {
    const toggle = qs('[data-action="toggle-sidebar"]');
    if (!toggle) return;

    const isMobile = () => window.matchMedia('(max-width: 920px)').matches;

    const closeMobileSidebar = () => {
      document.body.classList.remove('sidebar-open');
    };

    toggle.addEventListener('click', () => {
      if (!isMobile()) return;
      document.body.classList.toggle('sidebar-open');
    });

    document.addEventListener('click', (e) => {
      if (!isMobile()) return;
      const clickedToggle = e.target.closest('[data-action="toggle-sidebar"]');
      const clickedSidebar = e.target.closest('.sidebar');
      if (clickedToggle || clickedSidebar) return;
      closeMobileSidebar();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMobileSidebar();
    });

    window.addEventListener('resize', () => {
      if (!isMobile()) closeMobileSidebar();
    });
  }

  function bindLogoutButtons() {
    qsa('[data-action="logout"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await logoutEverywhere();
        location.href = './login.html';
      });
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
      document.body.classList.toggle('modal-open', !!open);
    };
    modalClose?.addEventListener('click', () => setModalOpen(false));
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) setModalOpen(false);
    });

    let orders = [];
    let orderPage = 1;
    const pageSize = 10;
    const pageStatus = qs('#ordersPageStatus');
    const prevBtn = qs('[data-action="orders-prev"]');
    const nextBtn = qs('[data-action="orders-next"]');

    async function load() {
      const { res, data } = await apiJSON('/api/admin/orders');
      if (!res.ok || !data?.ok) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="muted">Could not load orders.</td></tr>';
        if (pageStatus) pageStatus.textContent = 'Orders unavailable';
        return;
      }
      orders = Array.isArray(data.orders) ? data.orders : [];
      orderPage = 1;
      render();
    }

    function render() {
      if (!tbody) return;
      const q = String(search?.value || '').trim().toLowerCase();

      const filtered = orders.filter((o) => {
        if (!q) return true;
        return (
          String(o.id || '').toLowerCase().includes(q) ||
          String(o.email || '').toLowerCase().includes(q) ||
          String(o.customerName || '').toLowerCase().includes(q) ||
          String(o.status || '').toLowerCase().includes(q)
        );
      });

      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      if (orderPage > totalPages) orderPage = totalPages;
      const start = (orderPage - 1) * pageSize;
      const rows = filtered.slice(start, start + pageSize);

      if (pageStatus) pageStatus.textContent = filtered.length ? `Page ${orderPage} of ${totalPages}` : 'No orders';
      if (prevBtn) prevBtn.disabled = orderPage <= 1;
      if (nextBtn) nextBtn.disabled = orderPage >= totalPages;

      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="muted">No orders found.</td></tr>';
        return;
      }

      tbody.innerHTML = rows
        .map((o) => {
          const date = o.createdAt ? new Date(o.createdAt).toLocaleString() : '—';
          const status = String(o.status || '').toLowerCase() || 'placed';
          return `
            <tr data-order-id="${escapeHtml(o.id)}" data-status="${escapeHtml(status)}">
              <td class="mono">${escapeHtml(o.id)}</td>
              <td>${escapeHtml(date)}</td>
              <td>${escapeHtml(o.customerName || o.email || '')}</td>
              <td>${statusChip(status)}</td>
              <td class="right">${fmtJMD(o.totalJMD)}</td>
              <td class="right"><button class="btn btn-ghost btn-sm" type="button" data-action="view-order">View</button></td>
            </tr>
          `;
        })
        .join('');
    }

    async function updateOrderStatus(id, status) {
      const { res, data } = await apiJSON(`/api/admin/orders/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to update order status.');
    }

    async function openOrder(id) {
      const { res, data } = await apiJSON(`/api/admin/orders/${encodeURIComponent(id)}`);
      if (!res.ok || !data?.ok) {
        alert(data?.error || 'Could not load order.');
        return;
      }

      const o = data.order;
      if (modalTitle) modalTitle.textContent = `Order ${o.id}`;
      if (modalMeta) {
        const date = o.createdAt ? new Date(o.createdAt).toLocaleString() : '—';
        const currentStatus = String(o.status || 'placed').toLowerCase();
        modalMeta.innerHTML = `
          <div class="grid grid-2 gap-12">
            <div><div class="muted">Customer</div><div>${escapeHtml(o.customerName || o.email || '')}</div></div>
            <div>
              <div class="muted">Status</div>
              <div class="row gap-8 order-status-row">
                ${statusChip(currentStatus)}
                <select class="input input-sm" id="orderStatusSelect">
                  ${['placed','processing','shipped','delivered','cancelled'].map((status) => `<option value="${status}" ${status === currentStatus ? 'selected' : ''}>${escapeHtml(prettyStatus(status))}</option>`).join('')}
                </select>
                <button class="btn btn-primary btn-sm" type="button" id="orderStatusSave">Update</button>
              </div>
            </div>
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
              <thead><tr><th>Item</th><th>Size</th><th>Qty</th><th class="right">Price</th></tr></thead>
              <tbody>
                ${items.map((it) => `
                  <tr>
                    <td>${escapeHtml(it.name || 'Item')}</td>
                    <td>${escapeHtml(it.size || '')}</td>
                    <td>${escapeHtml(String(it.qty ?? ''))}</td>
                    <td class="right">${fmtJMD(it.priceJMD)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      if (modalHistory) {
        const hist = Array.isArray(o.history) ? o.history : [];
        modalHistory.innerHTML = hist.length
          ? `<ul class="timeline">${hist.map((h) => `
              <li>
                <div class="muted">${escapeHtml(new Date(h.at).toLocaleString())}</div>
                <div><strong>${escapeHtml(prettyStatus(h.from))}</strong> → <strong>${escapeHtml(prettyStatus(h.to))}</strong></div>
                <div class="muted">By: ${escapeHtml(h.by || 'admin')}</div>
                ${h.note ? `<div class="muted">${escapeHtml(h.note)}</div>` : ''}
              </li>`).join('')}</ul>`
          : `<div class="muted">No status history yet.</div>`;
      }

      qs('#orderStatusSave', modalMeta)?.addEventListener('click', async () => {
        const next = String(qs('#orderStatusSelect', modalMeta)?.value || '').trim().toLowerCase();
        if (!next) return;
        try {
          await updateOrderStatus(o.id, next);
          await load();
          await openOrder(o.id);
        } catch (err) {
          alert(err?.message || 'Failed to update status.');
        }
      });

      setModalOpen(true);
    }

    tbody?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="view-order"]');
      if (!btn) return;
      const tr = e.target.closest('tr');
      const id = tr?.getAttribute('data-order-id');
      if (id) openOrder(id);
    });

    search?.addEventListener('input', () => { orderPage = 1; render(); });
    prevBtn?.addEventListener('click', () => { if (orderPage > 1) { orderPage -= 1; render(); } });
    nextBtn?.addEventListener('click', () => { orderPage += 1; render(); });

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
              <div class="hint mt-8">Save role changes for this customer account.</div>
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
      const ok = window.confirm('Delete this product? This cannot be undone.');
      if (!ok) return;
      const { res, data } = await apiJSON(`/api/admin/products/${encodeURIComponent(editingId)}`, { method: 'DELETE' });
      if (!res.ok || !data?.ok) {
        alert(data?.error || 'Failed to delete product.');
        return;
      }
      await loadProducts();
      resetForm();
      alert('Product deleted.');
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
    const slideshowInput = qs('#homeSlideshow');
    const featuredInput = qs('#homeFeatured');
    const searchInput = qs('#settingsProductSearch');
    const uploadInput = qs('#homeUploadImages');
    const slideshowPool = qs('#slideshowPool');
    const slideshowSelected = qs('#slideshowSelected');
    const featuredPool = qs('#featuredPool');
    const featuredSelected = qs('#featuredSelected');
    const slideshowCount = qs('#slideshowCount');
    const featuredCount = qs('#featuredCountInline');
    const lowStock = qs('#lowStockThreshold');
    const saveNote = qs('#settingsSaveNote');

    let products = [];
    let slideshowUrls = [];
    let featuredIds = [];

    const setError = (msg) => {
      if (!errBox) return;
      errBox.hidden = !msg;
      errBox.textContent = msg || '';
    };

    const setStatus = (msg) => {
      if (saveNote) saveNote.textContent = msg || '';
    };

    const normalizeImages = (product) => {
      const imgs = Array.isArray(product?.images) ? product.images : [];
      return imgs.map((img, idx) => ({
        url: String(img?.url || '').trim(),
        alt: String(img?.alt || product?.name || `Image ${idx + 1}`),
        productId: String(product?.id || ''),
        productName: String(product?.name || 'Product'),
      })).filter((img) => img.url);
    };

    const syncInputs = () => {
      if (slideshowInput) slideshowInput.value = slideshowUrls.join('\n');
      if (featuredInput) featuredInput.value = featuredIds.join('\n');
      if (slideshowCount) slideshowCount.textContent = String(slideshowUrls.length);
      if (featuredCount) featuredCount.textContent = String(featuredIds.length);
    };

    const matchesSearch = (product) => {
      const q = String(searchInput?.value || '').trim().toLowerCase();
      if (!q) return true;
      return String(product?.name || '').toLowerCase().includes(q) || String(product?.id || '').toLowerCase().includes(q);
    };

    const thumb = (url, alt) => url
      ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt || 'Image')}" loading="lazy" />`
      : '<div class="picker-thumb picker-thumb-empty">No image</div>';

    function renderSlideshow() {
      const allImages = products.flatMap((product) => normalizeImages(product));
      if (slideshowSelected) {
        slideshowSelected.innerHTML = slideshowUrls.length ? slideshowUrls.map((url) => {
          const hit = allImages.find((img) => img.url === url);
          return `<button type="button" class="selection-card is-selected" data-remove-slideshow="${escapeHtml(url)}">${thumb(url, hit?.alt)}<div class="selection-card-body"><strong>${escapeHtml(hit?.productName || 'Custom slide')}</strong><span class="muted">Remove</span></div></button>`;
        }).join('') : '<div class="muted">No slideshow images selected yet.</div>';
      }
      if (slideshowPool) {
        const pool = products.flatMap((product) => normalizeImages(product)).filter((img) => matchesSearch({ name: img.productName, id: img.productId }));
        slideshowPool.innerHTML = pool.length ? pool.map((img) => {
          const active = slideshowUrls.includes(img.url);
          return `<button type="button" class="selection-card ${active ? 'is-selected' : ''}" data-pick-slideshow="${escapeHtml(img.url)}">${thumb(img.url, img.alt)}<div class="selection-card-body"><strong>${escapeHtml(img.productName)}</strong><span class="muted mono">${escapeHtml(img.productId)}</span></div></button>`;
        }).join('') : '<div class="muted">No product images available.</div>';
      }
    }

    function renderFeatured() {
      if (featuredSelected) {
        featuredSelected.innerHTML = featuredIds.length ? featuredIds.map((id) => {
          const p = products.find((row) => row.id === id);
          const cover = p?.images?.[0]?.url || '';
          return `<button type="button" class="selection-card is-selected" data-remove-featured="${escapeHtml(id)}">${thumb(cover, p?.name || 'Product')}<div class="selection-card-body"><strong>${escapeHtml(p?.name || id)}</strong><span class="muted">Remove</span></div></button>`;
        }).join('') : '<div class="muted">No featured products selected yet.</div>';
      }
      if (featuredPool) {
        const pool = products.filter(matchesSearch);
        featuredPool.innerHTML = pool.length ? pool.map((p) => {
          const active = featuredIds.includes(p.id);
          const cover = p?.images?.[0]?.url || '';
          return `<button type="button" class="selection-card ${active ? 'is-selected' : ''}" data-pick-featured="${escapeHtml(p.id)}">${thumb(cover, p?.name || 'Product')}<div class="selection-card-body"><strong>${escapeHtml(p.name || 'Product')}</strong><span class="muted">${escapeHtml(p.isPublished ? 'Published' : 'Draft')}</span></div></button>`;
        }).join('') : '<div class="muted">No products available.</div>';
      }
    }

    function renderAll() {
      syncInputs();
      renderSlideshow();
      renderFeatured();
    }

    async function loadProducts() {
      const { res, data } = await apiJSON('/api/admin/products');
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load products');
      products = Array.isArray(data.products) ? data.products : [];
    }

    async function loadHome() {
      const { res, data } = await apiJSON('/api/admin/site/home');
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load home settings');
      const home = data.home || {};
      if (headline) headline.value = home.headline || '';
      if (subheadline) subheadline.value = home.subheadline || '';
      slideshowUrls = Array.isArray(home.slideshowUrls) ? home.slideshowUrls.filter(Boolean).slice(0, 6) : [];
      featuredIds = Array.isArray(home.featuredProductIds) ? home.featuredProductIds.filter(Boolean).slice(0, 3) : [];
    }

    async function saveHome() {
      const payload = {
        headline: headline?.value?.trim() || '',
        subheadline: subheadline?.value?.trim() || '',
        slideshowUrls: slideshowUrls.slice(0, 6),
        featuredProductIds: featuredIds.slice(0, 3),
      };
      const { res, data } = await apiJSON('/api/admin/site/home', { method: 'PUT', body: JSON.stringify(payload) });
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to save home settings');
    }

    async function loadConfig() {
      const { res, data } = await apiJSON('/api/admin/config');
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load config');
      if (lowStock) lowStock.value = String(data?.config?.lowStockThreshold ?? 3);
    }

    async function saveConfig() {
      const payload = { lowStockThreshold: Math.max(0, Math.floor(Number(lowStock?.value || 0))) };
      const { res, data } = await apiJSON('/api/admin/config', { method: 'PUT', body: JSON.stringify(payload) });
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to save config');
    }

    async function uploadSlideImage(file) {
      if (!file) throw new Error('No file selected.');
      const allowed = new Set(['image/png', 'image/jpeg', 'image/webp']);
      if (!allowed.has(file.type)) throw new Error('Only PNG, JPG, and WEBP files are allowed.');
      if (file.size > 2 * 1024 * 1024) throw new Error('Image must be 2MB or smaller.');

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image.'));
        reader.readAsDataURL(file);
      });

      const { res, data } = await apiJSON('/api/admin/site/home/upload', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, dataUrl }),
      });

      if (!res.ok || !data?.ok || !data?.url) throw new Error(data?.error || 'Failed to upload image.');
      return String(data.url);
    }

    searchInput?.addEventListener('input', renderAll);

    uploadInput?.addEventListener('change', async (e) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      setError('');
      setStatus('Uploading image…');
      try {
        if (slideshowUrls.length >= 6) throw new Error('Limit: 6 slideshow images.');
        const url = await uploadSlideImage(file);
        if (!slideshowUrls.includes(url)) slideshowUrls = [...slideshowUrls, url];
        renderAll();
        setStatus('Image uploaded. Save homepage settings to publish it.');
      } catch (e) {
        setError(String(e?.message || 'Failed to upload image.'));
        setStatus('');
      } finally {
        if (uploadInput) uploadInput.value = '';
      }
    });

    slideshowPool?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick-slideshow]');
      if (!btn) return;
      const url = btn.getAttribute('data-pick-slideshow');
      if (!url) return;
      if (slideshowUrls.includes(url)) {
        slideshowUrls = slideshowUrls.filter((item) => item !== url);
      } else {
        if (slideshowUrls.length >= 6) {
          setError('Limit: 6 slideshow images.');
          return;
        }
        slideshowUrls = [...slideshowUrls, url];
      }
      setError('');
      renderAll();
    });

    slideshowSelected?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-slideshow]');
      if (!btn) return;
      const url = btn.getAttribute('data-remove-slideshow');
      slideshowUrls = slideshowUrls.filter((item) => item !== url);
      renderAll();
    });

    featuredPool?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick-featured]');
      if (!btn) return;
      const id = btn.getAttribute('data-pick-featured');
      if (!id) return;
      if (featuredIds.includes(id)) {
        featuredIds = featuredIds.filter((item) => item !== id);
      } else {
        if (featuredIds.length >= 3) {
          setError('Limit: 3 featured products.');
          return;
        }
        featuredIds = [...featuredIds, id];
      }
      setError('');
      renderAll();
    });

    featuredSelected?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-featured]');
      if (!btn) return;
      const id = btn.getAttribute('data-remove-featured');
      featuredIds = featuredIds.filter((item) => item !== id);
      renderAll();
    });

    qs('[data-action="home-refresh"]')?.addEventListener('click', async () => {
      setError('');
      setStatus('Refreshing homepage settings…');
      try {
        const results = await Promise.allSettled([loadProducts(), loadHome()]);
        const failures = results.filter((r) => r.status === 'rejected');
        renderAll();
        if (failures.length) throw failures[0].reason;
        setStatus('Homepage settings refreshed.');
      } catch (e) {
        setError(String(e?.message || 'Failed to refresh'));
        setStatus('');
      }
    });

    qs('[data-action="home-save"]')?.addEventListener('click', async () => {
      setError('');
      setStatus('Saving homepage settings…');
      try {
        await saveHome();
        setStatus('Homepage settings saved. Refresh the homepage to confirm the changes.');
      } catch (e) {
        setError(String(e?.message || 'Failed to save home settings'));
        setStatus('');
      }
    });

    qs('[data-action="config-save"]')?.addEventListener('click', async () => {
      setError('');
      setStatus('Saving admin config…');
      try {
        await saveConfig();
        setStatus('Admin config saved.');
      } catch (e) {
        setError(String(e?.message || 'Failed to save config'));
        setStatus('');
      }
    });

    try {
      setError('');
      setStatus('Loading settings…');
      const results = await Promise.allSettled([loadProducts(), loadHome(), loadConfig()]);
      const failures = results.filter((r) => r.status === 'rejected');
      renderAll();
      if (!failures.length) {
        setStatus('Settings loaded.');
        return;
      }
      const firstError = failures[0]?.reason?.message || 'Some settings failed to load.';
      setError(firstError);
      setStatus('Settings loaded with partial issues.');
    } catch (e) {
      setError(String(e?.message || 'Failed to load settings'));
      setStatus('');
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
    bindLogoutButtons();

    await requireAdminGate();
    await fetchMe();
    hydrateAdminName();
    setActiveNav();

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
