const CART_KEY = 'eloria-cart';
const THEME_KEY = 'eloria-theme';

function setTheme(isDark) {
    document.body.classList.toggle('dark-mode', isDark);
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    document.querySelectorAll('.theme-toggle').forEach((button) => {
        button.setAttribute('aria-pressed', String(isDark));
        button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    });
}

function bindThemeToggle() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    setTheme(savedTheme ? savedTheme === 'dark' : prefersDark);
    document.querySelectorAll('.theme-toggle').forEach((button) => {
        button.addEventListener('click', () => setTheme(!document.body.classList.contains('dark-mode')));
    });
}

function markCurrentPage() {
    const currentFile = window.location.pathname.split('/').pop() || 'home.html';
    document.querySelectorAll('header nav a[href]').forEach((link) => {
        if (link.getAttribute('href') === currentFile) link.setAttribute('aria-current', 'page');
    });
}

function bindAccountDialog() {
    const dialog = document.querySelector('#account-dialog');
    const trigger = document.querySelector('#account-fab');
    if (!dialog || !trigger) return;

    const choice = dialog.querySelector('#account-choice');
    const loginForm = dialog.querySelector('#customer-login-form');
    const registerForm = dialog.querySelector('#customer-register-form');
    const signedIn = dialog.querySelector('#customer-signed-in');
    const message = dialog.querySelector('#account-message');
    const title = dialog.querySelector('#account-title');
    const intro = dialog.querySelector('#account-intro');

    function showView(view) {
        choice.hidden = view !== 'choice';
        loginForm.hidden = view !== 'customer';
        registerForm.hidden = view !== 'register';
        signedIn.hidden = view !== 'signed-in';
        title.textContent = view === 'choice' ? 'Sign in to Eloria' : view === 'register' ? 'Create your account' : view === 'signed-in' ? 'Your account' : 'Customer sign in';
        intro.textContent = view === 'choice' ? 'Choose how you would like to continue.' : view === 'register' ? 'Create an account to shop with Eloria.' : view === 'signed-in' ? 'You are signed in to your customer account.' : 'Welcome back to Eloria.';
        message.textContent = '';
        const form = view === 'register' ? registerForm : loginForm;
        if (view === 'customer' || view === 'register') window.setTimeout(() => form.querySelector('input')?.focus(), 0);
    }

    async function showCustomerSession() {
        try {
            const response = await fetch('/api/customer/session');
            if (!response.ok) return showView('choice');
            const customer = await response.json();
            dialog.querySelector('#customer-welcome').textContent = `Signed in as ${customer.name} (${customer.email}).`;
            trigger.textContent = '👤  My account';
            showView('signed-in');
        } catch {
            showView('choice');
            message.textContent = 'Could not connect to Eloria. Please try again.';
        }
    }

    async function submitCustomerForm(event, mode) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const button = form.querySelector('.account-submit');
        button.disabled = true;
        message.textContent = mode === 'register' ? 'Creating your account…' : 'Signing in…';
        const formData = new FormData(form);
        const payload = mode === 'register'
            ? { name: formData.get('name'), email: formData.get('email'), telephone: formData.get('telephone'), password: formData.get('password') }
            : { email: formData.get('email'), password: formData.get('password') };
        try {
            const response = await fetch(`/api/customer/${mode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = response.status === 204 ? {} : await response.json();
            if (!response.ok) throw new Error(result.message || 'Please check your details and try again.');
            dialog.querySelector('#customer-welcome').textContent = `Signed in as ${result.name} (${result.email}).`;
            trigger.textContent = '👤  My account';
            form.reset();
            showView('signed-in');
        } catch (error) {
            message.textContent = error.message || 'Could not connect to Eloria. Please try again.';
        } finally {
            button.disabled = false;
        }
    }

    trigger.addEventListener('click', () => {
        dialog.showModal();
        showCustomerSession();
    });
    dialog.querySelector('[data-dialog-close]').addEventListener('click', () => dialog.close());
    dialog.querySelectorAll('[data-account-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.accountView)));
    loginForm.addEventListener('submit', (event) => submitCustomerForm(event, 'login'));
    registerForm.addEventListener('submit', (event) => submitCustomerForm(event, 'register'));
    dialog.querySelector('#customer-logout').addEventListener('click', async () => {
        try {
            const response = await fetch('/api/customer/logout', { method: 'POST' });
            if (!response.ok) throw new Error('Sign out failed. Please try again.');
            trigger.textContent = '👤  Sign in';
            showView('choice');
        } catch (error) {
            message.textContent = error.message;
        }
    });
}

function getCart() {
    try {
        return JSON.parse(localStorage.getItem(CART_KEY)) || [];
    } catch {
        return [];
    }
}

function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartCount();
}

function updateCartCount() {
    const count = getCart().reduce((total, item) => total + item.quantity, 0);
    document.querySelectorAll('[data-cart-count]').forEach((element) => {
        element.textContent = count;
    });
}

function addToCart(product) {
    const cart = getCart();
    const existing = cart.find((item) => item.name === product.name);

    if (existing) {
        existing.quantity += 1;
    } else {
        cart.push({ ...product, quantity: 1 });
    }

    saveCart(cart);
    return true;
}

function productFromCard(card) {
    return {
        name: card.dataset.productName || card.querySelector('h3')?.textContent.trim() || 'Eloria jewellery',
        price: card.dataset.productPrice || card.querySelector('.price, p')?.textContent.trim() || 'Rs. 0',
        basePrice: Number(card.dataset.productBasePrice) || Number(String(card.dataset.productPrice || '').replace(/[^0-9]/g, '')) || 0,
        image: card.dataset.productImage || card.querySelector('img')?.getAttribute('src') || '',
        id: card.dataset.productId || ''
    };
}

function bindCartButtons() {
    document.querySelectorAll('[data-add-to-cart], .product button').forEach((button) => {
        if (button.dataset.cartBound) return;
        button.dataset.cartBound = 'true';
        button.addEventListener('click', () => {
            addToCart(productFromCard(button.closest('[data-product], .product, .shop-product')));
            button.textContent = 'Added to Cart';
            setTimeout(() => { button.textContent = 'Add to Cart'; }, 1200);
        });
    });
}

function renderCart() {
    const cartItems = document.querySelector('#cart-items');
    if (!cartItems) return;

    const cart = getCart();
    const total = cart.reduce((sum, item) => {
        const price = Number(String(item.price).replace(/[^0-9]/g, ''));
        return sum + price * item.quantity;
    }, 0);
    cartItems.innerHTML = cart.length
        ? cart.map((item, index) => `<article class="cart-item"><img src="${item.image}" alt="${item.name}"><div><h2>${item.name}</h2><p>${item.price}</p><div class="cart-actions"><button data-cart-change="${index}" data-change="-1">−</button><span>${item.quantity}</span><button data-cart-change="${index}" data-change="1">+</button><button class="remove-item" data-cart-remove="${index}">Remove</button></div></div></article>`).join('')
        : '<p class="empty-cart">Your cart is empty. Discover a piece you love in our shop.</p>';

    document.querySelector('#cart-total').textContent = `Rs. ${total.toLocaleString()}`;

    cartItems.querySelectorAll('[data-cart-change]').forEach((button) => button.addEventListener('click', () => {
        const updatedCart = getCart();
        const index = Number(button.dataset.cartChange);
        updatedCart[index].quantity += Number(button.dataset.change);
        if (updatedCart[index].quantity < 1) updatedCart.splice(index, 1);
        saveCart(updatedCart);
        renderCart();
    }));

    cartItems.querySelectorAll('[data-cart-remove]').forEach((button) => button.addEventListener('click', () => {
        const updatedCart = getCart();
        updatedCart.splice(Number(button.dataset.cartRemove), 1);
        saveCart(updatedCart);
        renderCart();
    }));
}

function ensureFooterContact() {
    document.querySelectorAll('footer').forEach((footer) => {
        if (footer.querySelector('.footer-contact')) return;
        const contact = document.createElement('div');
        contact.className = 'footer-contact';
        contact.innerHTML = '<p class="footer-brand">Eloria Handmade Jewellery</p><div class="footer-contact-details"><span>✉ eloria@gamil.com</span><span>☎ 0746584578</span><span>⌖ Wellawatte, Colombo, Sri Lanka</span></div>';
        footer.prepend(contact);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindThemeToggle();
    markCurrentPage();
    updateCartCount();
    bindCartButtons();
    renderCart();
    bindAccountDialog();
    ensureFooterContact();
    const collectionGrid = document.querySelector('#collection-grid');
    if (collectionGrid) new MutationObserver(bindCartButtons).observe(collectionGrid, { childList: true, subtree: true });
});
