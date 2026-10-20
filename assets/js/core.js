/* StockPilot - shared helpers: storage, auth, totals, page shell, toast, confirm dialog.
   Demo only. All data lives in the browser (localStorage); there is no server. */
(function () {
  'use strict';

  // GitHub Pages shares one origin between all projects of an account,
  // so every storage key carries an app-specific prefix.
  var P = 'stockpilot_v1_';
  var K = {
    session: P + 'session',
    products: P + 'products',
    customers: P + 'customers',
    orders: P + 'orders',
    settings: P + 'settings',
    nextOrder: P + 'next_order',
    fails: P + 'login_fails',
    lock: P + 'login_lock'
  };

  // Demo credentials (fake, public). Do not reuse this password anywhere else.
  var DEMO = { email: 'admin@stockpilot.io', password: 'Stock@2026', name: 'Ops Admin' };
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
  var DEFAULT_SETTINGS = { company: 'StockPilot Trading', taxRate: 8, currency: 'USD', shippingFee: 5, freeShippingFrom: 100 };
  var OPEN_STATUSES = ['Pending', 'Confirmed', 'Shipped'];

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked */ }
  }

  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
  function today() { return isoDate(new Date()); }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function settings() {
    return Object.assign({}, DEFAULT_SETTINGS, read(K.settings, null) || {});
  }
  function money(n) {
    var cur = settings().currency || 'USD';
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n); }
    catch (e) { return cur + ' ' + Number(n).toFixed(2); }
  }

  // Order maths. Shipping is free once the subtotal reaches the free-shipping limit.
  function totals(lines, s) {
    s = s || settings();
    var subtotal = round2(lines.reduce(function (sum, l) { return sum + l.qty * l.unitPrice; }, 0));
    var shipping = subtotal === 0 ? 0 : (subtotal >= s.freeShippingFrom ? 0 : s.shippingFee);
    var tax = round2(subtotal * s.taxRate / 100);
    return { subtotal: subtotal, shipping: shipping, tax: tax, total: round2(subtotal + shipping + tax) };
  }

  function isLow(p) { return !!p.active && p.stock <= p.reorder; }

  function seed() {
    if (read(K.settings, null) === null) write(K.settings, DEFAULT_SETTINGS);
    if (read(K.products, null) === null) {
      write(K.products, [
        { id: 'P-001', name: 'Wireless Mouse', sku: 'WMS-100', price: 25, stock: 40, reorder: 10, active: true },
        { id: 'P-002', name: 'Mechanical Keyboard', sku: 'KBD-200', price: 79, stock: 11, reorder: 10, active: true },
        { id: 'P-003', name: 'USB-C Hub', sku: 'HUB-300', price: 45.5, stock: 4, reorder: 5, active: true },
        { id: 'P-004', name: 'Laptop Stand', sku: 'STD-400', price: 32, stock: 0, reorder: 5, active: true }
      ]);
    }
    if (read(K.customers, null) === null) {
      write(K.customers, [
        { id: 'C-001', name: 'Brightside Retail', email: 'orders@brightside.test', phone: '+1 555 0201' },
        { id: 'C-002', name: 'Northwind Traders', email: 'buying@northwind.test', phone: '+1 555 0202' }
      ]);
    }
    if (read(K.orders, null) === null) {
      var t = today();
      var l1 = [{ productId: 'P-001', qty: 2, unitPrice: 25 }, { productId: 'P-002', qty: 1, unitPrice: 79 }];
      var l2 = [{ productId: 'P-003', qty: 1, unitPrice: 45.5 }];
      var a = totals(l1), b = totals(l2);
      write(K.orders, [
        { id: 'ORD-0001', customerId: 'C-001', date: t, lines: l1, subtotal: a.subtotal, shipping: a.shipping, taxRate: settings().taxRate, tax: a.tax, total: a.total, status: 'Pending' },
        { id: 'ORD-0002', customerId: 'C-002', date: addDays(t, -2), lines: l2, subtotal: b.subtotal, shipping: b.shipping, taxRate: settings().taxRate, tax: b.tax, total: b.total, status: 'Delivered', deliveredDate: t }
      ]);
      write(K.nextOrder, 3);
    }
  }

  function resetDemoData() {
    [K.products, K.customers, K.orders, K.settings, K.nextOrder].forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
    });
    seed();
  }

  /* ---------- session ---------- */
  function getSession() {
    try {
      return JSON.parse(sessionStorage.getItem(K.session) || localStorage.getItem(K.session) || 'null');
    } catch (e) { return null; }
  }
  function setSession(user, persist) {
    var raw = JSON.stringify(user);
    try { sessionStorage.setItem(K.session, raw); } catch (e) { /* ignore */ }
    if (persist) write(K.session, user);
  }
  function requireAuth() {
    var s = getSession();
    if (!s) { location.replace('login.html'); return null; }
    return s;
  }
  function logout() {
    try { sessionStorage.removeItem(K.session); localStorage.removeItem(K.session); } catch (e) { /* ignore */ }
    location.href = 'login.html';
  }

  /* ---------- toast ---------- */
  function toast(message, kind) {
    var region = document.getElementById('toast-region');
    if (!region) {
      region = document.createElement('div');
      region.id = 'toast-region';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    var el = document.createElement('div');
    el.className = 'toast ' + (kind === 'error' ? 'toast-error' : 'toast-ok');
    el.textContent = message;
    region.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4500);
  }

  /* ---------- confirm dialog ---------- */
  function confirmDialog(message, yesLabel, noLabel) {
    return new Promise(function (resolve) {
      var dlg = document.getElementById('confirm-dialog');
      if (dlg) dlg.parentNode.removeChild(dlg);
      dlg = document.createElement('dialog');
      dlg.id = 'confirm-dialog';
      dlg.setAttribute('aria-labelledby', 'confirm-title');
      dlg.innerHTML = '<h2 id="confirm-title">Please confirm</h2><p id="confirm-message"></p>' +
        '<div class="dialog-actions"><button type="button" class="btn" id="confirm-no"></button>' +
        '<button type="button" class="btn btn-danger" id="confirm-yes"></button></div>';
      document.body.appendChild(dlg);
      dlg.querySelector('#confirm-message').textContent = message;
      dlg.querySelector('#confirm-yes').textContent = yesLabel || 'Confirm';
      dlg.querySelector('#confirm-no').textContent = noLabel || 'Cancel';
      var done = false;
      function finish(v) { if (done) return; done = true; dlg.close(); resolve(v); }
      dlg.querySelector('#confirm-yes').addEventListener('click', function () { finish(true); });
      dlg.querySelector('#confirm-no').addEventListener('click', function () { finish(false); });
      dlg.addEventListener('cancel', function () { done = true; resolve(false); });
      dlg.showModal();
    });
  }

  /* ---------- page shell ---------- */
  var NAV = [
    ['dashboard', 'Dashboard', 'dashboard.html'],
    ['products', 'Products', 'products.html'],
    ['customers', 'Customers', 'customers.html'],
    ['orders', 'Sales', 'orders.html'],
    ['settings', 'Settings', 'settings.html']
  ];
  function mountShell(active) {
    var session = requireAuth();
    if (!session) return false;
    seed();
    var side = document.getElementById('sidebar');
    var top = document.getElementById('topbar');
    if (side) {
      side.innerHTML = '<span class="brand">StockPilot</span><nav aria-label="Main">' +
        NAV.map(function (n) {
          return '<a href="' + n[2] + '"' + (n[0] === active ? ' aria-current="page"' : '') + '>' + n[1] + '</a>';
        }).join('') + '</nav>';
    }
    if (top) {
      top.innerHTML = '<span class="company">' + esc(settings().company) + '</span>' +
        '<span><span id="signed-in-as">' + esc(session.name || session.email) + '</span> ' +
        '<button type="button" class="btn btn-sm" id="logout">Logout</button></span>';
      document.getElementById('logout').addEventListener('click', logout);
    }
    return true;
  }

  window.SP = {
    K: K, DEMO: DEMO, EMAIL_RE: EMAIL_RE, OPEN_STATUSES: OPEN_STATUSES,
    read: read, write: write, today: today, addDays: addDays, round2: round2, esc: esc,
    settings: settings, money: money, totals: totals, isLow: isLow, seed: seed, resetDemoData: resetDemoData,
    getSession: getSession, setSession: setSession, requireAuth: requireAuth, logout: logout,
    toast: toast, confirm: confirmDialog, mountShell: mountShell
  };
})();
