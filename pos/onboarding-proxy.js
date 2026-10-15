import crypto from 'node:crypto';

export const POS_ONBOARDING_PROTOCOL = 'pivnik-pos-proxy-v2';
export const POS_DEVICE_KEY_PATTERN = /^pvpos_[A-Za-z0-9_-]{43}$/;
export const POS_EVENT_FRESH_MS = 5 * 60_000;
export const POS_SYNC_FRESH_MS = 15 * 60_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = () => Object.assign(new Error('Прокси не подтвердил устройство и область заведения.'), { code: 'proxy_response_invalid' });
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const canonical = packet => ({
  protocol:packet.protocol,challenge:packet.challenge,observedAt:packet.observedAt,
  runtime:{key:packet.runtime.key,checksum:packet.runtime.checksum,companyId:packet.runtime.companyId,venueId:packet.runtime.venueId,status:packet.runtime.status},
  device:{id:packet.device.id,externalId:packet.device.externalId,storeId:packet.device.storeId},
  lastEvent:packet.lastEvent?{id:packet.lastEvent.id,receivedAt:packet.lastEvent.receivedAt}:null,
  provider:{state:packet.provider.state,lastSuccessAt:packet.provider.lastSuccessAt},
  report:{state:packet.report.state,empty:packet.report.empty,period:packet.report.period?{from:packet.report.period.from,until:packet.report.period.until}:null},
});

export function signPosOnboardingPacket(packet, key) {
  if (!POS_DEVICE_KEY_PATTERN.test(key)) throw fail();
  return crypto.createHmac('sha256', key).update('spaceverse-pos-status-v2\0')
    .update(JSON.stringify(canonical(packet))).digest('base64url');
}

// No driver/provider text, URL or key is included in this wire contract.
export function verifyPosOnboardingPacket(raw, key, expected, now = Date.now()) {
  if (!exact(raw, ['protocol','challenge','observedAt','runtime','device','lastEvent','provider','report','mac'])
    || raw.protocol !== POS_ONBOARDING_PROTOCOL || !uuid.test(raw.challenge) || raw.challenge !== expected.challenge
    || !date(raw.observedAt) || Math.abs(now - Date.parse(raw.observedAt)) > 30_000
    || !exact(raw.runtime, ['key','checksum','companyId','venueId','status'])
    || raw.runtime.key !== expected.runtimeKey || raw.runtime.checksum !== expected.checksum
    || raw.runtime.companyId !== expected.companyId || raw.runtime.venueId !== expected.venueId
    || raw.runtime.status !== 'not_provisioned'
    || !exact(raw.device, ['id','externalId','storeId']) || !uuid.test(raw.device.id)
    || raw.device.externalId !== expected.terminalId || raw.device.storeId !== expected.storeId
    || !exact(raw.provider, ['state','lastSuccessAt'])
    || !['not_connected','schema_required','error','syncing','connected','awaiting_sync'].includes(raw.provider.state)
    || !(raw.provider.lastSuccessAt === null || date(raw.provider.lastSuccessAt))
    || !(raw.lastEvent === null || (exact(raw.lastEvent, ['id','receivedAt']) && uuid.test(raw.lastEvent.id)
      && date(raw.lastEvent.receivedAt) && Date.parse(raw.lastEvent.receivedAt) <= Date.parse(raw.observedAt) + 2000))
    || !exact(raw.report, ['state','empty','period']) || !['available','unavailable'].includes(raw.report.state)
    || typeof raw.mac !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw.mac)) throw fail();
  if (raw.report.state === 'available') {
    if (typeof raw.report.empty !== 'boolean' || raw.provider.state !== 'connected'
      || !date(raw.provider.lastSuccessAt) || now - Date.parse(raw.provider.lastSuccessAt) > POS_SYNC_FRESH_MS
      || Date.parse(raw.provider.lastSuccessAt) > Date.parse(raw.observedAt) + 2000
      || !exact(raw.report.period, ['from','until']) || !date(raw.report.period.from) || !date(raw.report.period.until)
      || Date.parse(raw.report.period.until) - Date.parse(raw.report.period.from) !== 86400_000
      || Date.parse(raw.report.period.until) > Date.parse(raw.observedAt) + 2000
      || now - Date.parse(raw.report.period.until) > POS_SYNC_FRESH_MS) throw fail();
  } else if (raw.report.empty !== null || raw.report.period !== null) throw fail();
  const { mac, ...packet } = raw;
  const computed = signPosOnboardingPacket(packet, key);
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(computed))) throw fail();
  return packet;
}
