import crypto from 'node:crypto';

const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PAIR_CODE_PATTERN = /^BAR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
export const DEVICE_TOKEN_PREFIX = 'pvkdev_';
export const BOOTSTRAP_TOKEN_PREFIX = 'pvkboot_';

export function normalizePairCode(value) {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = compact.startsWith('BAR') ? compact.slice(3) : compact;
  if (body.length !== 8) return '';
  const code = `BAR-${body.slice(0, 4)}-${body.slice(4)}`;
  return PAIR_CODE_PATTERN.test(code) ? code : '';
}

export function createPairCode(randomInt = crypto.randomInt) {
  const chars = Array.from({ length: 8 }, () => PAIR_ALPHABET[randomInt(0, PAIR_ALPHABET.length)]).join('');
  return `BAR-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export function createOpaqueToken(prefix, randomBytes = crypto.randomBytes) {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

export function createDeviceToken(randomBytes = crypto.randomBytes) {
  return createOpaqueToken(DEVICE_TOKEN_PREFIX, randomBytes);
}

export function createBootstrapToken(randomBytes = crypto.randomBytes) {
  return createOpaqueToken(BOOTSTRAP_TOKEN_PREFIX, randomBytes);
}

export function hashDeviceSecret(value, pepper) {
  const secret = Buffer.isBuffer(pepper) ? pepper : Buffer.from(String(pepper || ''));
  if (!secret.length) throw new Error('device auth pepper is required');
  return crypto.createHmac('sha256', secret).update(String(value || '')).digest('hex');
}

export function normalizeDeviceLabel(value) {
  const label = String(value || '').trim().replace(/\s+/g, ' ');
  return label.slice(0, 80) || 'Барный терминал';
}

export function parseDeviceAuthorization(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('Device ')) return '';
  const token = raw.slice(7).trim();
  return token.startsWith(DEVICE_TOKEN_PREFIX) && token.length >= 40 ? token : '';
}

export function safePublicDevice(device) {
  if (!device) return null;
  return {
    id: String(device.id),
    publicId: device.public_id || device.publicId,
    label: device.label,
    userId: String(device.user_id || device.userId),
    role: device.role || 'staff',
    pairedAt: device.paired_at || device.pairedAt || null,
    lastSeenAt: device.last_seen_at || device.lastSeenAt || null,
    revokedAt: device.revoked_at || device.revokedAt || null
  };
}
