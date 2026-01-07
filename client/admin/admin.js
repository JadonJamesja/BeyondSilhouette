async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (res.status === 401) location.href = "/admin/login.html";
  return res.json();
}

/* AUTH */
const loginForm = document.getElementById("admin-login-form");
if (loginForm) {
  loginForm.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(loginForm));
    const res = await api("/api/auth/login", {
      method:"POST", body:JSON.stringify(data)
    });
    if (res.role === "ADMIN") location.href = "/admin/index.html";
    else document.getElementById("login-error").textContent = "Not an admin";
  };
}

const logoutBtn = document.getElementById("logout");
if (logoutBtn) logoutBtn.onclick = async () => {
  await api("/api/auth/logout", { method:"POST" });
  location.href = "/admin/login.html";
};

/* PRODUCTS LIST */
const productsTable = document.querySelector("#products-table tbody");
if (productsTable) {
  api("/api/admin/products").then(products => {
    products.forEach(p => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.name}</td>
        <td>${p.price / 100}</td>
        <td>${p.totalStock}</td>
        <td>${p.active}</td>
        <td>
          <a href="product-edit.html?id=${p.id}">Edit</a>
        </td>`;
      productsTable.appendChild(tr);
    });
  });
}

/* ORDERS */
const ordersTable = document.querySelector("#orders-table tbody");
if (ordersTable) {
  api("/api/admin/orders").then(orders => {
    orders.forEach(o => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${o.orderNumber}</td>
        <td>${o.email}</td>
        <td>${o.paymentMethod}</td>
        <td>${o.paymentStatus}</td>
        <td>${o.total / 100}</td>
        <td><a href="order.html?id=${o.id}">View</a></td>`;
      ordersTable.appendChild(tr);
    });
  });
}
