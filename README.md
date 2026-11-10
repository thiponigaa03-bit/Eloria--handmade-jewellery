# Eloria Handmade Jewellery

## Run locally with MySQL

Requirements: Node.js 20 or newer and MySQL Server 8.0 or newer. In Windows Services, make sure `MySQL80` is running.

1. In MySQL Workbench, connect as a MySQL administrator and run the SQL below once. Use the same app password in `.env`.
2. Set `MYSQL_USER=eloria_app`, `MYSQL_PASSWORD` to your chosen app password, and `MYSQL_DATABASE=eloria` in `.env`. Set a private `ADMIN_USERNAME` and `ADMIN_PASSWORD` of at least 8 characters.
3. Install the Node dependencies with `npm install`.
4. Start the site with `npm start` and open `http://localhost:3000/home.html`.

```sql
CREATE DATABASE IF NOT EXISTS eloria
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'eloria_app'@'127.0.0.1' IDENTIFIED BY 'same-password-as-MYSQL_PASSWORD-in-env';
ALTER USER 'eloria_app'@'127.0.0.1' IDENTIFIED BY 'same-password-as-MYSQL_PASSWORD-in-env';
GRANT ALL PRIVILEGES ON eloria.* TO 'eloria_app'@'127.0.0.1';
```

At startup, the server creates the app tables, the configured admin account, and any missing catalog products. It imports the existing 60 catalog items by stable seed key, so restarts do not add duplicates or overwrite catalog edits. Images remain as files in the project; MySQL stores their paths.

## Data stored in MySQL

- `products`: seeded catalog and admin-added jewellery, category, price, image path, description, and availability.
- `customers`: registered customer profiles and scrypt password hashes.
- `admins`: admin usernames and scrypt password hashes.
- `customer_sessions` / `admin_sessions`: hashed session tokens with expiry; the two account types have separate sessions.
- `orders` / `order_items`: delivery and payment details, a product/price snapshot, quantities, total, and status. The checkout recalculates totals from database product prices. Card orders retain only brand and last four digits; the full card number, expiry, and CVV are never stored.

Admin sign-in is at `/admin-login.html`. The dashboard shows order details and lets the admin update statuses or add and delete admin-added products. Imported catalog products are protected from deletion. The customer shop loads its catalogue from MySQL and stores the active cart in browser local storage until checkout.

## If startup fails

- `Access denied for user`: set the correct app password in `.env` and verify the one-time Workbench SQL setup above.
- `ECONNREFUSED`: start the `MySQL80` Windows service and check `MYSQL_HOST` and `MYSQL_PORT`.
- `ADMIN_PASSWORD`: use at least 8 characters.
- Check that `MYSQL_DATABASE` contains only letters, numbers, and underscores.

The old `MONGODB_URI` setting is not used by the MySQL version. Do not commit `.env` or share its passwords.

## Viva notes

See [VIVA-SCRIPT.md](VIVA-SCRIPT.md) for the presentation script focused on products, cart, and the admin dashboard.
