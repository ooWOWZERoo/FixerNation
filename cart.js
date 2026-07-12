/* Fixer Nation shopping cart — shared by every public page that can add
   books or license products. Persisted in localStorage (no login required)
   so a visitor can build a cart and check out later on the same browser. */

const FN_CART_KEY = 'fnCart';

function cartGet() {
  try {
    const raw = localStorage.getItem(FN_CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function cartSave(items) {
  localStorage.setItem(FN_CART_KEY, JSON.stringify(items));
  cartRenderBadge();
}

// item: { type: 'book'|'license_product', id, name, price, quantity, schoolDomain }
// Books merge into an existing line by id (quantity++); license products
// always add as a new line, since each one may be for a different school domain.
function cartAdd(item) {
  if (typeof fnTrackEvent === 'function') fnTrackEvent('add_to_cart', item.name || '');
  const items = cartGet();
  if (item.type === 'book') {
    const existing = items.find(i => i.type === 'book' && i.id === item.id);
    if (existing) {
      existing.quantity = (existing.quantity || 1) + (item.quantity || 1);
      cartSave(items);
      return;
    }
  }
  items.push({ ...item, quantity: item.quantity || 1 });
  cartSave(items);
}

function cartRemove(index) {
  const items = cartGet();
  items.splice(index, 1);
  cartSave(items);
}

function cartUpdateQuantity(index, quantity) {
  const items = cartGet();
  if (!items[index]) return;
  items[index].quantity = Math.max(1, Number(quantity) || 1);
  cartSave(items);
}

function cartUpdateDomain(index, domain) {
  const items = cartGet();
  if (!items[index]) return;
  items[index].schoolDomain = domain;
  cartSave(items);
}

function cartClear() {
  cartSave([]);
}

function cartCount() {
  return cartGet().reduce((sum, i) => sum + (i.quantity || 1), 0);
}

function cartTotal() {
  return cartGet().reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0);
}

// Inject cart icon CSS once
(function () {
  if (document.getElementById('fn-cart-css')) return;
  const s = document.createElement('style');
  s.id = 'fn-cart-css';
  s.textContent =
    '.fn-cart-btn{display:flex;align-items:center;justify-content:center;position:relative;width:38px;height:38px;border-radius:10px;color:var(--teal-dark,#0E3733);text-decoration:none;transition:background .15s;}' +
    '.fn-cart-btn:hover{background:rgba(22,79,74,.08);}' +
    '.fn-cart-btn svg{display:block;}' +
    '.fn-cart-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:var(--coral,#F26B4D);color:#fff;font-size:11px;font-weight:700;line-height:18px;text-align:center;box-sizing:border-box;display:none;}' +
    '.fn-cart-badge.visible{display:block;}';
  (document.head || document.documentElement).appendChild(s);
})();

function cartRenderBadge() {
  const nav = document.getElementById('fnCartNav');
  if (!nav) return;
  const count = cartCount();
  nav.innerHTML =
    '<a href="cart.html" class="fn-cart-btn" title="Cart">' +
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>' +
        '<line x1="3" y1="6" x2="21" y2="6"/>' +
        '<path d="M16 10a4 4 0 0 1-8 0"/>' +
      '</svg>' +
      '<span class="fn-cart-badge' + (count ? ' visible' : '') + '">' + (count || '') + '</span>' +
    '</a>';
}

cartRenderBadge();
