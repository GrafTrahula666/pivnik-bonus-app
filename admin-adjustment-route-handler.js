function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

/**
 * HTTP adapter for the legacy /api/admin/users/:id/adjust contract.
 *
 * Financial mutation is deliberately delegated to the shared atomic executor.
 * This module owns only request normalization plus the historical response
 * shape so server.js can be rewired without duplicating wallet/journal logic.
 */
export function createAdminAdjustmentRouteHandler({
  normalizeRequestKey,
  executeAdjustment
} = {}) {
  requireFunction(normalizeRequestKey, 'normalizeRequestKey');
  requireFunction(executeAdjustment, 'executeAdjustment');

  return async function adminAdjustmentRouteHandler(req, res, next) {
    const amount = Math.trunc(Number(req.body?.amount || 0));
    const reason = String(req.body?.reason || '').trim();
    const requestKey = normalizeRequestKey(req.body?.requestKey);

    if (!amount || !reason) {
      return res.status(400).json({ error: 'Укажите сумму и причину.' });
    }
    if (!requestKey) {
      return res.status(400).json({ error: 'Некорректный requestKey корректировки.' });
    }

    try {
      const result = await executeAdjustment({
        customerId: req.params.id,
        actorId: req.user.id,
        amount,
        reason,
        requestKey
      });

      if (result.replayed) {
        return res.json({
          ok: true,
          balance: Number(result.balanceAfter || 0),
          replayed: true
        });
      }

      return res.json({
        ok: true,
        balance: Number(result.balanceAfter || 0)
      });
    } catch (error) {
      if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      if (error instanceof TypeError) {
        // The shared executor is stricter than the historical route about
        // unsafe/non-finite integers. Treat malformed input as a client error
        // instead of allowing it to become a 500 or reach wallet arithmetic.
        return res.status(400).json({ error: 'Укажите корректную целую сумму.' });
      }
      return next(error);
    }
  };
}

export const adminAdjustmentRouteHandlerContract = Object.freeze({
  route: '/api/admin/users/:id/adjust',
  preservesLegacySuccessShape: true,
  preservesLegacyReplayShape: true,
  preservesLegacyValidationMessages: true,
  delegatesFinancialMutation: true,
  rejectsUnsafeAmountAsClientError: true,
  ownsTransactions: false,
  productionRouteWired: false
});
