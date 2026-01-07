(() => {
  const API_BASE = "http://localhost:3000"; // keep consistent with your server
  const $ = (sel, root = document) => root.querySelector(sel);

  const els = {
    sidebar: $("#sidebar"),
    sidebarToggle: $("#sidebarToggle"),
    logoutBtn: $("#logoutBtn"),
    refreshBtn: $("#refreshBtn"),
    themeBtn: $("#themeBtn"),
    toast: $("#toast"),

    adminName: $("#adminName"),
    adminEmail: $("#adminEmail"),
    adminAvatar: $("#adminAvatar"),

    todayLine: $("#todayLine"),
    apiStatusLine: $("#apiStatusLine"),
    apiStatusPill: $("#apiStatusPill"),

    kpiRevenue: $("#kpiRevenue"),
    kpiOrders: $("#kpiOrders"),
    kpiProducts: $("#kpiProducts"),
    kpiPending: $("#kpiPending"),

    revDelta: $("#revDelta"),
    ordDelta: $("#ordDelta"),
    lowStockPill: $("#lowStockPill"),
    pendingPill: $("#pendingPill"),
    lowStockCount: $("#lowStockCount"),

    recentOrdersTable: $("#recentOrdersTable"),
    recentOrdersEmpty: $("#recentOrdersEmpty"),
  };

  function moneyJMD(n){
    const v = Number(n || 0);
    return "J$" + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function toast(msg){
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove("show"), 2400);
  }

  function setTheme(next){
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("bs_admin_theme", next);
  }

  function loadTheme(){
    const t = localStorage.getItem("bs_admin_theme") || "dark";
    setTheme(t);
  }

  async function apiFetch(path, options = {}){
    const res = await fetch(API_BASE + path, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  }

  function setApiStatus(ok){
    if (!els.apiStatusLine || !els.apiStatusPill) return;
    if (ok){
      els.apiStatusLine.textContent = "Connected to backend API";
      els.apiStatusPill.textContent = "OK";
      els.apiStatusPill.className = "pill pill--good";
    } else {
      els.apiStatusLine.textContent = "Backend not reachable (using demo data)";
      els.apiStatusPill.textContent = "DEMO";
      els.apiStatusPill.className = "pill pill--warn";
    }
  }

  function badge(status){
    const s = String(status || "").toLowerCase();
    if (s.includes("pend")) return `<span class="badge badge--pending">Pending</span>`;
    if (s.includes("paid")) return `<span class="badge badge--paid">Paid</span>`;
    if (s.includes("ship")) return `<span class="badge badge--shipped">Shipped</span>`;
    if (s.includes("fail") || s.includes("cancel")) return `<span class="badge badge--failed">Failed</span>`;
    return `<span class="badge">${status || "—"}</span>`;
  }

  function renderRecentOrders(rows){
    const tbody = els.recentOrdersTable?.querySelector("tbody");
    if (!tbody) return;

    tbody.innerHTML = "";
    if (!rows || rows.length === 0){
      els.recentOrdersEmpty.style.display = "";
      els.recentOrdersTable.style.display = "none";
      return;
    }

    els.recentOrdersEmpty.style.display = "none";
    els.recentOrdersTable.style.display = "";

    for (const r of rows){
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>#${r.orderNo}</strong><div class="muted" style="font-size:12px;margin-top:2px">${r.date}</div></td>
        <td>${r.customer || "—"}</td>
        <td>${badge(r.status)}</td>
        <td class="right"><strong>${moneyJMD(r.total)}</strong></td>
      `;
      tbody.appendChild(tr);
    }
  }

  function setDashboard(data){
    els.kpiRevenue.textContent = moneyJMD(data.revenueToday);
    els.kpiOrders.textContent = String(data.ordersToday);
    els.kpiProducts.textContent = String(data.productsCount);
    els.kpiPending.textContent = String(data.pendingCount);

    els.pendingPill.textContent = String(data.pendingCount);
    els.lowStockPill.textContent = `${data.lowStockCount} low stock`;
    els.lowStockCount.textContent = String(data.lowStockCount);

    els.revDelta.textContent = `${data.revenueDelta >= 0 ? "+" : ""}${data.revenueDelta}%`;
    els.revDelta.className = `pill ${data.revenueDelta >= 0 ? "pill--good" : "pill--danger"}`;

    els.ordDelta.textContent = `${data.ordersDelta >= 0 ? "+" : ""}${data.ordersDelta}`;
    els.ordDelta.className = `pill ${data.ordersDelta >= 0 ? "pill--info" : "pill--danger"}`;

    renderRecentOrders(data.recentOrders);
  }

  function buildDemo(){
    const now = new Date();
    const day = now.toLocaleDateString(undefined, { weekday:"long", month:"short", day:"numeric" });
    els.todayLine.textContent = `${day} • Overview of today’s performance`;

    const demo = {
      revenueToday: 84250,
      ordersToday: 18,
      productsCount: 64,
      pendingCount: 6,
      lowStockCount: 4,
      revenueDelta: 12,
      ordersDelta: 5,
      recentOrders: [
        { orderNo: "10492", customer: "J. Brown", status: "Paid", total: 6900, date: "10:41 AM" },
        { orderNo: "10491", customer: "K. Reid", status: "Pending", total: 12500, date: "9:58 AM" },
        { orderNo: "10490", customer: "A. Smith", status: "Shipped", total: 9800, date: "Yesterday" },
        { orderNo: "10489", customer: "S. Johnson", status: "Paid", total: 4600, date: "Yesterday" },
      ]
    };
    return demo;
  }

 async function loadMeOrRedirect(){
  // TEMP LOCAL ADMIN BYPASS (remove when backend auth is ready)
  return { email:"admin@local", name:"Admin", role:"ADMIN" };
}


  function setAdminIdentity(user){
    const name = user.name || "Admin";
    const email = user.email || "admin@site.com";
    els.adminName.textContent = name;
    els.adminEmail.textContent = email;
    els.adminAvatar.textContent = (name.trim()[0] || "A").toUpperCase();
  }

  async function loadDashboard(){
    // Try backend dashboard endpoint first (optional)
    // Recommended future endpoint: GET /api/admin/dashboard
    const resp = await apiFetch("/api/admin/dashboard").catch(() => ({ ok:false }));

    if (resp.ok && resp.data){
      setApiStatus(true);
      const now = new Date();
      const day = now.toLocaleDateString(undefined, { weekday:"long", month:"short", day:"numeric" });
      els.todayLine.textContent = `${day} • Live data connected`;
      setDashboard(resp.data);
      return;
    }

    setApiStatus(false);
    setDashboard(buildDemo());
  }

  async function logout(){
    await apiFetch("/api/auth/logout", { method:"POST" }).catch(()=>{});
    location.href = "./login.html";
  }

  function bindUI(){
    els.sidebarToggle?.addEventListener("click", () => {
      els.sidebar?.classList.toggle("is-open");
    });

    els.refreshBtn?.addEventListener("click", async () => {
      toast("Refreshing…");
      await loadDashboard();
      toast("Up to date.");
    });

    els.themeBtn?.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      setTheme(cur === "dark" ? "light" : "dark");
    });

    els.logoutBtn?.addEventListener("click", logout);
  }

  async function init(){
    loadTheme();
    bindUI();

    const me = await loadMeOrRedirect();
    if (!me) return;

    setAdminIdentity(me);
    await loadDashboard();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
