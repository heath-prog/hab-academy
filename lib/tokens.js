// Secure random token generation for invites.
import { randomBytes } from 'node:crypto';

export function newInviteToken() {
  return randomBytes(24).toString('base64url');
}

export function newShopCode() {
  // 8-char readable code, no ambiguous chars (no 0/O, 1/I)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function expiresIn(days = 7) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
