// ---------- UTILITIES ----------
function toInt(value) {
    const n = parseInt(value, 10);
    return isNaN(n) ? 0 : n;
}

function formatJMD(amount) {
    return `J$${toInt(amount).toLocaleString('en-JM')}`;
}

function loadCart() {
    try {
        const raw = localStorage.getItem('bs_cart');
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveCart(cart) {
    localStorage.setItem('bs_cart', JSON.stringify(cart));
}

// ---------- CART LOGIC ----------
function renderCart() {
    const cart = loadCart();
    const container = document.querySelector('.cart-container');

    // Clear existing items
    container.innerHTML = '';

    if (cart.length === 0) {
        container.innerHTML = '<p class="empty-cart">Your cart is empty. <a href="shop-page.html">Go Shopping</a></p>';
        updateTotals(cart);
        return;
    }

    cart.forEach((item, index) => {
        const cartItem = document.createElement('div');
        cartItem.className = 'cart-item';

        cartItem.innerHTML = `
      <img src="./images/${item.img || 'placeholder.jpg'}" alt="${item.name}">
      <div class="item-info">
        <h3>${item.name}</h3>
        <p>${formatJMD(item.price)}</p>
        <p>Size: ${item.size}</p>
      </div>
      <div class="item-actions">
        <input type="number" class="quantity" value="${item.qty}" min="1">
        <button class="remove-btn">Remove</button>
      </div>
    `;

        // Quantity change handler
        const qtyInput = cartItem.querySelector('.quantity');
        qtyInput.addEventListener('change', e => {
            const newQty = Math.max(1, toInt(e.target.value));
            cart[index].qty = newQty;
            saveCart(cart);
            updateTotals(cart);
        });

        // Remove button
        const removeBtn = cartItem.querySelector('.remove-btn');
        removeBtn.addEventListener('click', () => {
            cart.splice(index, 1);
            saveCart(cart);
            renderCart();
        });

        container.appendChild(cartItem);
    });

    // Summary section
    const summary = document.createElement('div');
    summary.className = 'cart-summary';
    summary.innerHTML = `
    <h2>Order Summary</h2>
    <p>Subtotal: <span id="subtotal"></span></p>
    <p>Tax (10%): <span id="tax"></span></p>
    <h3>Total: <span id="total"></span></h3>
    <button class="checkout-btn">Proceed to Checkout</button>
  `;
    container.appendChild(summary);

    updateTotals(cart);
}

// ---------- TOTAL CALCULATION ----------
function updateTotals(cart) {
    const subtotalEl = document.getElementById('subtotal');
    const taxEl = document.getElementById('tax');
    const totalEl = document.getElementById('total');

    const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const tax = subtotal * 0.1;
    const total = subtotal + tax;

    if (subtotalEl) subtotalEl.textContent = formatJMD(subtotal);
    if (taxEl) taxEl.textContent = formatJMD(tax);
    if (totalEl) totalEl.textContent = formatJMD(total);
}

// ---------- INIT ----------
document.addEventListener('DOMContentLoaded', () => {
    renderCart();
});
