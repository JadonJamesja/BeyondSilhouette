// -----------------------------
// main.js — Beyond Silhouette
// Global JS for nav, login dropdown, and cart badge
// -----------------------------

document.addEventListener('DOMContentLoaded', () => {
    highlightCurrentNav();
    initLoginDropdown();
    updateGlobalCartBadge();
});

// --- Highlight current page in nav ---
function highlightCurrentNav() {
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

// --- Login dropdown toggle ---
function initLoginDropdown() {
    const loginIcon = document.querySelector('.loginIcon');
    const menu = document.querySelector('.login-menu');
    if (!loginIcon || !menu) return;

    loginIcon.addEventListener('click', e => {
        e.preventDefault();
        menu.classList.toggle('show');
    });

    document.addEventListener('click', e => {
        if (!loginIcon.contains(e.target) && !menu.contains(e.target)) {
            menu.classList.remove('show');
        }
    });
}

// --- Cart badge (global) ---
function loadCart() {
    try {
        const raw = localStorage.getItem('bs_cart');
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function cartQuantity(cart) {
    return cart.reduce((sum, item) => sum + (item.qty || 0), 0);
}

function updateGlobalCartBadge() {
    const badge = document.querySelector('.cart-count');
    if (!badge) return;
    const cart = loadCart();
    badge.textContent = cartQuantity(cart);
}
