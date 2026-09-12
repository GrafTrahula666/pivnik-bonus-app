import { parseDeviceAuthorization } from './device-auth-core.js';

export function registerDeviceAuthRoutes({
  app,
  enabled,
  persistence,
  authRequired,
  requireRole,
  signSession,
  getProfile,
  loadPublicDesign,
  publicStatuses
}) {
  if (!enabled) return { registered: false };
  if (!app?.post || !app?.get) throw new Error('device auth express app is required');
  if (!persistence) throw new Error('device auth persistence is required');
  if (typeof authRequired !== 'function' || typeof requireRole !== 'function') throw new Error('device auth admin middleware is required');
  if (typeof signSession !== 'function' || typeof getProfile !== 'function') throw new Error('device auth session dependencies are required');

  app.post('/api/device/pair', async (req, res, next) => {
    try {
      const result = await persistence.pairDevice({ code: req.body?.code, label: req.body?.label });
      res.status(201).json({
        deviceToken: result.token,
        device: result.device
      });
    } catch (error) { next(error); }
  });

  app.post('/api/device/bootstrap', async (req, res, next) => {
    try {
      const deviceToken = parseDeviceAuthorization(req.headers.authorization);
      if (!deviceToken) return res.status(401).json({ error: 'Требуется ключ барного устройства.' });
      const result = await persistence.createBootstrap({ deviceToken });
      res.json({
        bootstrapCode: result.code,
        expiresAt: result.expiresAt,
        device: result.device
      });
    } catch (error) { next(error); }
  });

  app.post('/api/device/session', async (req, res, next) => {
    try {
      const result = await persistence.exchangeBootstrap(req.body?.bootstrapCode);
      const token = signSession({
        uid: result.userId,
        platform: 'kiosk',
        pid: result.device.publicId,
        sv: result.sessionVersion,
        exp: Date.now() + 16 * 60 * 60 * 1000
      });
      const profile = await getProfile(result.userId);
      if (!profile || profile.role !== 'staff') {
        return res.status(403).json({ error: 'Барное устройство потеряло роль сотрудника.' });
      }
      const design = typeof loadPublicDesign === 'function' ? await loadPublicDesign() : null;
      const statuses = typeof publicStatuses === 'function' ? publicStatuses() : [];
      res.json({ token, profile, statuses, design, device: result.device, kiosk: true });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/devices/pairing-code', authRequired, requireRole('admin'), async (req, res, next) => {
    try {
      const result = await persistence.createPairingCode({
        adminUserId: req.user.id,
        label: req.body?.label,
        ttlMs: req.body?.ttlMs
      });
      res.status(201).json({
        code: result.code,
        label: result.label,
        expiresAt: result.expires_at,
        createdAt: result.created_at
      });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/devices', authRequired, requireRole('admin'), async (_req, res, next) => {
    try { res.json({ devices: await persistence.listDevices() }); }
    catch (error) { next(error); }
  });

  app.post('/api/admin/devices/:id/revoke', authRequired, requireRole('admin'), async (req, res, next) => {
    try {
      const device = await persistence.revokeDevice({ deviceId: req.params.id, adminUserId: req.user.id });
      res.json({ ok: true, device });
    } catch (error) { next(error); }
  });

  return { registered: true };
}
