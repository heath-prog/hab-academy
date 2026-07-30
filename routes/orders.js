// WP-SIGNUP: printed book orders.
// Each HAB book is $65 per printed copy. There is NO card processing yet:
// orders are recorded with status 'invoice_pending' and HAB invoices the shop
// manually. Stripe integration comes later — when it lands, POST /orders is
// where the payment intent gets created before the order row.
// Ordering requires an active agreement (enforced by the enforceAgreement
// middleware mounted before this router in server.js).
import express from 'express';
import { requireAuth, requireRole } from '../lib/auth.js';
import { BookOrders, Shops } from '../lib/db.js';
import { BOOK_PRICE_CENTS } from '../lib/agreements.js';
import { BOOKS } from './library.js';

export const ordersRouter = express.Router();

// WP-ACADEMY-2: shop-floor posters. No fixed price — poster runs are custom
// (size, material, quantity), so the price is quoted on the invoice HAB sends.
// Same invoice-pending flow as the books; poster line items carry a
// unit_price_cents of 0 and are excluded from the online order total.
export const POSTERS = [
  { slug: 'poster-66-step',  title: '66-Step Process Poster' },
  { slug: 'poster-wall-set', title: 'HAB Wall Poster Set' },
];
const isPosterSlug = (slug) => slug.startsWith('poster-');

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

function ordersWithItems(rows) {
  return rows.map(o => {
    const items = BookOrders.itemsFor(o.id).map(i => ({ ...i, quoted: isPosterSlug(i.book_slug) }));
    return { ...o, items, hasQuoted: items.some(i => i.quoted), total: money(o.total_cents) };
  });
}

// ===== Order form + shop order history (owner/coach) =====
ordersRouter.get('/orders', requireAuth, requireRole('owner', 'coach'), (req, res) => {
  const shopId = req.session.role === 'hab_admin'
    ? (parseInt(req.query.shopId, 10) || null)
    : req.session.shopId;
  if (!shopId) return res.redirect('/admin/orders'); // hab_admin without shop context
  const shop = Shops.byId(shopId);
  if (!shop) return res.status(404).render('404');
  res.render('orders', {
    user: req.session,
    shop,
    books: BOOKS.map(b => ({ slug: b.slug, title: b.title, subtitle: b.subtitle, version: b.version })),
    posters: POSTERS,
    priceCents: BOOK_PRICE_CENTS,
    price: money(BOOK_PRICE_CENTS),
    orders: ordersWithItems(BookOrders.forShop(shopId)),
    message: req.query.message || null,
    error: req.query.error || null,
  });
});

ordersRouter.post('/orders', requireAuth, requireRole('owner', 'coach'), (req, res) => {
  const shopId = req.session.role === 'hab_admin'
    ? (parseInt(req.body.shopId, 10) || null)
    : req.session.shopId;
  if (!shopId) return res.status(403).send('No shop context.');

  const shipName = String(req.body.shipName || '').trim();
  const shipAddress = String(req.body.shipAddress || '').trim();
  const billAddress = String(req.body.billAddress || '').trim() || shipAddress;

  const items = [];
  for (const b of BOOKS) {
    const qty = parseInt(req.body[`qty_${b.slug}`], 10) || 0;
    if (qty > 0) items.push({ book_slug: b.slug, book_title: `${b.title} ${b.version}`, qty: Math.min(qty, 500), unit_price_cents: BOOK_PRICE_CENTS });
  }
  // WP-ACADEMY-2: posters ride the same order with a 0-cent line item; the
  // real price is quoted on the invoice.
  for (const pItem of POSTERS) {
    const qty = parseInt(req.body[`qty_${pItem.slug}`], 10) || 0;
    if (qty > 0) items.push({ book_slug: pItem.slug, book_title: `${pItem.title} (price quoted on order)`, qty: Math.min(qty, 500), unit_price_cents: 0 });
  }

  const back = req.session.role === 'hab_admin' ? `/orders?shopId=${shopId}&` : '/orders?';
  if (!items.length)               return res.redirect(`${back}error=${encodeURIComponent('Add at least one item to your order')}`);
  if (!shipName || !shipAddress)   return res.redirect(`${back}error=${encodeURIComponent('Shipping name and address are required')}`);

  // NOTE: no card processing yet — the order is recorded and HAB invoices the
  // shop manually. Stripe checkout will slot in here later.
  const orderId = BookOrders.create({
    shop_id: shopId, user_id: req.session.userId,
    ship_name: shipName, ship_address: shipAddress, bill_address: billAddress,
    items,
  });
  console.log(`[orders] order #${orderId} recorded for shop ${shopId} (${items.reduce((n, i) => n + i.qty, 0)} copies, invoice pending).`);
  res.redirect(`${back}message=${encodeURIComponent(`Order #${orderId} received. HAB will invoice you; no payment is taken online.`)}`);
});
