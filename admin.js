const orderList = document.querySelector('#orders-list');
const dashboardMessage = document.querySelector('#dashboard-message');
const productsList = document.querySelector('#products-list');
const productMessage = document.querySelector('#product-message');
const productForm = document.querySelector('#product-form');
const statuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatMoney(value) {
  return `Rs. ${Number(value || 0).toLocaleString()}`;
}

function parsePrice(price) {
  return Number(String(price || '').replace(/\D/g, '')) || 0;
}

async function loadDashboard() {
  try {
    const [sessionResponse, ordersResponse, productsResponse] = await Promise.all([
      fetch('/api/admin/session'),
      fetch('/api/admin/orders'),
      fetch('/api/admin/products')
    ]);
    if (sessionResponse.status === 401 || ordersResponse.status === 401 || productsResponse.status === 401) {
      window.location.replace('/admin-login.html');
      return;
    }
    if (!sessionResponse.ok || !ordersResponse.ok || !productsResponse.ok) throw new Error('Store data could not be loaded.');
    const session = await sessionResponse.json();
    const orders = await ordersResponse.json();
    const products = await productsResponse.json();
    document.querySelector('#admin-name').textContent = session.username;
    document.querySelector('#order-count').textContent = orders.length;
    document.querySelector('#pending-count').textContent = orders.filter((order) => ['Pending', 'Processing'].includes(order.status)).length;
    document.querySelector('#revenue-total').textContent = formatMoney(orders.filter((order) => order.status !== 'Cancelled').reduce((sum, order) => sum + Number(order.total || 0), 0));
    dashboardMessage.textContent = '';
    orderList.innerHTML = orders.map((order) => `
      <article class="order-card">
        <div class="order-topline"><div><p class="eyebrow">ORDER ${escapeHtml(order._id)}</p><h2>${escapeHtml(order.customer?.name)}</h2></div><span class="order-date">${new Date(order.createdAt).toLocaleString()}</span></div>
        <div class="order-info"><p><strong>Email</strong><br>${escapeHtml(order.customer?.email)}</p><p><strong>Phone</strong><br>${escapeHtml(order.customer?.telephone)}</p><p><strong>Delivery address</strong><br>${escapeHtml(order.customer?.deliveryAddress)}</p><p><strong>Payment</strong><br>${order.paymentMethod === 'cod' ? 'Cash on delivery' : `${escapeHtml(order.cardBrand)} ending ${escapeHtml(order.cardLast4)}`}</p></div>
        <div class="ordered-items">${(order.items || []).map((item) => `<div><span>${escapeHtml(item.name)} × ${escapeHtml(item.quantity)}</span><strong>${formatMoney(parsePrice(item.price) * Number(item.quantity || 0))}</strong></div>`).join('')}</div>
        <div class="order-bottom"><strong class="order-total">${formatMoney(order.total)}</strong><label>Status <select data-order-id="${escapeHtml(order._id)}">${statuses.map((status) => `<option${status === order.status ? ' selected' : ''}>${status}</option>`).join('')}</select></label></div>
      </article>`).join('') || '<div class="empty-state"><h2>No orders yet</h2><p>New customer orders will appear here.</p></div>';
    orderList.querySelectorAll('select[data-order-id]').forEach((select) => select.addEventListener('change', updateStatus));
    document.querySelector('#product-count').textContent = `${products.length} product${products.length === 1 ? '' : 's'}`;
    productsList.innerHTML = products.map((product) => `
      <article class="admin-product-card">
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy">
        <div class="admin-product-details"><span class="product-category">${escapeHtml(product.category)}</span><h3>${escapeHtml(product.name)}</h3><strong>${formatMoney(product.price)}</strong>${product.description ? `<p>${escapeHtml(product.description)}</p>` : ''}${product.seedKey ? '<span class="catalog-protected">Original catalog item</span>' : `<button class="delete-product-button" type="button" data-delete-product="${escapeHtml(product._id)}" data-product-name="${escapeHtml(product.name)}">Delete product</button>`}</div>
      </article>`).join('') || '<div class="empty-state"><h2>Your shop is ready</h2><p>Add your first jewellery product using the form above.</p></div>';
    productsList.querySelectorAll('[data-delete-product]').forEach((button) => button.addEventListener('click', deleteProduct));
  } catch (error) {
    dashboardMessage.textContent = error.message || 'Could not connect to the Eloria server.';
  }
}

async function updateStatus(event) {
  const select = event.currentTarget;
  select.disabled = true;
  try {
    const response = await fetch(`/api/admin/orders/${encodeURIComponent(select.dataset.orderId)}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: select.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Status update failed.');
    dashboardMessage.textContent = `Order status updated to ${result.status}.`;
    await loadDashboard();
  } catch (error) {
    dashboardMessage.textContent = error.message;
  } finally {
    select.disabled = false;
  }
}

async function deleteProduct(event) {
  const button = event.currentTarget;
  if (!window.confirm(`Delete “${button.dataset.productName}” from your shop?`)) return;
  button.disabled = true;
  productMessage.textContent = 'Deleting product…';
  try {
    const response = await fetch(`/api/admin/products/${encodeURIComponent(button.dataset.deleteProduct)}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Product could not be deleted.');
    productMessage.textContent = result.message;
    await loadDashboard();
  } catch (error) {
    productMessage.textContent = error.message || 'Could not connect to Eloria.';
    button.disabled = false;
  }
}

document.querySelector('#refresh-button').addEventListener('click', loadDashboard);
document.querySelectorAll('[data-dashboard-view]').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('[data-dashboard-view]').forEach((button) => {
    const active = button === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.dashboard-view').forEach((view) => { view.hidden = view.id !== tab.dataset.dashboardView; });
}));

productForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!productForm.reportValidity()) return;
  const submitButton = productForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  productMessage.textContent = 'Saving product…';
  const data = new FormData(productForm);
  try {
    const response = await fetch('/api/admin/products', {
      method: 'POST',
      body: data
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Product could not be saved.');
    productForm.reset();
    productMessage.textContent = `${result.name} was added to the shop.`;
    await loadDashboard();
  } catch (error) {
    productMessage.textContent = error.message || 'Could not connect to Eloria.';
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  window.location.replace('/admin-login.html');
});
loadDashboard();
