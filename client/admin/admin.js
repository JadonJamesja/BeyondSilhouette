/* Beyond Silhouette — Admin (DB-backed) */
(() => {
  'use strict';

  const THEME_KEY = 'bs_admin_theme';
  const PAGE_SIZE = 12;
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const fmtJMD = (n) => {
    const value = Number(n);
    const safe = Number.isFinite(value) ? value : 0;
    return `J$ ${safe.toLocaleString('en-JM')}`;
  };

  const escapeHtml = (value) => String(value ?? '')
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

  function toast(message, kind = 'info') {
    let el = qs('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = String(message || 'Done.');
    el.dataset.kind = kind;
    el.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('show'), 2200);
  }

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

  let meCache = null;
  let sharedOrders = [];

  async function fetchMe(force = false) {
    if (meCache && !force) return meCache;
    const { res, data } = await apiJSON('/api/me');
    if (!res.ok || !data?.ok) {
      meCache = null;
      return null;
    }
    meCache = data.user || null;
    return meCache;
  }

  function isAdminUser(user) {
    return !!user && String(user.role || '').toLowerCase() === 'admin';
  }

  function inAdminFolder() {
    return location.pathname.includes('/admin/');
  }

  function currentPageName() {
    const path = String(location.pathname || '').replace(/\/$/, '');
    const last = path.split('/').pop() || '';
    return last.toLowerCase();
  }

  function pathIsAdminPage(name) {
    return currentPageName() === `${name}.html` || currentPageName() === name;
  }

  function isAdminLoginPage() {
    return pathIsAdminPage('login');
  }

  async function requireAdminGate() {
    if (!inAdminFolder()) return;
    const me = await fetchMe();
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
    meCache = null;
  }

  function hydrateAdminName() {
    const me = meCache;
    const display = me && (me.name || me.email) ? String(me.name || me.email) : 'Admin';
    const initial = display.trim().charAt(0).toUpperCase() || 'A';
    qsa('[data-ui="adminName"]').forEach((n) => n.textContent = display);
    qsa('.avatar').forEach((n) => n.textContent = initial);
  }

  function setActiveNav() {
    const page = currentPageName();
    qsa('.nav-item').forEach((link) => {
      const href = String(link.getAttribute('href') || '').split('/').pop()?.toLowerCase() || '';
      link.classList.toggle('active', href === page);
    });
  }

  function applyTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  }

  function loadSavedTheme() {
    let saved = 'light';
    try { saved = localStorage.getItem(THEME_KEY) || 'light'; } catch {}
    applyTheme(saved);
  }

  function bindThemeToggle() {
    qsa('[data-action="toggle-theme"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        toast(`Theme: ${next === 'dark' ? 'Dark' : 'Light'}`);
      });
    });
  }

  function bindSidebarToggle() {
    const toggle = qs('[data-action="toggle-sidebar"]');
    if (!toggle) return;
    const isMobile = () => window.matchMedia('(max-width: 920px)').matches;
    const closeMobileSidebar = () => document.body.classList.remove('sidebar-open');

    toggle.addEventListener('click', () => {
      if (!isMobile()) return;
      document.body.classList.toggle('sidebar-open');
    });

    document.addEventListener('click', (e) => {
      if (!isMobile()) return;
      if (e.target.closest('.sidebar') || e.target.closest('[data-action="toggle-sidebar"]')) return;
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

  function bindToasts() {
    qsa('[data-action="toast"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        toast(btn.getAttribute('data-toast') || 'Done.');
      });
    });
  }

  async function initAdminLogin() {
    if (!isAdminLoginPage()) return;
    const form = qs('#loginForm');
    const errorBox = qs('[data-ui="error"]');
    const setError = (msg) => {
      if (!errorBox) return;
      errorBox.hidden = !msg;
      errorBox.textContent = msg || '';
    };

    form?.addEventListener('submit', async (e) => {
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
      meCache = data.user || null;
      const me = await fetchMe(true);
      if (!isAdminUser(me)) {
        await logoutEverywhere();
        setError('This account is not an admin.');
        return;
      }
      location.href = './dashboard.html';
    });

    const googleBtn = qs('#adminGoogleBtn');
    if (!googleBtn) return;

    const { res: cfgRes, data: cfg } = await apiJSON('/api/public/config');
    const clientId = cfg?.googleClientId;
    if (!cfgRes.ok || !clientId || !window.google?.accounts?.id) {
      googleBtn.hidden = true;
      return;
    }

    function onCredential(resp) {
      const credential = String(resp?.credential || '').trim();
      if (!credential) return;
      setError('');
      apiJSON('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential }),
      }).then(async ({ res, data }) => {
        if (!res.ok || !data?.ok) throw new Error(data?.error || 'Google login failed.');
        meCache = data.user || null;
        const me = await fetchMe(true);
        if (!isAdminUser(me)) {
          await logoutEverywhere();
          setError('This account is not an admin.');
          return;
        }
        location.href = './dashboard.html';
      }).catch((err) => setError(String(err?.message || 'Google login failed.')));
    }

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

  async function getAdminOrders(force = false) {
    if (sharedOrders.length && !force) return sharedOrders;
    const { res, data } = await apiJSON('/api/admin/orders');
    if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load orders.');
    sharedOrders = Array.isArray(data.orders) ? data.orders : [];
    return sharedOrders;
  }

  function getRangeBounds(preset, startValue, endValue) {
    const now = new Date();
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    let start = null;
    let end = null;
    switch (preset) {
      case 'today':
        start = startOfDay(now);
        end = endOfDay(now);
        break;
      case 'yesterday': {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        start = startOfDay(d);
        end = endOfDay(d);
        break;
      }
      case 'last7': {
        start = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
        end = endOfDay(now);
        break;
      }
      case 'last30': {
        start = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
        end = endOfDay(now);
        break;
      }
      case 'thisMonth':
        start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
        end = endOfDay(now);
        break;
      case 'custom': {
        const s = startValue ? new Date(startValue + 'T00:00:00') : null;
        const e = endValue ? new Date(endValue + 'T23:59:59') : null;
        if (s && Number.isFinite(s.getTime())) start = s;
        if (e && Number.isFinite(e.getTime())) end = e;
        break;
      }
      default:
        break;
    }
    return { start, end };
  }

  function filterOrdersByRange(orders, range) {
    if (!range.start && !range.end) return orders.slice();
    return orders.filter((order) => {
      const at = new Date(order?.createdAt || 0);
      if (!Number.isFinite(at.getTime())) return false;
      if (range.start && at < range.start) return false;
      if (range.end && at > range.end) return false;
      return true;
    });
  }

  async function initDashboard() {
    if (!pathIsAdminPage('dashboard')) return;

    const revenue = qs('#statRevenueValue');
    const ordersCount = qs('#statOrdersValue');
    const customersCount = qs('#statCustomersValue');
    const lowStock = qs('#statLowStockValue');
    const lowSub = qs('#statLowStockSub');
    const revenueSub = qs('#statRevenueSub');
    const ordersSub = qs('#statOrdersSub');
    const customersSub = qs('#statCustomersSub');
    const tbody = qs('#recentOrdersTbody');
    const preset = qs('#rangePreset');
    const startInput = qs('#rangeStart');
    const endInput = qs('#rangeEnd');
    const applyBtn = qs('#applyRangeBtn');
    const hint = qs('.hint');

    let stats = null;
    let orders = [];

    function renderRange() {
      if (!stats) return;
      const range = getRangeBounds(String(preset?.value || 'last30'), startInput?.value, endInput?.value);
      const filtered = filterOrdersByRange(orders, range);
      const revenueTotal = filtered.reduce((sum, o) => sum + Number(o.totalJMD || 0), 0);
      const uniqueCustomers = new Set(filtered.map((o) => String(o.email || '').toLowerCase()).filter(Boolean));

      if (revenue) revenue.textContent = fmtJMD(revenueTotal);
      if (ordersCount) ordersCount.textContent = String(filtered.length);
      if (customersCount) customersCount.textContent = String(stats.usersCount ?? 0);
      if (lowStock) lowStock.textContent = String(stats.lowStockCount ?? 0);
      if (lowSub) lowSub.textContent = `≤ ${Number(stats.lowStockThreshold ?? 3)} in stock`;
      if (revenueSub) revenueSub.textContent = filtered.length ? 'Range total' : 'No orders in range';
      if (ordersSub) ordersSub.textContent = `${filtered.length} order${filtered.length === 1 ? '' : 's'} in range`;
      if (customersSub) customersSub.textContent = `${uniqueCustomers.size} active customer${uniqueCustomers.size === 1 ? '' : 's'} in range`;
      if (hint) {
        hint.textContent = range.start || range.end
          ? `Showing ${filtered.length} order${filtered.length === 1 ? '' : 's'} for the selected range.`
          : 'Showing all available order data.';
      }

      if (!tbody) return;
      const recent = filtered.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
      if (!recent.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="muted">No orders in this range.</td></tr>';
        return;
      }
      tbody.innerHTML = recent.map((o) => `
        <tr>
          <td class="mono">${escapeHtml(o.id || '')}</td>
          <td>${escapeHtml(o.customerName || o.email || '')}</td>
          <td>${statusChip(o.status)}</td>
          <td class="right">${fmtJMD(o.totalJMD)}</td>
        </tr>
      `).join('');
    }

    try {
      const [statsResp, ordersResp] = await Promise.all([
        apiJSON('/api/admin/stats'),
        apiJSON('/api/admin/orders'),
      ]);
      if (!statsResp.res.ok || !statsResp.data?.ok) throw new Error(statsResp.data?.error || 'Failed to load stats.');
      if (!ordersResp.res.ok || !ordersResp.data?.ok) throw new Error(ordersResp.data?.error || 'Failed to load orders.');
      stats = statsResp.data.stats || {};
      orders = Array.isArray(ordersResp.data.orders) ? ordersResp.data.orders : [];
      sharedOrders = orders.slice();
      renderRange();
    } catch (err) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="muted">Could not load dashboard data.</td></tr>';
      toast(err?.message || 'Could not load dashboard data.', 'error');
    }

    applyBtn?.addEventListener('click', renderRange);
    preset?.addEventListener('change', renderRange);
  }

  async function fetchAdminOrder(id) {
    const { res, data } = await apiJSON(`/api/admin/orders/${encodeURIComponent(id)}`);
    if (!res.ok || !data?.ok) throw new Error(data?.error || 'Could not load order.');
    return data.order;
  }

  async function updateOrderStatus(id, status) {
    const { res, data } = await apiJSON(`/api/admin/orders/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to update order status.');
    return data.order;
  }

  async function showOrderModal(id) {
    const modal = qs('#orderModal');
    const title = qs('#orderModalTitle');
    const meta = qs('#orderModalMeta');
    const historyWrap = qs('#orderModalHistory');
    const itemsWrap = qs('#orderModalItems');
    if (!modal || !meta || !itemsWrap) return;

    const setOpen = (open) => {
      modal.hidden = !open;
      document.body.classList.toggle('modal-open', !!open);
    };

    try {
      const order = await fetchAdminOrder(id);
      if (title) title.textContent = `Order ${order.id}`;
      const currentStatus = String(order.status || 'placed').toLowerCase();
      const created = order.createdAt ? new Date(order.createdAt).toLocaleString() : '—';
      meta.innerHTML = `
        <div class="grid grid-2 gap-12">
          <div><div class="muted">Customer</div><div>${escapeHtml(order.customerName || order.email || '')}</div></div>
          <div><div class="muted">Placed</div><div>${escapeHtml(created)}</div></div>
          <div><div class="muted">Total</div><div>${fmtJMD(order.totalJMD)}</div></div>
          <div>
            <div class="muted">Status</div>
            <div class="row gap-8 order-status-row">
              ${statusChip(currentStatus)}
              <select class="input input-sm" id="orderStatusSelect">
                ${['placed','processing','shipped','delivered','cancelled'].map((status) => `<option value="${status}" ${status === currentStatus ? 'selected' : ''}>${escapeHtml(prettyStatus(status))}</option>`).join('')}
              </select>
              <button class="btn btn-primary btn-sm" type="button" id="orderStatusSave">Save</button>
            </div>
          </div>
        </div>
      `;
      itemsWrap.innerHTML = `
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Item</th><th>Size</th><th>Qty</th><th class="right">Price</th></tr></thead>
            <tbody>
              ${(Array.isArray(order.items) ? order.items : []).map((it) => `
                <tr>
                  <td>${escapeHtml(it.name || 'Item')}</td>
                  <td>${escapeHtml(it.size || '')}</td>
                  <td>${escapeHtml(String(it.qty ?? ''))}</td>
                  <td class="right">${fmtJMD(it.priceJMD)}</td>
                </tr>
              `).join('') || '<tr><td colspan="4" class="muted">No items found.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
      const history = Array.isArray(order.history) ? order.history : [];
      if (historyWrap) {
        historyWrap.innerHTML = history.length ? `<ul class="timeline">${history.map((h) => `
          <li>
            <div class="muted">${escapeHtml(new Date(h.at).toLocaleString())}</div>
            <div><strong>${escapeHtml(prettyStatus(h.from))}</strong> → <strong>${escapeHtml(prettyStatus(h.to))}</strong></div>
            <div class="muted">By: ${escapeHtml(h.by || 'admin')}</div>
          </li>
        `).join('')}</ul>` : '<div class="muted">No status history yet.</div>';
      }
      qs('#orderStatusSave', meta)?.addEventListener('click', async () => {
        try {
          const next = String(qs('#orderStatusSelect', meta)?.value || '').trim().toLowerCase();
          if (!next) return;
          await updateOrderStatus(order.id, next);
          sharedOrders = [];
          toast('Order status updated.');
          await showOrderModal(order.id);
          document.dispatchEvent(new CustomEvent('bs:admin-orders-changed'));
        } catch (err) {
          toast(err?.message || 'Failed to update order status.', 'error');
        }
      }, { once: true });
      setOpen(true);
    } catch (err) {
      toast(err?.message || 'Could not load order.', 'error');
    }

    qs('#orderModalClose')?.addEventListener('click', () => setOpen(false), { once: true });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) setOpen(false);
    }, { once: true });
  }

  async function initOrders() {
    if (!pathIsAdminPage('orders')) return;
    const tbody = qs('#ordersTbody');
    const search = qs('#orderSearch');
    const prevBtn = qs('[data-action="orders-prev"]');
    const nextBtn = qs('[data-action="orders-next"]');
    const indicator = qs('[data-ui="ordersPageIndicator"]');
    let orders = [];
    let page = 1;

    const getFiltered = () => {
      const q = String(search?.value || '').trim().toLowerCase();
      return orders.filter((o) => {
        if (!q) return true;
        return [o.id, o.email, o.customerName, o.status].some((v) => String(v || '').toLowerCase().includes(q));
      });
    };

    function render() {
      if (!tbody) return;
      const filtered = getFiltered();
      const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      page = Math.min(Math.max(page, 1), totalPages);
      const start = (page - 1) * PAGE_SIZE;
      const rows = filtered.slice(start, start + PAGE_SIZE);
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="muted">No orders found.</td></tr>';
      } else {
        tbody.innerHTML = rows.map((o) => `
          <tr data-order-id="${escapeHtml(o.id)}" data-status="${escapeHtml(String(o.status || '').toLowerCase())}">
            <td class="mono">${escapeHtml(o.id)}</td>
            <td>${escapeHtml(o.createdAt ? new Date(o.createdAt).toLocaleString() : '—')}</td>
            <td>${escapeHtml(o.customerName || o.email || '')}</td>
            <td>${statusChip(o.status)}</td>
            <td class="right">${fmtJMD(o.totalJMD)}</td>
            <td class="right"><button class="btn btn-ghost btn-sm" type="button" data-action="view-order">View</button></td>
          </tr>
        `).join('');
      }
      if (indicator) indicator.textContent = `Page ${page} of ${totalPages}`;
      if (prevBtn) prevBtn.disabled = page <= 1;
      if (nextBtn) nextBtn.disabled = page >= totalPages;
    }

    async function load(force = false) {
      try {
        orders = await getAdminOrders(force);
        render();
      } catch (err) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="muted">Could not load orders.</td></tr>';
        toast(err?.message || 'Could not load orders.', 'error');
      }
    }

    tbody?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="view-order"]');
      if (!btn) return;
      const tr = e.target.closest('tr');
      const id = tr?.getAttribute('data-order-id');
      if (id) showOrderModal(id);
    });
    search?.addEventListener('input', () => { page = 1; render(); });
    prevBtn?.addEventListener('click', () => { page -= 1; render(); });
    nextBtn?.addEventListener('click', () => { page += 1; render(); });
    document.addEventListener('bs:admin-orders-changed', () => load(true));
    await load();
  }

  async function initCustomers() {
    if (!pathIsAdminPage('customers')) return;
    const tbody = qs('#customersTbody');
    const search = qs('#customerSearch');
    const modal = qs('#customerModal');
    const modalClose = qs('#customerModalClose');
    const modalTitle = qs('#customerModalTitle');
    const modalMeta = qs('#customerModalMeta');
    const modalOrders = qs('#customerModalOrders');
    let users = [];
    let orders = [];

    const setModalOpen = (open) => {
      if (!modal) return;
      modal.hidden = !open;
      document.body.classList.toggle('modal-open', !!open);
    };
    modalClose?.addEventListener('click', () => setModalOpen(false));
    modal?.addEventListener('click', (e) => { if (e.target === modal) setModalOpen(false); });

    const userStatsByEmail = (email) => {
      const em = String(email || '').toLowerCase();
      const mine = orders.filter((o) => String(o.email || '').toLowerCase() === em);
      return {
        count: mine.length,
        spend: mine.reduce((sum, o) => sum + Number(o.totalJMD || 0), 0),
        orders: mine,
      };
    };

    async function setRole(user, role) {
      const { res, data } = await apiJSON(`/api/admin/users/${encodeURIComponent(user.id)}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to update role.');
      users = users.map((row) => row.id === user.id ? data.user : row);
      return data.user;
    }

    function render() {
      if (!tbody) return;
      const q = String(search?.value || '').trim().toLowerCase();
      const rows = users.filter((u) => {
        if (!q) return true;
        return [u.name, u.email, u.role].some((v) => String(v || '').toLowerCase().includes(q));
      });
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="muted">No customers found.</td></tr>';
        return;
      }
      tbody.innerHTML = rows.map((u) => {
        const stats = userStatsByEmail(u.email);
        const isAdmin = String(u.role || '').toLowerCase() === 'admin';
        return `
          <tr data-user-id="${escapeHtml(u.id)}">
            <td>${escapeHtml(u.name || '—')}</td>
            <td>${escapeHtml(u.email || '')}</td>
            <td>${escapeHtml(prettyStatus(u.role || 'customer'))}</td>
            <td>${escapeHtml(String(stats.count))}</td>
            <td class="right">${fmtJMD(stats.spend)}</td>
            <td>${escapeHtml(u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—')}</td>
            <td class="right actions-cell">
              <button class="btn btn-ghost btn-sm" type="button" data-action="view-customer">View</button>
              <button class="btn btn-primary btn-sm" type="button" data-action="toggle-role">${isAdmin ? 'Make customer' : 'Promote'}</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    function openCustomer(id) {
      const user = users.find((u) => String(u.id) === String(id));
      if (!user || !modalMeta || !modalOrders) return;
      const stats = userStatsByEmail(user.email);
      if (modalTitle) modalTitle.textContent = user.name || user.email;
      modalMeta.innerHTML = `
        <div class="grid grid-2 gap-12">
          <div><div class="muted">Email</div><div>${escapeHtml(user.email)}</div></div>
          <div><div class="muted">Joined</div><div>${escapeHtml(user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—')}</div></div>
          <div>
            <div class="muted">Role</div>
            <div class="row gap-8">
              <select class="input input-sm" id="userRoleSelect">
                <option value="customer" ${String(user.role).toLowerCase() === 'customer' ? 'selected' : ''}>Customer</option>
                <option value="admin" ${String(user.role).toLowerCase() === 'admin' ? 'selected' : ''}>Admin</option>
              </select>
              <button class="btn btn-primary btn-sm" type="button" data-action="save-role">Save</button>
            </div>
          </div>
          <div><div class="muted">Orders</div><div>${escapeHtml(String(stats.count))}</div></div>
          <div><div class="muted">Lifetime value</div><div>${fmtJMD(stats.spend)}</div></div>
        </div>
      `;
      modalOrders.innerHTML = stats.orders.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Order</th><th>Status</th><th>Total</th><th>Date</th><th class="right">Action</th></tr></thead><tbody>${stats.orders.map((o) => `
        <tr>
          <td class="mono">${escapeHtml(o.id)}</td>
          <td>${statusChip(o.status)}</td>
          <td>${fmtJMD(o.totalJMD)}</td>
          <td>${escapeHtml(o.createdAt ? new Date(o.createdAt).toLocaleString() : '—')}</td>
          <td class="right"><button class="btn btn-ghost btn-sm" type="button" data-action="open-customer-order" data-order-id="${escapeHtml(o.id)}">View order</button></td>
        </tr>
      `).join('')}</tbody></table></div>` : '<div class="muted">No orders yet.</div>';
      qs('[data-action="save-role"]', modalMeta)?.addEventListener('click', async () => {
        try {
          const role = String(qs('#userRoleSelect', modalMeta)?.value || '').trim().toLowerCase();
          await setRole(user, role);
          render();
          toast('Role updated.');
          setModalOpen(false);
        } catch (err) {
          toast(err?.message || 'Failed to update role.', 'error');
        }
      }, { once: true });
      modalOrders.querySelectorAll('[data-action="open-customer-order"]').forEach((btn) => {
        btn.addEventListener('click', () => showOrderModal(btn.getAttribute('data-order-id')));
      });
      setModalOpen(true);
    }

    async function load(force = false) {
      try {
        const [u, o] = await Promise.all([
          apiJSON('/api/admin/users'),
          force ? apiJSON('/api/admin/orders') : Promise.resolve({ res: { ok: true }, data: { ok: true, orders: await getAdminOrders() } }),
        ]);
        if (!u.res.ok || !u.data?.ok) throw new Error(u.data?.error || 'Failed to load customers.');
        users = Array.isArray(u.data.users) ? u.data.users : [];
        orders = Array.isArray(o.data?.orders) ? o.data.orders : await getAdminOrders(force);
        render();
      } catch (err) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="muted">Could not load customers.</td></tr>';
        toast(err?.message || 'Could not load customers.', 'error');
      }
    }

    tbody?.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      const id = tr?.getAttribute('data-user-id');
      if (!id) return;
      const user = users.find((u) => String(u.id) === String(id));
      if (!user) return;
      if (e.target.closest('[data-action="view-customer"]')) {
        openCustomer(id);
        return;
      }
      if (e.target.closest('[data-action="toggle-role"]')) {
        const nextRole = String(user.role || '').toLowerCase() === 'admin' ? 'customer' : 'admin';
        try {
          await setRole(user, nextRole);
          render();
          toast(nextRole === 'admin' ? 'User promoted to admin.' : 'User changed to customer.');
        } catch (err) {
          toast(err?.message || 'Failed to update role.', 'error');
        }
      }
    });

    search?.addEventListener('input', render);
    document.addEventListener('bs:admin-orders-changed', () => load(true));
    await load();
  }

  async function initProducts() {
    if (!pathIsAdminPage('products')) return;
    const form = qs('#productForm');
    if (!form) return;
    const listWrap = qs('.list');
    const nameInput = qs('[name="name"]', form);
    const descInput = qs('[name="description"]', form);
    const priceInput = qs('[name="price"]', form);
    const statusInput = qs('[name="status"]', form);
    const stockS = qs('[name="stockS"]', form);
    const stockM = qs('[name="stockM"]', form);
    const stockL = qs('[name="stockL"]', form);
    const stockXL = qs('[name="stockXL"]', form);
    const imagesInput = qs('#productImages');
    const previewName = qs('#previewName');
    const previewDesc = qs('#previewDesc');
    const previewPrice = qs('#previewPrice');
    const previewStock = qs('#previewStock');
    const previewStatus = qs('#previewStatus');
    const previewMedia = qs('#previewMedia');
    const imageGrid = qs('#imageGrid');
    const stockBadge = qs('#stockTotalBadge');
    const saveDraftBtn = qs('[data-action="save-draft"]');
    const publishBtn = qs('[data-action="publish-product"]');
    const deleteBtn = qs('[data-action="delete-product"]');
    const newBtn = qs('[data-action="new-product"]');
    const openShopBtn = qs('[data-action="open-shop"]');

    let editingId = null;
    let products = [];
    let images = [];

    const totalStock = () => ['S', 'M', 'L', 'XL'].reduce((sum, size) => sum + Number(qs(`[name="stock${size}"]`, form)?.value || 0), 0);
    const inventoryPayload = () => ['S', 'M', 'L', 'XL'].map((size) => ({ size, stock: Math.max(0, Math.floor(Number(qs(`[name="stock${size}"]`, form)?.value || 0))) }));

    function renderImagePreview() {
      const first = images[0]?.url || '';
      if (previewMedia) {
        previewMedia.innerHTML = first ? `<img src="${escapeHtml(first)}" alt="Preview" />` : '<span class="muted">No image selected</span>';
      }
      if (imageGrid) {
        imageGrid.innerHTML = images.length ? images.map((img, i) => `
          <div class="image-tile">
            <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || `Image ${i + 1}`)}" />
            <div class="meta">Image ${i + 1}</div>
          </div>
        `).join('') : '';
      }
    }

    function updatePreview() {
      if (previewName) previewName.textContent = nameInput?.value?.trim() || '—';
      if (previewDesc) previewDesc.textContent = descInput?.value?.trim() || '—';
      if (previewPrice) previewPrice.textContent = fmtJMD(Number(priceInput?.value || 0));
      if (previewStock) previewStock.textContent = `Stock: ${totalStock()}`;
      if (stockBadge) stockBadge.textContent = `Total: ${totalStock()}`;
      if (previewStatus) previewStatus.textContent = statusInput?.value === 'published' ? 'Published' : 'Draft';
      renderImagePreview();
    }

    function fillForm(product) {
      editingId = product.id;
      nameInput.value = product.name || '';
      descInput.value = product.description || '';
      priceInput.value = String(product.priceJMD || 0);
      statusInput.value = product.isPublished ? 'published' : 'draft';
      const bySize = Object.fromEntries((product.inventory || []).map((row) => [String(row.size).toUpperCase(), Number(row.stock || 0)]));
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
      statusInput.value = 'draft';
      images = [];
      updatePreview();
    }

    function renderList() {
      if (!listWrap) return;
      if (!products.length) {
        listWrap.innerHTML = '<div class="muted" style="padding:16px;">No products yet.</div>';
        return;
      }
      listWrap.innerHTML = products.map((p) => `
        <button type="button" class="card mini product-list-item" data-product-id="${escapeHtml(p.id)}">
          <div class="row-between">
            <div>
              <div><strong>${escapeHtml(p.name || 'Product')}</strong></div>
              <div class="muted">${escapeHtml(p.description || '')}</div>
            </div>
            <div class="right">
              <div>${fmtJMD(p.priceJMD)}</div>
              <div class="muted">${p.isPublished ? 'Published' : 'Draft'}</div>
            </div>
          </div>
        </button>
      `).join('');
    }

    async function loadProducts() {
      const { res, data } = await apiJSON('/api/admin/products');
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load products.');
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
      if (!payload.name) return toast('Product name is required.', 'error');
      const endpoint = editingId ? `/api/admin/products/${encodeURIComponent(editingId)}` : '/api/admin/products';
      const method = editingId ? 'PATCH' : 'POST';
      const { res, data } = await apiJSON(endpoint, { method, body: JSON.stringify(payload) });
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to save product.');
      await loadProducts();
      if (data.product) fillForm(data.product);
      toast(isPublished ? 'Product published.' : 'Draft saved.');
    }

    async function deleteProduct() {
      if (!editingId) return toast('Select a product first.', 'error');
      const confirmed = window.confirm('Delete this product? This cannot be undone.');
      if (!confirmed) return;
      const { res, data } = await apiJSON(`/api/admin/products/${encodeURIComponent(editingId)}`, { method: 'DELETE' });
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to delete product.');
      await loadProducts();
      resetForm();
      toast('Product deleted.');
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
    listWrap?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-product-id]');
      if (!btn) return;
      const id = btn.getAttribute('data-product-id');
      const product = products.find((p) => String(p.id) === String(id));
      if (product) fillForm(product);
    });
    saveDraftBtn?.addEventListener('click', async () => { try { await saveProduct(false); } catch (err) { toast(err?.message || 'Failed to save draft.', 'error'); } });
    publishBtn?.addEventListener('click', async () => { try { await saveProduct(true); } catch (err) { toast(err?.message || 'Failed to publish product.', 'error'); } });
    deleteBtn?.addEventListener('click', async () => { try { await deleteProduct(); } catch (err) { toast(err?.message || 'Failed to delete product.', 'error'); } });
    newBtn?.addEventListener('click', resetForm);
    openShopBtn?.addEventListener('click', () => { location.href = '../shop-page.html'; });

    resetForm();
    try { await loadProducts(); } catch (err) { toast(err?.message || 'Failed to load products.', 'error'); }
  }

  async function initSettings() {
    if (!pathIsAdminPage('settings')) return;
    const errBox = qs('[data-ui="settingsError"]');
    const statusBox = qs('[data-ui="settingsStatus"]');
    const headline = qs('#homeHeadline');
    const subheadline = qs('#homeSubheadline');
    const searchInput = qs('#settingsProductSearch');
    const slideshowInput = qs('#homeSlideshow');
    const featuredInput = qs('#homeFeatured');
    const slideshowPool = qs('#slideshowPool');
    const slideshowSelected = qs('#slideshowSelected');
    const featuredPool = qs('#featuredPool');
    const featuredSelected = qs('#featuredSelected');
    const slideshowCount = qs('#slideshowCount');
    const featuredCount = qs('#featuredCountInline');
    const lowStock = qs('#lowStockThreshold');

    let products = [];
    let slideshowUrls = [];
    let featuredIds = [];

    const setError = (msg) => {
      if (errBox) {
        errBox.hidden = !msg;
        errBox.textContent = msg || '';
      }
    };
    const setStatus = (msg) => {
      if (statusBox) statusBox.textContent = msg || '';
    };

    const normalizeImages = (product) => (Array.isArray(product?.images) ? product.images : []).map((img, idx) => ({
      url: String(img?.url || '').trim(),
      alt: String(img?.alt || product?.name || `Image ${idx + 1}`),
      productId: String(product?.id || ''),
      productName: String(product?.name || 'Product'),
    })).filter((img) => img.url);

    const matchesSearch = (product) => {
      const q = String(searchInput?.value || '').trim().toLowerCase();
      if (!q) return true;
      return [product?.name, product?.id].some((v) => String(v || '').toLowerCase().includes(q));
    };

    const thumb = (url, alt) => url
      ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt || 'Image')}" />`
      : '<div class="picker-thumb picker-thumb-empty">No image</div>';

    function syncInputs() {
      if (slideshowInput) slideshowInput.value = slideshowUrls.join('\n');
      if (featuredInput) featuredInput.value = featuredIds.join('\n');
      if (slideshowCount) slideshowCount.textContent = String(slideshowUrls.length);
      if (featuredCount) featuredCount.textContent = String(featuredIds.length);
    }

    function renderSlideshow() {
      const allImages = products.flatMap((product) => normalizeImages(product));
      if (slideshowSelected) {
        slideshowSelected.innerHTML = slideshowUrls.length ? slideshowUrls.map((url) => {
          const hit = allImages.find((img) => img.url === url);
          return `<button type="button" class="selection-card is-selected" data-remove-slideshow="${escapeHtml(url)}">${thumb(url, hit?.alt)}<div class="selection-card-body"><strong>${escapeHtml(hit?.productName || 'Selected image')}</strong><span class="muted">Remove</span></div></button>`;
        }).join('') : '<div class="muted">No slideshow images selected yet.</div>';
      }
      if (slideshowPool) {
        const pool = allImages.filter((img) => matchesSearch({ name: img.productName, id: img.productId }));
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
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load products.');
      products = Array.isArray(data.products) ? data.products : [];
    }

    async function loadHome() {
      const { res, data } = await apiJSON('/api/admin/site/home');
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load homepage settings.');
      const home = data.home || {};
      if (headline) headline.value = home.headline || '';
      if (subheadline) subheadline.value = home.subheadline || '';
      slideshowUrls = Array.isArray(home.slideshowUrls) ? home.slideshowUrls.slice(0, 6) : [];
      featuredIds = Array.isArray(home.featuredProductIds) ? home.featuredProductIds.slice(0, 3) : [];
    }

    async function saveHome() {
      const payload = {
        headline: headline?.value?.trim() || '',
        subheadline: subheadline?.value?.trim() || '',
        slideshowUrls: slideshowUrls.slice(0, 6),
        featuredProductIds: featuredIds.slice(0, 3),
      };
      const { res, data } = await apiJSON('/api/admin/site/home', { method: 'PUT', body: JSON.stringify(payload) });
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to save homepage settings.');
    }

    async function loadConfig() {
      const { res, data } = await apiJSON('/api/admin/config');
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load admin config.');
      if (lowStock) lowStock.value = String(data?.config?.lowStockThreshold ?? 3);
    }

    async function saveConfig() {
      const payload = { lowStockThreshold: Math.max(0, Math.floor(Number(lowStock?.value || 0))) };
      const { res, data } = await apiJSON('/api/admin/config', { method: 'PUT', body: JSON.stringify(payload) });
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to save admin config.');
    }

    searchInput?.addEventListener('input', renderAll);
    slideshowPool?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick-slideshow]');
      if (!btn) return;
      const url = btn.getAttribute('data-pick-slideshow');
      if (!url) return;
      if (slideshowUrls.includes(url)) slideshowUrls = slideshowUrls.filter((item) => item !== url);
      else {
        if (slideshowUrls.length >= 6) return toast('Limit: 6 slideshow images.', 'error');
        slideshowUrls = [...slideshowUrls, url];
      }
      renderAll();
    });
    slideshowSelected?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-slideshow]');
      if (!btn) return;
      slideshowUrls = slideshowUrls.filter((item) => item !== btn.getAttribute('data-remove-slideshow'));
      renderAll();
    });
    featuredPool?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick-featured]');
      if (!btn) return;
      const id = btn.getAttribute('data-pick-featured');
      if (!id) return;
      if (featuredIds.includes(id)) featuredIds = featuredIds.filter((item) => item !== id);
      else {
        if (featuredIds.length >= 3) return toast('Limit: 3 featured products.', 'error');
        featuredIds = [...featuredIds, id];
      }
      renderAll();
    });
    featuredSelected?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-featured]');
      if (!btn) return;
      featuredIds = featuredIds.filter((item) => item !== btn.getAttribute('data-remove-featured'));
      renderAll();
    });

    qs('[data-action="home-refresh"]')?.addEventListener('click', async () => {
      setError('');
      setStatus('Refreshing…');
      try {
        await Promise.all([loadProducts(), loadHome()]);
        renderAll();
        setStatus('Homepage settings refreshed.');
      } catch (err) {
        setError(err?.message || 'Failed to refresh settings.');
        setStatus('');
      }
    });

    qs('[data-action="home-save"]')?.addEventListener('click', async () => {
      setError('');
      setStatus('Saving homepage settings…');
      try {
        await saveHome();
        setStatus('Homepage settings saved.');
        toast('Homepage settings saved.');
      } catch (err) {
        setError(err?.message || 'Failed to save homepage settings.');
        setStatus('');
      }
    });

    qs('[data-action="config-save"]')?.addEventListener('click', async () => {
      setError('');
      setStatus('Saving admin config…');
      try {
        await saveConfig();
        setStatus('Admin config saved.');
        toast('Admin config saved.');
      } catch (err) {
        setError(err?.message || 'Failed to save admin config.');
        setStatus('');
      }
    });

    try {
      await Promise.all([loadProducts(), loadHome(), loadConfig()]);
      renderAll();
      setStatus('Settings loaded.');
    } catch (err) {
      setError(err?.message || 'Failed to load settings.');
    }
  }

  async function init() {
    qsa('[data-ui="year"]').forEach((n) => n.textContent = String(new Date().getFullYear()));
    loadSavedTheme();
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
    init().catch((err) => console.error(err));
  });
})();
