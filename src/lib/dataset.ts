/**
 * Generates the raw layer of the fictional company "Tidepool Coffee Co." —
 * a DTC coffee brand selling beans, brewing gear and subscriptions.
 *
 * Everything is seeded, so every learner (and every grader) sees identical
 * data. A handful of realistic data-quality problems are planted on purpose:
 *   - CDC history: some customers appear 2-3 times in raw.customers (one row per change)
 *   - re-delivered order rows (same id, later _loaded_at, sometimes newer status)
 *   - orphan orders whose customer_id does not exist (legacy guest checkout)
 *   - internal QA accounts on the @tidepool.test domain
 *   - messy emails (case / whitespace), missing countries
 *   - FX rates only on business days, and no USD row
 *   - subscriptions with cancelled_at before started_at
 *   - late-arriving mobile events (_loaded_at days after event_ts)
 */
import { expo, int, mulberry32, pick, weighted, type Rng } from './prng';

export const DATA_START = Date.UTC(2025, 0, 1);
export const DATA_END = Date.UTC(2026, 5, 30, 23, 59, 59); // 2026-06-30
export const EVENTS_START = Date.UTC(2026, 3, 1); // 2026-04-01
const DAY = 86_400_000;
const HOUR = 3_600_000;

export interface RawTable {
  name: string;
  /** defaults to 'raw'; 'ingest' holds rows the EL tool has not delivered yet */
  schema?: string;
  description: string;
  columns: { name: string; type: string; description: string }[];
  rows: (string | number | boolean | null)[][];
}

function ts(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}
function date(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const FIRST = ['Ava', 'Liam', 'Maja', 'Noah', 'Emma', 'Oliver', 'Sofia', 'Lucas', 'Mia', 'Elias', 'Freya', 'Hugo', 'Isla', 'Leo', 'Nora', 'Felix', 'Alice', 'Jack', 'Ella', 'Oscar', 'Zoe', 'Theo', 'Lena', 'Max', 'Chloe', 'Arlo', 'Ines', 'Sam', 'Ruby', 'Ivan', 'Priya', 'Kenji', 'Amara', 'Diego', 'Yara', 'Omar'];
const LAST = ['Smith', 'Jensen', 'Müller', 'Garcia', 'Brown', 'de Vries', 'Andersson', 'Martin', 'Wilson', 'Nguyen', 'Kowalski', 'Rossi', 'Dubois', 'Taylor', 'Larsen', 'Schmidt', 'Patel', 'Lee', 'Novak', 'Clarke', 'Berg', 'Moreau', 'Walsh', 'Okafor'];
const DOMAINS = ['gmail.com', 'outlook.com', 'proton.me', 'icloud.com', 'yahoo.com', 'hey.com'];

const COUNTRIES = [
  ['US', 35],
  ['GB', 18],
  ['DE', 12],
  ['FR', 8],
  ['NL', 8],
  ['CA', 7],
  ['SE', 6],
  ['AU', 6],
] as const;
const CURRENCY: Record<string, string> = { US: 'USD', GB: 'GBP', DE: 'EUR', FR: 'EUR', NL: 'EUR', CA: 'CAD', SE: 'SEK', AU: 'AUD' };
/** Local list-price multiplier vs USD and the FX base rate (USD per 1 unit). */
const CCY = {
  USD: { mult: 1, fx: 1 },
  EUR: { mult: 0.92, fx: 1.085 },
  GBP: { mult: 0.79, fx: 1.265 },
  SEK: { mult: 10.5, fx: 0.0948 },
  CAD: { mult: 1.36, fx: 0.733 },
  AUD: { mult: 1.52, fx: 0.658 },
} as const;
type Ccy = keyof typeof CCY;

const SOURCES = [
  ['organic', 35],
  ['paid_search', 22],
  ['paid_social', 18],
  ['referral', 15],
  ['partner', 10],
] as const;

export const PRODUCTS: [number, string, string, number, string][] = [
  [1, 'Ethiopia Yirgacheffe 250g', 'coffee', 1600, '2024-06-01'],
  [2, 'Colombia Huila 250g', 'coffee', 1400, '2024-06-01'],
  [3, 'Kenya AA 250g', 'coffee', 1700, '2024-06-01'],
  [4, 'Brazil Cerrado 1kg', 'coffee', 3800, '2024-06-01'],
  [5, 'House Espresso 1kg', 'coffee', 3400, '2024-06-01'],
  [6, 'Decaf Swiss Water 250g', 'coffee', 1500, '2024-09-15'],
  [7, 'Guatemala Antigua 250g', 'coffee', 1500, '2025-03-01'],
  [8, 'Seasonal Single Origin 250g', 'coffee', 1800, '2025-09-01'],
  [9, 'V60 Dripper', 'equipment', 2500, '2024-06-01'],
  [10, 'Burr Grinder', 'equipment', 14900, '2024-06-01'],
  [11, 'Gooseneck Kettle', 'equipment', 6900, '2024-06-01'],
  [12, 'AeroPress', 'equipment', 3900, '2024-06-01'],
  [13, 'Digital Scale', 'equipment', 4500, '2025-01-20'],
  [14, 'French Press', 'equipment', 3500, '2024-06-01'],
  [15, 'Tidepool Mug', 'merch', 1800, '2024-06-01'],
  [16, 'Tote Bag', 'merch', 1500, '2024-06-01'],
  [17, 'Beanie', 'merch', 2200, '2025-10-01'],
  [18, 'Gift Card 50', 'gift_card', 5000, '2024-11-01'],
];
const PRODUCT_WEIGHTS = PRODUCTS.map(([id, , cat]) => [id, cat === 'coffee' ? 10 : cat === 'equipment' ? 2.2 : cat === 'merch' ? 1.4 : 0.8] as const);

function localPrice(usdCents: number, ccy: Ccy): number {
  return Math.round((usdCents * CCY[ccy].mult) / 100) * 100;
}

/** Skewed toward later dates so the business visibly grows. */
function growthTime(rng: Rng, start: number, end: number): number {
  return start + Math.sqrt(rng()) * (end - start);
}

export interface Dataset {
  tables: RawTable[];
}

export function generateDataset(seed = 20260701): Dataset {
  const rng = mulberry32(seed);

  // ---------------------------------------------------------------- customers
  type Customer = { id: number; first: string; last: string; email: string; country: string | null; source: string; created: number; isTest: boolean };
  const customers: Customer[] = [];
  const customerRows: RawTable['rows'] = [];
  const N_CUSTOMERS = 600;
  const testIds = new Set<number>();
  while (testIds.size < 12) testIds.add(int(rng, 1, N_CUSTOMERS));

  for (let id = 1; id <= N_CUSTOMERS; id++) {
    const first = pick(rng, FIRST);
    const last = pick(rng, LAST);
    const isTest = testIds.has(id);
    const handle = `${first}.${last.replace(/[^A-Za-z]/g, '')}${int(rng, 1, 99)}`.toLowerCase();
    let email = isTest ? `qa+${id}@tidepool.test` : `${handle}@${pick(rng, DOMAINS)}`;
    const country = rng() < 0.03 ? null : weighted(rng, COUNTRIES);
    const source = isTest ? 'organic' : weighted(rng, SOURCES);
    const created = growthTime(rng, DATA_START, DATA_END - 3 * DAY);
    customers.push({ id, first, last, email, country, source, created, isTest });

    // messy raw email formatting
    let rawEmail = email;
    const m = rng();
    if (m < 0.06) rawEmail = email.toUpperCase();
    else if (m < 0.1) rawEmail = `  ${email} `;
    else if (m < 0.13) rawEmail = email.charAt(0).toUpperCase() + email.slice(1);

    let updated = created;
    customerRows.push([id, first, last, rawEmail, country, source, ts(created), ts(updated), ts(created + int(rng, 1, 6) * HOUR)]);

    // CDC history: later versions of the same customer
    const versions = rng() < 0.12 ? (rng() < 0.15 ? 2 : 1) : 0;
    let curCountry = country;
    for (let v = 0; v < versions; v++) {
      updated = updated + Math.max(DAY, expo(rng, 90 * DAY));
      if (updated > DATA_END) break;
      if (rng() < 0.5 || isTest) {
        curCountry = weighted(rng, COUNTRIES);
      } else {
        email = `${handle}.${int(rng, 1, 9)}@${pick(rng, DOMAINS)}`;
      }
      customerRows.push([id, first, last, email, curCountry, source, ts(created), ts(updated), ts(updated + int(rng, 1, 6) * HOUR)]);
    }
  }

  // ---------------------------------------------------------------- orders
  const orderRows: RawTable['rows'] = [];
  const itemRows: RawTable['rows'] = [];
  const paymentRows: RawTable['rows'] = [];
  let orderId = 1000;
  let itemId = 1;
  let paymentId = 1;
  const customerFirstOrder = new Map<number, number>();

  const sourceRepeatBoost: Record<string, number> = { organic: 1.15, paid_search: 0.9, paid_social: 0.7, referral: 1.35, partner: 1.0 };

  type OrderSpec = { id: number; customerId: number; at: number; ccy: Ccy; status: string; firstOrder: boolean };
  const orderSpecs: OrderSpec[] = [];

  for (const c of customers) {
    if (!c.isTest && rng() < 0.18) continue; // never ordered
    const ccy = (c.country ? CURRENCY[c.country] : 'USD') as Ccy;
    let t = c.created + expo(rng, 2 * DAY);
    let n = 0;
    const maxOrders = c.isTest ? 3 : 14;
    const keepProb = Math.min(0.85, 0.62 * (sourceRepeatBoost[c.source] ?? 1));
    while (t < DATA_END && n < maxOrders) {
      const status = statusFor(rng, t);
      orderSpecs.push({ id: 0, customerId: c.id, at: t, ccy, status, firstOrder: n === 0 });
      if (n === 0) customerFirstOrder.set(c.id, t);
      n++;
      if (rng() > keepProb) break;
      t += Math.max(3 * DAY, expo(rng, 48 * DAY));
    }
  }
  // orphan orders from the legacy guest checkout migration
  for (let i = 0; i < 6; i++) {
    orderSpecs.push({ id: 0, customerId: 9001 + i, at: growthTime(rng, DATA_START, Date.UTC(2025, 2, 31)), ccy: 'USD', status: 'completed', firstOrder: true });
  }

  orderSpecs.sort((a, b) => a.at - b.at);
  for (const o of orderSpecs) o.id = ++orderId;

  const duplicatePicks = new Set<number>();
  while (duplicatePicks.size < 25) duplicatePicks.add(int(rng, Math.floor(orderSpecs.length * 0.75), orderSpecs.length - 1));

  orderSpecs.forEach((o, idx) => {
    // items
    const lines = weighted(rng, [
      [1, 50],
      [2, 30],
      [3, 14],
      [4, 6],
    ] as const);
    const used = new Set<number>();
    let subtotal = 0;
    for (let l = 0; l < lines; l++) {
      const pid = weighted(rng, PRODUCT_WEIGHTS);
      if (used.has(pid)) continue;
      used.add(pid);
      const qty = weighted(rng, [
        [1, 75],
        [2, 20],
        [3, 5],
      ] as const);
      const price = localPrice(PRODUCTS[pid - 1][3], o.ccy);
      subtotal += qty * price;
      itemRows.push([itemId++, o.id, pid, qty, price]);
    }
    const freeShipThreshold = localPrice(5000, o.ccy);
    const shipping = subtotal >= freeShipThreshold ? 0 : localPrice(500, o.ccy) - Math.round(localPrice(500, o.ccy) * 0.01);
    let discountCode: string | null = null;
    let discount = 0;
    if (o.firstOrder && rng() < 0.3) discountCode = 'WELCOME10';
    else if (rng() < 0.08) discountCode = pick(rng, ['SUMMER15', 'BREW20', 'FRIENDS10']);
    if (discountCode) discount = Math.round((subtotal * Number(discountCode.replace(/\D/g, ''))) / 100);
    const total = subtotal + shipping - discount;

    const loaded = o.at + int(rng, 1, 5) * HOUR;
    const isDup = duplicatePicks.has(idx);
    const firstStatus = isDup && rng() < 0.4 ? 'placed' : o.status;
    orderRows.push([o.id, o.customerId, ts(o.at), firstStatus, o.ccy, shipping, discountCode, discount, ts(loaded)]);
    if (isDup) {
      // re-delivered by the ingestion tool a day later
      orderRows.push([o.id, o.customerId, ts(o.at), o.status, o.ccy, shipping, discountCode, discount, ts(loaded + DAY + int(rng, 0, 6) * HOUR)]);
    }

    // payments
    const payAt = o.at + int(rng, 5, 90) * 1000;
    const method = o.ccy === 'EUR' || o.ccy === 'SEK' ? weighted(rng, [['card', 62], ['paypal', 22], ['bank_transfer', 16]] as const) : weighted(rng, [['card', 75], ['paypal', 25]] as const);
    if (o.status === 'cancelled') {
      paymentRows.push([paymentId++, o.id, method, 'failed', total, ts(payAt)]);
      return;
    }
    if (rng() < 0.09) paymentRows.push([paymentId++, o.id, 'card', 'failed', total, ts(payAt - 40_000)]);
    if (rng() < 0.05 && total > 2000) {
      const gc = Math.min(total - 500, localPrice(2500, o.ccy));
      paymentRows.push([paymentId++, o.id, 'gift_card', 'success', gc, ts(payAt)]);
      paymentRows.push([paymentId++, o.id, method, 'success', total - gc, ts(payAt + 3000)]);
    } else {
      paymentRows.push([paymentId++, o.id, method, 'success', total, ts(payAt)]);
    }
    if (o.status === 'returned') paymentRows.push([paymentId++, o.id, method, 'refunded', total, ts(o.at + int(rng, 8, 25) * DAY)]);
  });

  // ---------------------------------------------------------------- subscriptions
  const subRows: RawTable['rows'] = [];
  let subId = 1;
  for (const c of customers) {
    const first = customerFirstOrder.get(c.id);
    if (first === undefined || c.isTest) continue;
    if (rng() > 0.42) continue;
    const ccy = (c.country ? CURRENCY[c.country] : 'USD') as Ccy;
    const plan = rng() < 0.27 ? 'annual' : 'monthly';
    const start = first + expo(rng, 20 * DAY);
    if (start > DATA_END - DAY) continue;
    const amount = plan === 'annual' ? localPrice(29900, ccy) : localPrice(2900, ccy);
    const life = expo(rng, plan === 'annual' ? 420 * DAY : 170 * DAY);
    const cancel = start + life < DATA_END ? start + life : null;
    subRows.push([subId++, c.id, plan, amount, ccy, date(start), cancel ? date(cancel) : null]);
  }
  // two bad rows from a botched backfill: cancelled before started
  for (const bad of [5, 17]) {
    const r = subRows[bad];
    if (r) {
      const started = Date.parse(String(r[5]));
      r[6] = date(started - int(rng, 3, 40) * DAY);
    }
  }

  // ---------------------------------------------------------------- events
  const eventRows: RawTable['rows'] = [];
  let evt = 1;
  const PATHS = ['/', '/shop', '/shop/coffee', '/shop/equipment', '/subscriptions', '/blog/brew-guide', '/blog/origin-stories', '/about'];
  const identifiable = customers.filter((c) => !c.isTest && c.created < DATA_END - 30 * DAY);
  for (let v = 0; v < 2600; v++) {
    const anon = `anon_${(v * 2654435761 >>> 0).toString(16).padStart(8, '0')}`;
    const device = rng() < 0.62 ? 'mobile' : 'desktop';
    const known = rng() < 0.28 ? pick(rng, identifiable).id : null;
    let identified = false;
    const sessions = weighted(rng, [[1, 55], [2, 22], [3, 12], [4, 7], [6, 4]] as const);
    let t = EVENTS_START + rng() * (DATA_END - EVENTS_START - 2 * DAY);
    for (let s = 0; s < sessions && t < DATA_END; s++) {
      const utm = weighted(rng, [[null, 45], ['google', 25], ['instagram', 15], ['newsletter', 10], ['tiktok', 5]] as const);
      const push = (name: string, path: string | null, first: boolean) => {
        const late = device === 'mobile' && rng() < 0.05 ? int(rng, 20, 72) * HOUR : int(rng, 1, 40) * 60_000;
        eventRows.push([`evt_${String(evt++).padStart(6, '0')}`, anon, identified ? known : null, name, ts(t), path, first ? utm : null, device, ts(t + late)]);
        t += int(rng, 8, 240) * 1000;
      };
      const views = int(rng, 1, 5);
      for (let p = 0; p < views; p++) push('page_view', p === 0 ? weighted(rng, [['/', 50], ['/blog/brew-guide', 20], ['/shop', 20], ['/subscriptions', 10]] as const) : pick(rng, PATHS), p === 0);
      if (known && !identified && rng() < 0.6) {
        identified = true;
        push('login', '/account', false);
      }
      if (rng() < 0.55) {
        push('product_viewed', `/product/${int(rng, 1, 18)}`, false);
        if (rng() < 0.38) {
          push('add_to_cart', null, false);
          if (rng() < 0.62) {
            push('checkout_started', '/checkout', false);
            if (rng() < 0.68) {
              if (known && !identified) {
                identified = true;
                push('login', '/checkout', false);
              }
              push('order_completed', '/checkout/thanks', false);
            }
          }
        }
      }
      t += Math.max(35 * 60_000, expo(rng, 4 * DAY));
    }
  }

  // Events whose load happens after the scenario clock have not "arrived" yet: they wait in
  // ingest.events_pending until the learner triggers an EL sync (incremental-model exercises).
  const scenarioNow = Date.UTC(2026, 6, 1, 8, 30);
  const loadedMs = (r: RawTable['rows'][number]) => Date.parse(String(r[8]).replace(' ', 'T') + 'Z');
  const pendingEventRows = eventRows.filter((r) => loadedMs(r) > scenarioNow);
  const arrivedEventRows = eventRows.filter((r) => loadedMs(r) <= scenarioNow);

  // ---------------------------------------------------------------- fx + spend
  const fxRows: RawTable['rows'] = [];
  const level: Record<string, number> = {};
  for (const c of Object.keys(CCY)) level[c] = CCY[c as Ccy].fx;
  for (let d = Date.UTC(2024, 11, 30); d <= DATA_END; d += DAY) {
    const dow = new Date(d).getUTCDay();
    for (const c of ['EUR', 'GBP', 'SEK', 'CAD', 'AUD']) {
      level[c] = level[c] * (1 + (rng() - 0.5) * 0.008);
      if (dow === 0 || dow === 6) continue;
      fxRows.push([date(d), c, Number(level[c].toFixed(5))]);
    }
  }

  const spendRows: RawTable['rows'] = [];
  for (let d = DATA_START; d <= DATA_END; d += DAY) {
    const growth = 1 + (d - DATA_START) / (DATA_END - DATA_START);
    spendRows.push([date(d), 'paid_search', Number((180 * growth * (0.75 + rng() * 0.5)).toFixed(2))]);
    spendRows.push([date(d), 'paid_social', Number((140 * growth * (0.7 + rng() * 0.6)).toFixed(2))]);
    if (new Date(d).getUTCDate() === 1) spendRows.push([date(d), 'partner', Number((1500 + rng() * 800).toFixed(2))]);
  }

  // ---------------------------------------------------------------- assemble
  const productRows: RawTable['rows'] = PRODUCTS.map(([id, name, cat, price, launched]) => [id, name, cat, price, launched]);

  return {
    tables: [
      {
        name: 'customers',
        description: 'Customer records from the shop backend, replicated via CDC: one row per change, so a customer can appear several times.',
        columns: [
          { name: 'id', type: 'INTEGER', description: 'Customer id (not unique in this table — CDC history).' },
          { name: 'first_name', type: 'VARCHAR', description: '' },
          { name: 'last_name', type: 'VARCHAR', description: '' },
          { name: 'email', type: 'VARCHAR', description: 'Raw email as typed — inconsistent casing / whitespace.' },
          { name: 'country', type: 'VARCHAR', description: 'ISO-2 country code; sometimes null.' },
          { name: 'signup_source', type: 'VARCHAR', description: 'Acquisition channel captured at signup.' },
          { name: 'created_at', type: 'TIMESTAMP', description: '' },
          { name: 'updated_at', type: 'TIMESTAMP', description: 'When this version of the record was written.' },
          { name: '_loaded_at', type: 'TIMESTAMP', description: 'When the EL tool loaded the row.' },
        ],
        rows: customerRows,
      },
      {
        name: 'orders',
        description: 'Orders from the shop backend. The EL connector occasionally re-delivers rows.',
        columns: [
          { name: 'id', type: 'INTEGER', description: 'Order id.' },
          { name: 'customer_id', type: 'INTEGER', description: '' },
          { name: 'ordered_at', type: 'TIMESTAMP', description: 'UTC.' },
          { name: 'status', type: 'VARCHAR', description: 'placed | shipped | completed | returned | cancelled' },
          { name: 'currency', type: 'VARCHAR', description: 'ISO currency of all *_cents amounts on the order.' },
          { name: 'shipping_cents', type: 'INTEGER', description: '' },
          { name: 'discount_code', type: 'VARCHAR', description: '' },
          { name: 'discount_cents', type: 'INTEGER', description: '' },
          { name: '_loaded_at', type: 'TIMESTAMP', description: '' },
        ],
        rows: orderRows,
      },
      {
        name: 'order_items',
        description: 'Order lines. Prices are in the order currency.',
        columns: [
          { name: 'id', type: 'INTEGER', description: '' },
          { name: 'order_id', type: 'INTEGER', description: '' },
          { name: 'product_id', type: 'INTEGER', description: '' },
          { name: 'quantity', type: 'INTEGER', description: '' },
          { name: 'unit_price_cents', type: 'INTEGER', description: 'Local currency.' },
        ],
        rows: itemRows,
      },
      {
        name: 'products',
        description: 'Product catalogue.',
        columns: [
          { name: 'id', type: 'INTEGER', description: '' },
          { name: 'name', type: 'VARCHAR', description: '' },
          { name: 'category', type: 'VARCHAR', description: 'coffee | equipment | merch | gift_card' },
          { name: 'price_usd_cents', type: 'INTEGER', description: 'US list price.' },
          { name: 'launched_at', type: 'DATE', description: '' },
        ],
        rows: productRows,
      },
      {
        name: 'payments',
        description: 'Payment attempts from the PSP. Failed attempts and refunds are separate rows.',
        columns: [
          { name: 'id', type: 'INTEGER', description: '' },
          { name: 'order_id', type: 'INTEGER', description: '' },
          { name: 'payment_method', type: 'VARCHAR', description: 'card | paypal | bank_transfer | gift_card' },
          { name: 'status', type: 'VARCHAR', description: 'success | failed | refunded' },
          { name: 'amount_cents', type: 'INTEGER', description: 'Order currency.' },
          { name: 'created_at', type: 'TIMESTAMP', description: '' },
        ],
        rows: paymentRows,
      },
      {
        name: 'subscriptions',
        description: 'Coffee subscriptions. amount_cents is per billing period (month or year).',
        columns: [
          { name: 'id', type: 'INTEGER', description: '' },
          { name: 'customer_id', type: 'INTEGER', description: '' },
          { name: 'plan', type: 'VARCHAR', description: 'monthly | annual' },
          { name: 'amount_cents', type: 'INTEGER', description: 'Price per billing period, local currency.' },
          { name: 'currency', type: 'VARCHAR', description: '' },
          { name: 'started_at', type: 'DATE', description: '' },
          { name: 'cancelled_at', type: 'DATE', description: 'Null while active.' },
        ],
        rows: subRows,
      },
      {
        name: 'events',
        description: 'Web/app tracking events (Segment-style) for Apr–Jun 2026.',
        columns: EVENT_COLUMNS,
        rows: arrivedEventRows,
      },
      {
        name: 'events_pending',
        schema: 'ingest',
        description: 'Events the EL tool will deliver on its next sync (not visible to models until then).',
        columns: EVENT_COLUMNS,
        rows: pendingEventRows,
      },
      {
        name: 'fx_rates',
        description: 'Daily FX rates from the finance team — business days only, no USD row.',
        columns: [
          { name: 'rate_date', type: 'DATE', description: '' },
          { name: 'currency', type: 'VARCHAR', description: '' },
          { name: 'usd_per_unit', type: 'DOUBLE', description: 'How many USD one unit of the currency buys.' },
        ],
        rows: fxRows,
      },
      {
        name: 'marketing_spend',
        description: 'Paid marketing spend by channel and day (partner fees booked on the 1st).',
        columns: [
          { name: 'spend_date', type: 'DATE', description: '' },
          { name: 'channel', type: 'VARCHAR', description: 'paid_search | paid_social | partner' },
          { name: 'spend_usd', type: 'DOUBLE', description: '' },
        ],
        rows: spendRows,
      },
    ],
  };
}

const EVENT_COLUMNS: RawTable['columns'] = [
  { name: 'event_id', type: 'VARCHAR', description: '' },
  { name: 'anonymous_id', type: 'VARCHAR', description: 'Device/browser id.' },
  { name: 'user_id', type: 'INTEGER', description: 'Customer id — only populated after the visitor logs in.' },
  { name: 'event_name', type: 'VARCHAR', description: 'page_view | login | product_viewed | add_to_cart | checkout_started | order_completed' },
  { name: 'event_ts', type: 'TIMESTAMP', description: 'Client timestamp (UTC).' },
  { name: 'page_path', type: 'VARCHAR', description: '' },
  { name: 'utm_source', type: 'VARCHAR', description: 'Only on the first event of a session.' },
  { name: 'device', type: 'VARCHAR', description: 'mobile | desktop' },
  { name: '_loaded_at', type: 'TIMESTAMP', description: 'Mobile events can arrive days late.' },
];

function statusFor(rng: Rng, at: number): string {
  if (at > DATA_END - 3 * DAY) return weighted(rng, [['placed', 60], ['shipped', 40]] as const);
  if (at > DATA_END - 8 * DAY) return weighted(rng, [['shipped', 55], ['completed', 40], ['cancelled', 5]] as const);
  return weighted(rng, [['completed', 88], ['returned', 5], ['cancelled', 7]] as const);
}

/** Serialise a table to CSV for DuckDB's read_csv. */
export function toCsv(t: RawTable): string {
  const esc = (v: string | number | boolean | null) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [t.columns.map((c) => c.name).join(','), ...t.rows.map((r) => r.map(esc).join(','))].join('\n');
}
