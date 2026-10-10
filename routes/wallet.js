export function registerWalletRoutes(app, {
  authRequired,
  appleWalletIssuerUrl,
  googleWalletIssuerUrl
}) {
  app.get('/api/wallet/config', authRequired, async (_req, res) => {
    res.json({
      appleAvailable: Boolean(appleWalletIssuerUrl),
      googleAvailable: Boolean(googleWalletIssuerUrl),
      fallbackAvailable: true
    });
  });

  app.get('/api/wallet/apple', authRequired, async (req, res) => {
    if (!appleWalletIssuerUrl) return res.status(503).json({ error: 'Apple Wallet ещё не подключён владельцем.' });
    const url = new URL(appleWalletIssuerUrl);
    url.searchParams.set('user', req.user.id);
    url.searchParams.set('token', req.user.qrShortCode || '');
    res.json({ url: url.toString() });
  });

  app.get('/api/wallet/google', authRequired, async (req, res) => {
    if (!googleWalletIssuerUrl) return res.status(503).json({ error: 'Google Wallet ещё не подключён владельцем.' });
    const url = new URL(googleWalletIssuerUrl);
    url.searchParams.set('user', req.user.id);
    url.searchParams.set('token', req.user.qrShortCode || '');
    res.json({ url: url.toString() });
  });
}
