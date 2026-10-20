# StockPilot (demo app)

A small inventory and orders app used as a test subject for automated test tools.
It is a static site (plain HTML + JavaScript). All data is kept in the browser's `localStorage`, so there is no server and nothing to install.

Demo login (fake, public): `admin@stockpilot.io` / `Stock@2026`

| Page | File | What it does |
|---|---|---|
| Sign in | `login.html` | Email + password, "Keep me signed in", lock after 3 failed tries |
| Dashboard | `dashboard.html` | Active products, low stock items, open orders, revenue this month, low-stock list, recent orders |
| Products | `products.html` | Add, edit, delete, search, "Low stock only" filter |
| Customers | `customers.html` | Add, edit, delete, search |
| Orders | `orders.html` | Create order, confirm (takes stock), ship, deliver, cancel (puts stock back), search, filter |
| Settings | `settings.html` | Company, tax rate, currency, shipping fee, free-shipping limit, reset demo data |

Shared code (navigation, auth, storage, order maths, toasts) is in `assets/js/core.js`.

## Notes for testers
The demo login is fake and public. Data never leaves your browser.

## Run locally
    python3 -m http.server 8000
Then open http://localhost:8000/login.html

## Publish on GitHub Pages
Repository Settings > Pages > Deploy from a branch > `main` / root.
The site address is `https://<account>.github.io/<repo>/login.html`.
