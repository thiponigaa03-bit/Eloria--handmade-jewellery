const collectionGrid = document.querySelector('#collection-grid');
const productSearch = document.querySelector('#product-search');
const searchStatus = document.querySelector('#search-status');
const elevenElevenOffer = new URLSearchParams(window.location.search).get('offer') === '1111';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatShopPrice(amount) {
    return `Rs. ${Number(amount || 0).toLocaleString()}`;
}

function normalizeSearchText(value) {
    return String(value ?? '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function filterProducts() {
    const query = normalizeSearchText(productSearch.value);
    const terms = query ? query.split(/\s+/) : [];
    const products = [...document.querySelectorAll('.shop-product')];
    let matches = 0;
    products.forEach((product) => {
        const searchableText = normalizeSearchText(product.dataset.search || product.textContent);
        const visible = terms.every((term) => searchableText.includes(term));
        product.hidden = !visible;
        if (visible) matches += 1;
    });
    document.querySelectorAll('.collection-group').forEach((group) => {
        group.hidden = [...group.querySelectorAll('.shop-product')].every((product) => product.hidden);
    });
    searchStatus.textContent = !query ? '' : matches
        ? `${matches} item${matches === 1 ? '' : 's'} found`
        : `No pieces found for “${productSearch.value.trim()}”. Try a product name or jewellery type.`;
}

if (collectionGrid) {
    collectionGrid.setAttribute('aria-busy', 'true');
    collectionGrid.innerHTML = '<p class="catalog-loading">Loading the Eloria collection…</p>';
    productSearch?.addEventListener('input', filterProducts);

    fetch('/api/products')
        .then((response) => {
            if (!response.ok) throw new Error('Products could not be loaded.');
            return response.json();
        })
        .then((products) => {
            const byCategory = new Map();
            products.forEach((product) => {
                if (!byCategory.has(product.category)) byCategory.set(product.category, []);
                byCategory.get(product.category).push(product);
            });

            const groups = [...byCategory.entries()].map(([category, items]) => `
                <section class="collection-group" data-category="${escapeHtml(category.toLowerCase())}">
                    <h2>${escapeHtml(category)}</h2>
                    <div class="collection-products">
                        ${items.map((product) => {
                            const originalPrice = Number(product.price) || 0;
                            const price = elevenElevenOffer ? Math.round(originalPrice * 0.75) : originalPrice;
                            const formattedPrice = formatShopPrice(price);
                            return `<article class="shop-product" data-product data-product-id="${escapeHtml(product._id)}" data-product-name="${escapeHtml(product.name)}" data-product-price="${formattedPrice}" data-product-base-price="${originalPrice}" data-product-image="${escapeHtml(product.image)}" data-search="${escapeHtml(`${product.name} ${category} ${product.description || ''}`)}">
                                <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy">
                                <h3>${escapeHtml(product.name)}</h3>${product.description ? `<p class="shop-description">${escapeHtml(product.description)}</p>` : ''}${elevenElevenOffer ? `<span class="original-price">${formatShopPrice(originalPrice)}</span>` : ''}<p class="price ${elevenElevenOffer ? 'offer-price' : ''}">${formattedPrice}</p>
                                <button type="button" data-add-to-cart>Add to Cart</button>
                            </article>`;
                        }).join('')}
                    </div>
                </section>`).join('');

            collectionGrid.innerHTML = groups || '<p class="catalog-empty">New handmade pieces are coming soon.</p>';
            collectionGrid.setAttribute('aria-busy', 'false');
            filterProducts();

            const searchFromHome = new URLSearchParams(window.location.search).get('search');
            if (searchFromHome) {
                productSearch.value = searchFromHome;
                filterProducts();
                document.querySelector('.shop-search')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        })
        .catch(() => {
            collectionGrid.setAttribute('aria-busy', 'false');
            collectionGrid.innerHTML = '<p class="catalog-empty">The collection could not be loaded. Please make sure the Eloria server is running and refresh the page.</p>';
        });
}
