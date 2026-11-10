const checkoutForm = document.querySelector('#checkout-form');
const checkoutPanel = document.querySelector('#checkout-panel');
const checkoutMessage = document.querySelector('#checkout-message');
const orderSuccess = document.querySelector('#order-success');

function getCartForCheckout() {
    try { return JSON.parse(localStorage.getItem('eloria-cart')) || []; } catch { return []; }
}

function cartTotal(items) {
    return items.reduce((sum, item) => sum + Number(String(item.price).replace(/[^0-9]/g, '')) * item.quantity, 0);
}

function setCardFieldsVisibility() {
    const isCard = checkoutForm.elements.paymentMethod.value === 'bank-card';
    document.querySelector('#card-fields').hidden = !isCard;
    document.querySelectorAll('#card-fields input, #card-fields select').forEach((input) => input.required = isCard);
    if (!isCard) checkoutForm.querySelector('#card-fields').querySelectorAll('input, select').forEach((input) => input.value = '');
    updateCvvRule();
}

function updateCvvRule() {
    const brand = checkoutForm.elements.cardBrand?.value;
    const cvv = checkoutForm.elements.cvv;
    if (!cvv) return;
    const length = brand === 'amex' ? 4 : 3;
    cvv.maxLength = length;
    cvv.placeholder = `${length} digits`;
    cvv.pattern = `\\d{${length}}`;
    cvv.setCustomValidity('');
}

document.querySelector('#checkout-button')?.addEventListener('click', () => {
    const items = getCartForCheckout();
    if (!items.length) { alert('Your cart is empty. Add a jewellery piece before checking out.'); return; }
    checkoutPanel.hidden = false;
    checkoutPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

checkoutForm?.addEventListener('change', (event) => {
    if (event.target.name === 'paymentMethod') setCardFieldsVisibility();
    if (event.target.name === 'cardBrand') updateCvvRule();
});

checkoutForm?.elements.telephone.addEventListener('input', (event) => {
    event.target.value = event.target.value.replace(/\D/g, '').slice(0, 10);
});

checkoutForm?.elements.cardNumber.addEventListener('input', (event) => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 16);
    event.target.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
});

checkoutForm?.elements.cvv.addEventListener('input', (event) => {
    const length = checkoutForm.elements.cardBrand.value === 'amex' ? 4 : 3;
    event.target.value = event.target.value.replace(/\D/g, '').slice(0, length);
});

checkoutForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!checkoutForm.checkValidity()) { checkoutForm.reportValidity(); return; }
    const items = getCartForCheckout();
    if (!items.length) return;

    const formData = new FormData(checkoutForm);
    const paymentMethod = formData.get('paymentMethod');
    const cardBrand = formData.get('cardBrand');
    const cardNumber = String(formData.get('cardNumber') || '').replace(/\D/g, '');
    const payload = {
        customer: { name: formData.get('name').trim(), email: formData.get('email').trim(), telephone: String(formData.get('telephone')).replace(/[\s-]/g, ''), deliveryAddress: formData.get('deliveryAddress').trim() },
        items,
        total: cartTotal(items),
        paymentMethod,
        cardLast4: paymentMethod === 'bank-card' ? cardNumber.slice(-4) : undefined,
        cardBrand: paymentMethod === 'bank-card' ? cardBrand : undefined
    };

    const requiredCvvLength = cardBrand === 'amex' ? 4 : 3;
    if (paymentMethod === 'bank-card' && (!['visa', 'mastercard', 'amex'].includes(cardBrand) || !/^\d{16}$/.test(cardNumber) || !new RegExp(`^\\d{${requiredCvvLength}}$`).test(String(formData.get('cvv') || '')))) {
        checkoutMessage.textContent = `Enter a valid 16-digit card number and ${requiredCvvLength}-digit CVV.`;
        return;
    }

    checkoutMessage.textContent = 'Submitting your order…';
    try {
        let response;
        try {
            response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        } catch {
            throw new Error('Could not reach the Eloria server. Please make sure it is running and try again.');
        }
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || 'Could not submit your order.');
        const history = JSON.parse(localStorage.getItem('eloria-order-history') || '[]');
        localStorage.setItem('eloria-order-history', JSON.stringify([result.orderId, ...history.filter((id) => id !== result.orderId)]));
        localStorage.setItem('eloria-cart', '[]');
        checkoutMessage.textContent = '';
        checkoutForm.reset();
        checkoutPanel.hidden = true;
        orderSuccess.hidden = false;
        orderSuccess.innerHTML = `<h2>Order successfully placed!</h2><p>Thank you for shopping with Eloria. Your order reference is <strong>${result.orderId}</strong>.</p><a href="orders.html">View order history</a>`;
        renderCart();
        updateCartCount();
        orderSuccess.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
        checkoutMessage.textContent = error.message || 'Could not submit your order. Please try again.';
    }
});

setCardFieldsVisibility();
