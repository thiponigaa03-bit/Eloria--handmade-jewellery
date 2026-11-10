# Viva Script: Products, Cart, and Admin Dashboard

## Opening

“My contribution focuses on the product catalogue and shopping cart, together with the related admin features for adding products and viewing customer orders. The website is built with HTML, CSS, and JavaScript on the client side, an Express server with Node.js, and MySQL for persistent application data.”

## Product catalogue

“Product records are stored in the MySQL `products` table. Each product has an ID, name, jewellery category, price in Sri Lankan rupees, image path, description, and active flag. The original shop catalogue is loaded from a JSON seed file on server startup. A stable seed key makes this import repeatable: restarting the application does not create a second copy of each seeded product.”

“The shop page requests active products from the `/api/products` endpoint. The server reads them from MySQL and returns JSON. JavaScript groups the products by jewellery category and builds the product cards. The cards show the product image, name, description, and price, and include an Add to Cart button.”

## Shopping cart and checkout

“The browser stores the current cart in local storage, so the cart remains available while the customer moves between pages in the same browser. Each cart entry includes the product ID, displayed product details, and quantity. The cart page lets the customer increase or decrease the quantity or remove an item, and recalculates the displayed total.”

“When the customer places an order, the browser sends the cart and delivery information to the Express checkout endpoint. The server checks the customer fields and payment method, looks up each product in MySQL, and calculates the total using stored product prices. It then saves the order and item snapshots in `orders` and `order_items` within one database transaction. This keeps the order consistent and preserves the product name and price as they were when the order was placed.”

“For a card payment, the application stores only the card brand and last four digits. It does not save the full card number, expiry date, or security code.”

## Admin product and order features

“The admin dashboard is protected by a separate admin sign-in. Successful sign-in creates an expiring HTTP-only session cookie. Admin sessions are stored separately from customer sessions, and protected API routes check the session before allowing access.”

“From the Products tab, the admin can choose an image file, select a jewellery category, enter a name, price, and description, and add the product. The image is checked for an accepted image format and size, saved to the uploads folder, and the product record is saved to MySQL. Admin-added products can also be deleted. Seeded catalogue products are marked and protected from accidental deletion.”

“The Orders tab reads orders from MySQL and displays the customer name, contact information, delivery address, payment method, purchased items, quantities, and total. The admin can update an order’s status, and the status change is saved to the database.”

## Database design summary

“The database has separate tables for `products`, `customers`, `admins`, `customer_sessions`, `admin_sessions`, `orders`, and `order_items`. The order-items table has a foreign key to its order, while product name, price, and image are copied into each order item as a purchase-time snapshot. Passwords are stored as salted scrypt hashes, and session tokens are stored as hashes.”

## Closing

“This design connects the product catalogue, cart checkout, and admin workflow through the same MySQL database. Product details are managed in one place, order totals are recalculated by the server, and the admin dashboard can manage products and review order information.”

## Likely viva questions

**Why use MySQL for this project?**

“Products, customers, orders, and order items have clear relationships. A relational database lets the application represent these records with primary keys, foreign keys, and transactions.”

**Why are order items stored separately from orders?**

“One order can contain multiple products. The `order_items` table represents that one-to-many relationship and stores a snapshot of each purchased item.”

**Why calculate the order total on the server?**

“Browser data can be edited by a user. The server retrieves product prices from MySQL and calculates the order total before saving it, instead of trusting a total sent by the browser.”

**Why does the cart use local storage?**

“It gives this client-side shop a simple way to keep the cart while navigating between pages without requiring an account. The final checkout is still validated and recorded by the server.”

**How are admin and customer access separated?**

“They use different login endpoints, cookies, session tables, and server-side checks. A customer session does not satisfy the admin middleware.”

**What happens if a product is deleted after an order is placed?**

“The order item keeps its saved name, price, and image path as a purchase snapshot. The product link can be cleared without losing what the customer ordered.”

**What would you improve for production?**

“I would add a payment provider instead of collecting card details in the browser, use HTTPS, add CSRF protection and request throttling, and move uploaded images to managed object storage.”
