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

// Cart icon is rendered by nav.js. This only updates the badge count.
function cartRenderBadge() {
  const badge = document.getElementById('fnCartBadge');
  if (!badge) return;
  const count = cartCount();
  badge.textContent = count || '';
  badge.classList.toggle('visible', count > 0);
}

cartRenderBadge();
document.addEventListener('DOMContentLoaded', cartRenderBadge);
