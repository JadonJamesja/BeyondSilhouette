/* BeyondSilhouette Admin UI (FULL FILE w/ FIXES)
   - Demo auth guard (front-end only)
   - Theme toggle (persisted) — FIXED via event delegation + proper init
   - Sidebar behavior (mobile overlay / desktop collapse)
   - Toasts
   - Products page: image preview + live preview + stock total
*/

(function () {
  const DEMO_ADMIN = {
    email: "admin@beyondsilhouette.com",
    password: "Admin123!",
    name: "Admin",
  };

  const STORAGE = {
    theme: "bs_admin_theme",
    session: "bs_admin_session",
  };

  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ================= Theme (FIXED) ================= */
  function getTheme() {
    const saved = localStorage.getItem(STORAGE.theme);
    if (saved === "dark" || saved === "light") return saved;

    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;

    return "dark";
  }

  function applyTheme(theme) {
    const t = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(STORAGE.theme, t);
  }

  function toggleTheme() {
    applyTheme(getTheme() === "dark" ? "light" : "dark");
    toast(`Theme: ${getTheme()}`);
  }

  /* ================= Session ================= */
  function getSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE.session) || "null"); }
    catch { return null; }
  }
  function setSession(session) {
    localStorage.setItem(STORAGE.session, JSON.stringify(session));
  }
  function clearSession() {
    localStorage.removeItem(STORAGE.session);
  }
  function isAuthed() {
    const s = getSession();
    return !!(s && s.email);
  }

  function requireAuth() {
    const path = location.pathname.replace(/\\/g, "/");
    const inAdmin = path.includes("/admin/");
    const isLogin = path.endsWith("/admin/login.html") || path.endsWith("/admin/login");

    if (!inAdmin) return;

    if (!isLogin && !isAuthed()) {
      location.href = "./login.html";
      return;
    }

    if (isLogin && isAuthed()) {
      location.href = "./dashboard.html";
      return;
    }
  }

  /* ================= Toast ================= */
  function toast(message) {
    let el = qs(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(() => el.classList.remove("show"), 2200);
  }

  function setYear() {
    const year = new Date().getFullYear();
    qsa('[data-ui="year"]').forEach(n => (n.textContent = String(year)));
  }

  function hydrateAdminName() {
    const s = getSession();
    const name = (s && s.name) ? s.name : "Admin";
    qsa('[data-ui="adminName"]').forEach(n => (n.textContent = name));
  }

  /* ================= Delegated actions (FIXED) ================= */
  function bindDelegatedActions() {
    document.addEventListener("click", (e) => {
      const el = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
      if (!el) return;

      const action = el.getAttribute("data-action");
      if (!action) return;

      if (action === "toggle-theme") {
        e.preventDefault();
        toggleTheme();
        return;
      }

      if (action === "toggle-password") {
        e.preventDefault();
        const input = qs('input[name="password"]');
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        el.textContent = show ? "Hide" : "Show";
        return;
      }

      if (action === "toggle-sidebar") {
        e.preventDefault();
        if (window.matchMedia && window.matchMedia("(max-width: 920px)").matches) {
          document.body.classList.toggle("sidebar-open");
        } else {
          document.body.classList.toggle("sidebar-collapsed");
        }
        return;
      }

      if (action === "logout") {
        e.preventDefault();
        clearSession();
        location.href = "./login.html";
        return;
      }

      if (action === "toast") {
        e.preventDefault();
        toast(el.getAttribute("data-toast") || "Done. (demo)");
        return;
      }
    });
  }

  /* ================= Login ================= */
  function bindLogin() {
    const form = qs('[data-form="login"]');
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const err = qs('[data-ui="error"]');

      const fd = new FormData(form);
      const email = String(fd.get("email") || "").trim().toLowerCase();
      const password = String(fd.get("password") || "");
      const remember = !!fd.get("remember");

      const ok = email === DEMO_ADMIN.email && password === DEMO_ADMIN.password;

      if (!ok) {
        if (err) {
          err.hidden = false;
          err.textContent = "Invalid email or password.";
        }
        return;
      }

      if (err) {
        err.hidden = true;
        err.textContent = "";
      }

      setSession({
        email: DEMO_ADMIN.email,
        name: DEMO_ADMIN.name,
        remember,
        at: Date.now(),
      });

      location.href = "./dashboard.html";
    });
  }

  /* ================= Products page live preview ================= */
  function initProductsPreview() {
    const form = qs("#productForm");
    if (!form) return;

    const name = qs('input[name="name"]', form);
    const desc = qs('textarea[name="description"]', form);
    const price = qs('input[name="price"]', form);
    const status = qs('select[name="status"]', form);
    const sS = qs('input[name="stockS"]', form);
    const sM = qs('input[name="stockM"]', form);
    const sL = qs('input[name="stockL"]', form);
    const sXL = qs('input[name="stockXL"]', form);

    const totalBadge = qs("#stockTotalBadge");

    const pvStatus = qs("#previewStatus");
    const pvName = qs("#previewName");
    const pvDesc = qs("#previewDesc");
    const pvPrice = qs("#previewPrice");
    const pvStock = qs("#previewStock");
    const pvMedia = qs("#previewMedia");

    const fileInput = qs("#productImages");
    const imageGrid = qs("#imageGrid");

    const toNum = (v) => Math.max(0, Number(String(v || "").replace(/[^\d]/g, "")) || 0);
    const formatJ = (n) => "J$ " + (Number(n) || 0).toLocaleString("en-JM", { maximumFractionDigits: 0 });

    function totalStock() {
      return toNum(sS?.value) + toNum(sM?.value) + toNum(sL?.value) + toNum(sXL?.value);
    }

    function renderTextPreview() {
      if (pvName) pvName.textContent = (name?.value || "—").trim() || "—";
      if (pvDesc) pvDesc.textContent = (desc?.value || "—").trim() || "—";
      if (pvPrice) pvPrice.textContent = formatJ(toNum(price?.value));
      if (pvStatus) pvStatus.textContent = (status?.value === "published") ? "Published" : "Draft";

      const t = totalStock();
      if (pvStock) pvStock.textContent = "Stock: " + t;
      if (totalBadge) totalBadge.textContent = "Total: " + t;
    }

    async function readFiles(files) {
      const arr = Array.from(files || []);
      return Promise.all(arr.map(f => new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve({ name: f.name, dataUrl: String(r.result || "") });
        r.onerror = () => reject(new Error("read failed"));
        r.readAsDataURL(f);
      })));
    }

    function renderImages(list) {
      if (imageGrid) imageGrid.innerHTML = "";

      list.forEach((img, idx) => {
        const tile = document.createElement("div");
        tile.className = "image-tile";
        tile.innerHTML = `
          <img alt="Product image ${idx + 1}" src="${img.dataUrl}">
          <div class="meta">${img.name}</div>
        `;
        imageGrid && imageGrid.appendChild(tile);
      });

      if (pvMedia) {
        pvMedia.innerHTML = "";
        if (list[0]) {
          const im = document.createElement("img");
          im.src = list[0].dataUrl;
          im.alt = "Preview image";
          pvMedia.appendChild(im);
        } else {
          pvMedia.innerHTML = `<span class="muted">No image</span>`;
        }
      }
    }

    ["input", "change"].forEach(evt => {
      [name, desc, price, status, sS, sM, sL, sXL].forEach(el => {
        if (!el) return;
        el.addEventListener(evt, renderTextPreview);
      });
    });

    if (fileInput) {
      fileInput.addEventListener("change", async () => {
        try {
          const imgs = await readFiles(fileInput.files);
          renderImages(imgs);
        } catch {
          toast("Could not read images. Try smaller files.");
        }
      });
    }

    renderTextPreview();
  }

  /* ================= Init ================= */
  applyTheme(getTheme());   // IMPORTANT: apply persisted theme on load
  setYear();
  requireAuth();
  hydrateAdminName();
  bindDelegatedActions();   // IMPORTANT: makes Theme button work everywhere
  bindLogin();
  initProductsPreview();
})();
