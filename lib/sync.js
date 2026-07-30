// WP-ACADEMY-2: platform sync bridge (academy side).
// On shop creation (owner signup) and member join/approval, the academy tells
// the HAB platform by POSTing to:
//   {PLATFORM_SYNC_URL}/api/integrations/academy/events
//   header X-HAB-SYNC-SECRET: {PLATFORM_SYNC_SECRET}
// Delivery must NEVER block or fail a signup, so every event is written to
// the sync_queue outbox first and delivered asynchronously. If the env vars
// are unset or the POST fails, the row stays 'pending' and is retried on
// every boot and hourly after that.
import db from './db.js';

const RETRY_MS = 60 * 60 * 1000; // hourly
const TIMEOUT_MS = 8000;

const configured = () => Boolean(process.env.PLATFORM_SYNC_URL && process.env.PLATFORM_SYNC_SECRET);
const endpoint = () =>
  `${String(process.env.PLATFORM_SYNC_URL).replace(/\/$/, '')}/api/integrations/academy/events`;

export const SyncQueue = {
  enqueue: (eventType, payload) =>
    db.prepare(`INSERT INTO sync_queue (event_type, payload_json) VALUES (?, ?)`)
      .run(eventType, JSON.stringify(payload)).lastInsertRowid,
  pending: (limit = 50) =>
    db.prepare(`SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY id LIMIT ?`).all(limit),
  markSent: (id) =>
    db.prepare(`UPDATE sync_queue SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?`).run(id),
  markFailed: (id, err) =>
    db.prepare(`UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?`)
      .run(String(err).slice(0, 500), id),
  counts: () => {
    const out = { pending: 0, sent: 0 };
    for (const r of db.prepare(`SELECT status, COUNT(*) AS c FROM sync_queue GROUP BY status`).all()) out[r.status] = r.c;
    return out;
  },
};

async function deliver(payload) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-HAB-SYNC-SECRET': process.env.PLATFORM_SYNC_SECRET,
      },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } finally {
    clearTimeout(t);
  }
}

let flushing = false;
export async function flushSyncQueue() {
  if (flushing) return;                       // no overlapping flushes
  if (!configured()) return;                  // nothing to do until env is set
  flushing = true;
  try {
    for (const row of SyncQueue.pending()) {
      try {
        await deliver(JSON.parse(row.payload_json));
        SyncQueue.markSent(row.id);
        console.log(`[sync] delivered ${row.event_type} event #${row.id}`);
      } catch (e) {
        SyncQueue.markFailed(row.id, e.message);
        console.warn(`[sync] event #${row.id} (${row.event_type}) failed: ${e.message} — will retry`);
      }
    }
  } finally {
    flushing = false;
  }
}

// Enqueue + immediately attempt delivery in the background. Fire-and-forget:
// the caller's request never waits on the network.
function emit(eventType, payload) {
  try {
    SyncQueue.enqueue(eventType, payload);
  } catch (e) {
    console.error(`[sync] could not enqueue ${eventType}: ${e.message}`);
    return;
  }
  if (!configured()) {
    console.log(`[sync] ${eventType} queued (PLATFORM_SYNC_URL not configured)`);
    return;
  }
  setImmediate(() => flushSyncQueue().catch(e => console.error('[sync] flush error:', e.message)));
}

export function emitShopCreated({ name, org, owner_name, owner_email, address, phone, tier, term_months, join_code }) {
  emit('shop_created', {
    type: 'shop_created',
    shop: {
      name, org: org ?? null,
      owner_name, owner_email,
      address: address ?? null, phone: phone ?? null,
      tier, term_months, join_code,
    },
  });
}

export function emitMemberJoined({ shop_name, name, email, role }) {
  emit('member_joined', {
    type: 'member_joined',
    shop_name,
    user: { name, email, role },
  });
}

// Boot retry + hourly retry. Called once from server.js.
export function startSyncScheduler() {
  setImmediate(() => flushSyncQueue().catch(e => console.error('[sync] boot flush error:', e.message)));
  const timer = setInterval(
    () => flushSyncQueue().catch(e => console.error('[sync] retry error:', e.message)),
    RETRY_MS
  );
  timer.unref?.();
  if (!configured()) {
    console.log('[sync] platform sync bridge idle — set PLATFORM_SYNC_URL and PLATFORM_SYNC_SECRET to enable delivery (events still queue).');
  }
}
