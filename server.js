import 'dotenv/config';
import express from 'express';
import mysql from 'mysql2/promise';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import catalogSeed from './catalog-seed.json' with { type: 'json' };

const app = express();
const port = Number(process.env.PORT) || 3000;
const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const databaseName = process.env.MYSQL_DATABASE || 'eloria';
if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) throw new Error('MYSQL_DATABASE may contain only letters, numbers, and underscores.');
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: databaseName,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
});

const productCategories = ['Necklaces', 'Earrings', 'Bracelets', 'Anklets', 'Rings', 'Jewellery Sets', 'Other'];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^(?:\+94|0)7\d{8}$/;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const route = (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);

async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function sessionUser(request, table, cookie) {
  const token = request.cookies?.[cookie];
  if (!token) return null;
  const accountFields = table === 'admin_sessions'
    ? 'u.username, NULL AS name, NULL AS email'
    : 'NULL AS username, u.name, u.email';
  const [rows] = await pool.execute(
    `SELECT s.id AS sessionId, s.user_id AS userId, ${accountFields}
       FROM ${table} s JOIN ${table === 'admin_sessions' ? 'admins' : 'customers'} u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP LIMIT 1`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

const requireAdmin = route(async (request, response, next) => {
  request.admin = await sessionUser(request, 'admin_sessions', 'eloria_admin');
  if (!request.admin) return response.status(401).json({ message: 'Admin sign-in required.' });
  next();
});

const requireCustomer = route(async (request, response, next) => {
  request.customer = await sessionUser(request, 'customer_sessions', 'eloria_customer');
  if (!request.customer) return response.status(401).json({ message: 'Customer sign-in required.' });
  next();
});

app.use(express.json({ limit: '100kb' }));
app.use((request, _response, next) => {
  request.cookies = Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key, value]) => key && value));
  next();
});

app.get('/admin.html', route(async (request, response) => {
  if (!await sessionUser(request, 'admin_sessions', 'eloria_admin')) return response.redirect('/admin-login.html');
  response.sendFile(path.join(root, 'admin.html'));
}));
app.get('/admin-login.html', (_request, response) => response.sendFile(path.join(root, 'admin-login.html')));
app.use(express.static(root, { index: false }));

async function createSession(response, { userId, table, cookie, userData }) {
  const token = randomBytes(32).toString('hex');
  const maxAge = 8 * 60 * 60 * 1000;
  await pool.execute(`INSERT INTO ${table} (user_id, token_hash, expires_at) VALUES (?, ?, ?)`, [userId, hashToken(token), new Date(Date.now() + maxAge)]);
  response.cookie(cookie, token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge, path: '/' });
  response.json(userData);
}

app.post('/api/customer/register', route(async (request, response) => {
  const name = String(request.body?.name || '').trim();
  const email = String(request.body?.email || '').trim().toLowerCase();
  const telephone = String(request.body?.telephone || '').replace(/[\s-]/g, '');
  const password = String(request.body?.password || '');
  if (name.length < 2 || name.length > 100 || !emailPattern.test(email) || !phonePattern.test(telephone) || password.length < 8 || password.length > 200) {
    return response.status(400).json({ message: 'Enter a name, valid email, Sri Lankan mobile number, and password of at least 8 characters.' });
  }
  let result;
  try {
    [result] = await pool.execute('INSERT INTO customers (name, email, telephone, password_hash) VALUES (?, ?, ?, ?)', [name, email, telephone, await passwordHash(password)]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ message: 'An account with this email already exists. Please sign in.' });
    throw error;
  }
  return createSession(response, { userId: result.insertId, table: 'customer_sessions', cookie: 'eloria_customer', userData: { name, email } });
}));

app.post('/api/customer/login', route(async (request, response) => {
  const email = String(request.body?.email || '').trim().toLowerCase();
  const password = String(request.body?.password || '');
  const [rows] = await pool.execute('SELECT id, name, email, password_hash FROM customers WHERE email = ? LIMIT 1', [email]);
  if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash))) return response.status(401).json({ message: 'Email or password is incorrect.' });
  return createSession(response, { userId: rows[0].id, table: 'customer_sessions', cookie: 'eloria_customer', userData: { name: rows[0].name, email: rows[0].email } });
}));

app.get('/api/customer/session', requireCustomer, (request, response) => response.json({ name: request.customer.name, email: request.customer.email }));
app.post('/api/customer/logout', requireCustomer, route(async (request, response) => {
  await pool.execute('DELETE FROM customer_sessions WHERE id = ?', [request.customer.sessionId]);
  response.clearCookie('eloria_customer', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' });
  response.status(204).end();
}));

app.post('/api/admin/login', route(async (request, response) => {
  const username = String(request.body?.username || '').trim().toLowerCase();
  const password = String(request.body?.password || '');
  const [rows] = await pool.execute('SELECT id, username, password_hash FROM admins WHERE username = ? LIMIT 1', [username]);
  if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash))) return response.status(401).json({ message: 'Invalid admin username or password.' });
  return createSession(response, { userId: rows[0].id, table: 'admin_sessions', cookie: 'eloria_admin', userData: { username: rows[0].username } });
}));

app.get('/api/admin/session', requireAdmin, (request, response) => response.json({ username: request.admin.username }));
app.post('/api/admin/logout', requireAdmin, route(async (request, response) => {
  await pool.execute('DELETE FROM admin_sessions WHERE id = ?', [request.admin.sessionId]);
  response.clearCookie('eloria_admin', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' });
  response.status(204).end();
}));

function parseOrder(row, items) {
  return {
    id: row.id, _id: row.id, customer: { name: row.customer_name, email: row.customer_email, telephone: row.telephone, deliveryAddress: row.delivery_address },
    items, total: Number(row.total), paymentMethod: row.payment_method, cardBrand: row.card_brand, cardLast4: row.card_last4,
    status: row.status, createdAt: row.created_at
  };
}

async function loadOrder(id) {
  const [orders] = await pool.execute('SELECT * FROM orders WHERE id = ? LIMIT 1', [id]);
  if (!orders[0]) return null;
  const [items] = await pool.execute('SELECT product_id AS id, product_name AS name, unit_price AS price, image, quantity FROM order_items WHERE order_id = ? ORDER BY id', [id]);
  return parseOrder(orders[0], items.map((item) => ({ ...item, price: `Rs. ${Number(item.price).toLocaleString()}`, quantity: Number(item.quantity) })));
}

app.get('/api/admin/orders', requireAdmin, route(async (_request, response) => {
  const [rows] = await pool.execute('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500');
  const [items] = rows.length ? await pool.query(`SELECT order_id, product_id AS id, product_name AS name, unit_price AS price, image, quantity FROM order_items WHERE order_id IN (${rows.map(() => '?').join(',')}) ORDER BY id`, rows.map((row) => row.id)) : [[]];
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.order_id)) grouped.set(item.order_id, []);
    grouped.get(item.order_id).push({ ...item, price: `Rs. ${Number(item.price).toLocaleString()}`, quantity: Number(item.quantity) });
  }
  response.json(rows.map((row) => parseOrder(row, grouped.get(row.id) || [])));
}));

function productDto(row) {
  return { id: row.id, _id: row.id, seedKey: row.seed_key, name: row.name, category: row.category, price: Number(row.price), image: row.image, description: row.description, active: Boolean(row.active) };
}

app.get('/api/products', route(async (_request, response) => {
  const [rows] = await pool.execute('SELECT * FROM products WHERE active = 1 ORDER BY category, created_at DESC');
  response.json(rows.map(productDto));
}));
app.get('/api/admin/products', requireAdmin, route(async (_request, response) => {
  const [rows] = await pool.execute('SELECT * FROM products ORDER BY created_at DESC');
  response.json(rows.map(productDto));
}));

app.post('/api/admin/products', requireAdmin, route(async (request, response) => {
  let uploadedPath;
  try {
    const contentType = String(request.headers['content-type'] || '');
    if (!contentType.toLowerCase().startsWith('multipart/form-data;')) return response.status(400).json({ message: 'Choose an image file to upload.' });
    const chunks = [];
    let bodySize = 0;
    for await (const chunk of request) {
      bodySize += chunk.length;
      if (bodySize > 5 * 1024 * 1024 + 128 * 1024) return response.status(413).json({ message: 'The upload is too large. Choose an image smaller than 5 MB.' });
      chunks.push(chunk);
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': contentType } }).formData();
    const name = String(form.get('name') || '').trim();
    const category = String(form.get('category') || '');
    const price = Number(form.get('price'));
    const description = String(form.get('description') || '').trim();
    const imageFile = form.get('image');
    if (name.length < 2 || name.length > 100 || !productCategories.includes(category) || !Number.isFinite(price) || price < 1 || price > 100000000 || description.length > 600) return response.status(400).json({ message: 'Enter a valid product name, jewellery type, price, and description.' });
    if (!imageFile || typeof imageFile.arrayBuffer !== 'function' || imageFile.size < 1) return response.status(400).json({ message: 'Choose a product image file.' });
    if (imageFile.size > 5 * 1024 * 1024) return response.status(413).json({ message: 'The image is too large. Choose an image smaller than 5 MB.' });
    const types = {
      'image/jpeg': { extension: '.jpg', valid: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
      'image/png': { extension: '.png', valid: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
      'image/webp': { extension: '.webp', valid: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
      'image/gif': { extension: '.gif', valid: (b) => /^GIF8[79]a$/.test(b.toString('ascii', 0, 6)) },
      'image/avif': { extension: '.avif', valid: (b) => b.toString('ascii', 4, 12).startsWith('ftypavi') }
    };
    const type = types[imageFile.type];
    if (!type) return response.status(415).json({ message: 'Choose a JPG, PNG, WebP, GIF, or AVIF image.' });
    const bytes = Buffer.from(await imageFile.arrayBuffer());
    if (!type.valid(bytes)) return response.status(415).json({ message: 'This file does not appear to be a valid image.' });
    const directory = path.join(root, 'uploads', 'products');
    await mkdir(directory, { recursive: true });
    const filename = `${randomUUID()}${type.extension}`;
    uploadedPath = path.join(directory, filename);
    await writeFile(uploadedPath, bytes, { flag: 'wx' });
    const [result] = await pool.execute('INSERT INTO products (name, category, price, image, description, active) VALUES (?, ?, ?, ?, ?, 1)', [name, category, Math.round(price), `/uploads/products/${filename}`, description]);
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [result.insertId]);
    return response.status(201).json(productDto(rows[0]));
  } catch (error) {
    if (uploadedPath) await unlink(uploadedPath).catch(() => {});
    if (error instanceof TypeError) return response.status(400).json({ message: 'The image upload could not be read. Please choose the file again.' });
    throw error;
  }
}));

app.delete('/api/admin/products/:id', requireAdmin, route(async (request, response) => {
  if (!/^\d+$/.test(request.params.id)) return response.status(404).json({ message: 'Product not found.' });
  const [rows] = await pool.execute('SELECT * FROM products WHERE id = ? LIMIT 1', [request.params.id]);
  if (!rows[0]) return response.status(404).json({ message: 'Product not found.' });
  if (rows[0].seed_key) return response.status(403).json({ message: 'Original catalog products are protected from deletion.' });
  await pool.execute('DELETE FROM products WHERE id = ?', [request.params.id]);
  if (/^\/uploads\/products\/[\w-]+\.(?:jpg|png|webp|gif|avif)$/i.test(rows[0].image)) await unlink(path.join(root, rows[0].image.slice(1))).catch(() => {});
  response.json({ message: 'Product deleted.' });
}));

app.patch('/api/admin/orders/:id/status', requireAdmin, route(async (request, response) => {
  const allowed = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
  if (!allowed.includes(request.body?.status)) return response.status(400).json({ message: 'Choose a valid order status.' });
  if (!/^\d+$/.test(request.params.id)) return response.status(404).json({ message: 'Order not found.' });
  const [result] = await pool.execute('UPDATE orders SET status = ? WHERE id = ?', [request.body.status, request.params.id]);
  if (!result.affectedRows) return response.status(404).json({ message: 'Order not found.' });
  response.json({ id: Number(request.params.id), status: request.body.status });
}));

app.post('/api/orders', route(async (request, response) => {
  const { customer, items, total, paymentMethod, cardBrand, cardLast4 } = request.body || {};
  const telephone = String(customer?.telephone || '').replace(/[\s-]/g, '');
  const email = String(customer?.email || '').trim().toLowerCase();
  const name = String(customer?.name || '').trim();
  const address = String(customer?.deliveryAddress || '').trim();
  if (name.length < 2 || name.length > 100 || !emailPattern.test(email) || !phonePattern.test(telephone) || !address || address.length > 500 || !Array.isArray(items) || !items.length || items.length > 50 || !Number.isFinite(total) || total < 0) return response.status(400).json({ message: 'Please provide valid customer, delivery, and cart details.' });
  if (!['cod', 'bank-card'].includes(paymentMethod)) return response.status(400).json({ message: 'Choose cash on delivery or bank card payment.' });
  if (paymentMethod === 'bank-card' && (!['visa', 'mastercard', 'amex'].includes(cardBrand) || !/^\d{4}$/.test(String(cardLast4 || '')))) return response.status(400).json({ message: 'Valid card details are required for bank card payment.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let computedTotal = 0;
    const snapshots = [];
    for (const item of items) {
      const productId = String(item.id || '');
      const quantity = Number(item.quantity);
      if (!/^\d+$/.test(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw Object.assign(new Error('Your cart contains an invalid product or quantity. Refresh the shop and try again.'), { status: 400 });
      const [products] = await connection.execute('SELECT id, name, price, image FROM products WHERE id = ? AND active = 1 LIMIT 1', [productId]);
      if (!products[0]) throw Object.assign(new Error('A product in your cart is no longer available. Refresh the shop and try again.'), { status: 400 });
      const basePrice = Number(products[0].price);
      const price = Number(String(item.price || '').replace(/[^0-9]/g, ''));
      const suppliedBasePrice = Number(item.basePrice) || price;
      if (suppliedBasePrice !== basePrice || ![basePrice, Math.round(basePrice * 0.75)].includes(price)) throw Object.assign(new Error('A product price changed. Refresh your cart before placing the order.'), { status: 400 });
      computedTotal += price * quantity;
      snapshots.push({ ...products[0], quantity, price });
    }
    if (computedTotal !== Math.round(Number(total))) throw Object.assign(new Error('The cart total changed. Refresh your cart before placing the order.'), { status: 400 });
    const [result] = await connection.execute('INSERT INTO orders (customer_name, customer_email, telephone, delivery_address, total, payment_method, card_brand, card_last4, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [name, email, telephone, address, computedTotal, paymentMethod, paymentMethod === 'bank-card' ? cardBrand : null, paymentMethod === 'bank-card' ? cardLast4 : null, 'Pending']);
    for (const item of snapshots) await connection.execute('INSERT INTO order_items (order_id, product_id, product_name, unit_price, image, quantity) VALUES (?, ?, ?, ?, ?, ?)', [result.insertId, item.id, item.name, item.price, item.image, item.quantity]);
    await connection.commit();
    response.status(201).json({ orderId: result.insertId, status: 'Pending' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.get('/api/orders/:id', route(async (request, response) => {
  if (!/^\d+$/.test(request.params.id)) return response.status(404).json({ message: 'Order not found.' });
  const order = await loadOrder(request.params.id);
  if (!order) return response.status(404).json({ message: 'Order not found.' });
  response.json(order);
}));

app.use((error, _request, response, _next) => {
  console.error(error.message);
  response.status(error.status || 500).json({ message: error.status ? error.message : 'The Eloria server could not complete this request. Check the MySQL connection and try again.' });
});

async function initializeDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS admins (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(200) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS customers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE, telephone VARCHAR(20) NOT NULL, password_hash VARCHAR(200) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  for (const table of ['admin_sessions', 'customer_sessions']) await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE, expires_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX session_expiry (expires_at), INDEX session_user (user_id),
    CONSTRAINT fk_${table}_user FOREIGN KEY (user_id) REFERENCES ${table === 'admin_sessions' ? 'admins' : 'customers'} (id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS products (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, seed_key VARCHAR(100) NULL UNIQUE,
    name VARCHAR(100) NOT NULL, category VARCHAR(40) NOT NULL, price INT UNSIGNED NOT NULL,
    image VARCHAR(500) NOT NULL, description VARCHAR(600) NOT NULL DEFAULT '', active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, customer_name VARCHAR(100) NOT NULL,
    customer_email VARCHAR(150) NOT NULL, telephone VARCHAR(20) NOT NULL, delivery_address VARCHAR(500) NOT NULL,
    total BIGINT UNSIGNED NOT NULL, payment_method ENUM('cod','bank-card') NOT NULL,
    card_brand ENUM('visa','mastercard','amex') NULL, card_last4 CHAR(4) NULL,
    status ENUM('Pending','Processing','Shipped','Delivered','Cancelled') NOT NULL DEFAULT 'Pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX orders_created (created_at)
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS order_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, order_id BIGINT UNSIGNED NOT NULL,
    product_id BIGINT UNSIGNED NULL, product_name VARCHAR(100) NOT NULL, unit_price INT UNSIGNED NOT NULL,
    image VARCHAR(500) NOT NULL, quantity SMALLINT UNSIGNED NOT NULL,
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
    CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL,
    INDEX order_items_order (order_id)
  ) ENGINE=InnoDB`);
  for (const product of catalogSeed) {
    await pool.execute('INSERT INTO products (seed_key, name, category, price, image, description, active) VALUES (?, ?, ?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE seed_key = VALUES(seed_key)', [product.seedKey, product.name, product.category, product.price, product.image, product.description || '']);
  }
  const username = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!username || !password || password.length < 8) throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD (at least 8 characters) in .env.');
  const [admins] = await pool.execute('SELECT id FROM admins WHERE username = ? LIMIT 1', [username]);
  if (admins[0]) await pool.execute('UPDATE admins SET password_hash = ? WHERE id = ?', [await passwordHash(password), admins[0].id]);
  else await pool.execute('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [username, await passwordHash(password)]);
  await pool.execute('DELETE FROM admin_sessions WHERE expires_at <= CURRENT_TIMESTAMP');
  await pool.execute('DELETE FROM customer_sessions WHERE expires_at <= CURRENT_TIMESTAMP');
}

async function start() {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 8) throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD (at least 8 characters) in .env.');
  await initializeDatabase();
  app.listen(port, () => console.log(`Eloria is running at http://localhost:${port}`));
}

start().catch(async (error) => { console.error(error.message); await pool.end(); process.exit(1); });
