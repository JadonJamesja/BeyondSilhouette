/* ---------------------------------------
   shop.js — Beyond Silhouette (Shop)
   Features:
   1) Highlights current nav page
   2) Cart storage in localStorage
   3) Cart badge updates
   4) Product cards:
      - Require size selection
      - Decrement stock
      - Disable sold-out items
      - Save cart updates
      - Button feedback & shake animation
   5) Cart-ready: ensures saved data is 
      normalized and usable by cart.js
---------------------------------------- */

// ---------- UTILITIES ----------
function toInt(value) {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? 0 : n;
}

function formatJMD(amount) {
    return `J$${toInt(amount).toLocaleString('en-JM')}`;
}

function loadCart() {
    try {
        const raw = localStorage.getItem('bs_cart');
        const cart = raw ? JSON.parse(raw) : [];
        return Array.isArray(cart) ? cart : [];
    } catch {
        return [];
    }
}

function saveCart(cart) {
    // Validate + normalize before saving
    const clean = cart
        .filter(item => item && item.id && item.size)
        .map(item => ({
            id: String(item.id),
            name: String(item.name || ''),
            size: String(item.size),
            price: toInt(item.price),
            qty: Math.max(1, toInt(item.qty))
        }));
    localStorage.setItem('bs_cart', JSON.stringify(clean));
}

function cartQuantity(cart) {
    return cart.reduce((sum, item) => sum + toInt(item.qty), 0);
}

function updateCartBadge(cart) {
    const badge = document.querySelector('.cart-count');
    if (!badge) return;
    badge.textContent = cartQuantity(cart);
}

// ---------- NAV: CURRENT PAGE ----------
function setCurrentNavLink() {
    const links = document.querySelectorAll('#main-nav .nav-link');
    const here = window.location.pathname.split('/').pop() || 'index.html';

    links.forEach(link => {
        const target = link.getAttribute('href');
        if (target && target.endsWith(here)) {
            link.classList.add('nav-link--current');
            link.setAttribute('aria-current', 'page');
            link.setAttribute('tabindex', '-1');
            link.addEventListener('click', e => e.preventDefault());
        }
    });
}

// ---------- PRODUCTS / CART LOGIC ----------
function initProductCards() {
    const cart = loadCart();
    updateCartBadge(cart);

    const cards = document.querySelectorAll('.product-card');

    cards.forEach(card => {
        const id = card.getAttribute('data-id');
        const name = card.getAttribute('data-name');
        const price = toInt(card.getAttribute('data-price'));
        let stock = toInt(card.getAttribute('data-stock'));

        const selectEl = card.querySelector('.product-size-select');
        const addBtn = card.querySelector('.add-to-cart');
        const stockEl = card.querySelector('.stock-count');

        if (!id || !name || !addBtn || !selectEl || !stockEl) return;

        // Initialize stock display
        stockEl.textContent = stock.toString();

        // Disable sold-out buttons
        if (stock <= 0) {
            addBtn.disabled = true;
            addBtn.textContent = 'Sold Out';
        }

        // Button label updates with selected size
        selectEl.addEventListener('change', () => {
            const size = selectEl.value;
            if (size) addBtn.textContent = `Add to Cart — Size ${size}`;
            else addBtn.textContent = 'Add to Cart';
        });

        // Main Add to Cart logic
        addBtn.addEventListener('click', e => {
            e.preventDefault();
            if (stock <= 0) return;

            const size = selectEl.value;
            if (!size) {
                // Focus + shake animation for missing size
                selectEl.focus();
                selectEl.classList.add('shake');
                setTimeout(() => selectEl.classList.remove('shake'), 400);
                return;
            }

            const existing = cart.find(item => item.id === id && item.size === size);

            if (existing) {
                existing.qty = toInt(existing.qty) + 1;
            } else {
                cart.push({ id, name, size, price, qty: 1 });
            }

            // Decrement stock & update display
            stock = Math.max(0, stock - 1);
            stockEl.textContent = stock.toString();

            if (stock === 0) {
                addBtn.disabled = true;
                addBtn.textContent = 'Sold Out';
            }

            saveCart(cart);
            updateCartBadge(cart);

            // Micro feedback
            const original = addBtn.textContent;
            addBtn.textContent = 'Added ✓';
            addBtn.disabled = true;
            setTimeout(() => {
                if (stock > 0) addBtn.disabled = false;
                const s = selectEl.value;
                addBtn.textContent = s ? `Add to Cart — Size ${s}` : 'Add to Cart';
            }, 700);
        });
    });
}

// ---------- BOOTSTRAP ----------
document.addEventListener('DOMContentLoaded', () => {
    setCurrentNavLink();
    initProductCards();
});
