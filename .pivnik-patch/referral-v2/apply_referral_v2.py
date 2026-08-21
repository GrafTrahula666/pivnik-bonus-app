#!/usr/bin/env python3
from pathlib import Path
import argparse
import shutil
import sys

PATCH_ROOT = Path(__file__).resolve().parent

def replace_once(path: Path, old: str, new: str, label: str):
    text = path.read_text(encoding="utf-8")
    if new in text:
        print(f"[skip] {label}")
        return
    if old not in text:
        raise RuntimeError(f"Anchor not found for {label}: {path}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"[ok]   {label}")

def append_once(path: Path, marker: str, content: str, label: str):
    text = path.read_text(encoding="utf-8")
    if marker in text:
        print(f"[skip] {label}")
        return
    path.write_text(text.rstrip() + "\n\n" + content.strip() + "\n", encoding="utf-8")
    print(f"[ok]   {label}")

def copy_file(src: Path, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    print(f"[ok]   add {dst.relative_to(dst.parents[1] if len(dst.parents) > 1 else dst.parent)}")

def main():
    parser = argparse.ArgumentParser(description="Apply Pivnik referral v2 / Raise Shields patch.")
    parser.add_argument("repo", nargs="?", default=".", help="Path to GrafTrahula666/pivnik-bonus-app")
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    required = ["package.json", "server.js", "universal-server.js", "achievements.js", "app.js", "index.html", "styles.css", "migrations", "test"]
    missing = [name for name in required if not (repo / name).exists()]
    if missing:
        raise SystemExit(f"Not a pivnik-bonus-app checkout. Missing: {', '.join(missing)}")

    # New source-of-truth referral engine + migration + integration tests.
    copy_file(PATCH_ROOT / "referrals.js", repo / "referrals.js")
    copy_file(PATCH_ROOT / "migrations" / "008_referral_v2.sql", repo / "migrations" / "008_referral_v2.sql")
    copy_file(PATCH_ROOT / "test" / "referrals.integration.test.js", repo / "test" / "referrals.integration.test.js")

    achievements = repo / "achievements.js"

    replace_once(
        achievements,
        """    code: 'active-beta-participant',
    title: 'За активное участие в бета-тесте',
    description: 'Уникальная благодарность двум Telegram-пользователям, активно участвовавшим в бета-тестировании приложения.',
    condition: 'Активно участвовать в бета-тестировании приложения.',
    rarity: 'legendary',
    type: 'unique',
    icon: 'beta-active',
    target: 1,
    rewardBonus: 1000,
    automatic: false""",
        """    code: 'active-beta-participant',
    title: 'Поднять щиты',
    description: 'Выдано самым активным участникам бета-теста за помощь в проверке и доработке приложения на раннем этапе.',
    condition: 'Выдано самым активным участникам бета-теста за помощь в проверке и доработке приложения на раннем этапе.',
    rarity: 'legendary',
    type: 'unique',
    icon: 'beta-active',
    target: 1,
    rewardBonus: 1000,
    automatic: false""",
        "achievement title/description"
    )

    replace_once(
        achievements,
        """        AND LOWER(REGEXP_REPLACE(COALESCE(u.username, ''), '^@+', '')) = $1::text
        AND (u.telegram_id IS NOT NULL OR ui.provider_user_id IS NOT NULL)""",
        """        AND (
          LOWER(REGEXP_REPLACE(COALESCE(u.username, ''), '^@+', '')) = $1::text
          OR LOWER(REGEXP_REPLACE(COALESCE(ui.provider_username, ''), '^@+', '')) = $1::text
        )
        AND (u.telegram_id IS NOT NULL OR ui.provider_user_id IS NOT NULL)""",
        "Telegram username resolver includes user_identities"
    )

    old_ledger = """    const verificationIds = batchAlreadyCompleted ? [] : activeBetaUserIds;
    const activeBetaLedger = await client.query(
      `SELECT
         COUNT(*)::integer AS grant_count,
         COUNT(DISTINCT user_id)::integer AS user_count,
         COALESCE(SUM(amount), 0)::bigint AS grant_amount,
         COUNT(*) FILTER (
           WHERE user_id = ANY($1::bigint[])
         )::integer AS intended_count
       FROM reward_grants
       WHERE source = 'achievement'
         AND achievement_code = 'active-beta-participant'`,
      [verificationIds]
    );
    const activeBetaTransactions = await client.query(
      `SELECT
         COUNT(*)::integer AS transaction_count,
         COUNT(DISTINCT client_id)::integer AS user_count,
         COALESCE(SUM(bonus_earned), 0)::bigint AS transaction_amount,
         COUNT(*) FILTER (
           WHERE client_id = ANY($1::bigint[])
         )::integer AS intended_count
       FROM transactions
       WHERE status = 'completed'
         AND reward_code = 'achievement:active-beta-participant'`,
      [verificationIds]
    );
    const grantCheck = activeBetaLedger.rows[0] || {};
    const transactionCheck = activeBetaTransactions.rows[0] || {};
    const grantCount = number(grantCheck.grant_count);
    const validGrantRecipients = batchAlreadyCompleted
      ? grantCount <= expectedRecipients
        && number(grantCheck.user_count) === grantCount
        && number(grantCheck.grant_amount) === grantCount * rewardPerUser
      : grantCount === expectedRecipients
        && number(grantCheck.user_count) === expectedRecipients
        && number(grantCheck.grant_amount) === expectedRecipients * rewardPerUser
        && number(grantCheck.intended_count) === expectedRecipients;
    const validActiveBetaLedger = (
      validGrantRecipients
      && number(transactionCheck.transaction_count) === expectedRecipients
      && number(transactionCheck.user_count) === expectedRecipients
      && number(transactionCheck.transaction_amount) === expectedRecipients * rewardPerUser
      && (batchAlreadyCompleted || number(transactionCheck.intended_count) === expectedRecipients)
    );
    if (!validActiveBetaLedger) {
      throw new Error('Журнал уникального beta-достижения не прошёл проверку идемпотентности.');
    }"""

    new_ledger = """    const verificationIds = batchAlreadyCompleted ? [] : activeBetaUserIds;
    const additionalActiveBetaUsername = normalizeTelegramUsername(
      options.additionalActiveBetaTesterTelegramUsername || 'KSEMAR'
    );
    const additionalActiveBetaUserId = additionalActiveBetaUsername
      ? await resolveTelegramAchievementUser(client, additionalActiveBetaUsername)
      : null;
    const ownerActiveBetaUserId = ownerId || null;
    const extraActiveBetaUserIds = [...new Set(
      [ownerActiveBetaUserId, additionalActiveBetaUserId].filter(Boolean)
    )];

    const activeBetaLedger = await client.query(
      `SELECT
         COUNT(*)::integer AS grant_count,
         COUNT(DISTINCT user_id)::integer AS user_count,
         COALESCE(SUM(amount), 0)::bigint AS grant_amount,
         COUNT(*) FILTER (
           WHERE user_id = ANY($1::bigint[])
         )::integer AS intended_count,
         COUNT(*) FILTER (
           WHERE user_id = ANY($2::bigint[])
         )::integer AS extra_count
       FROM reward_grants
       WHERE source = 'achievement'
         AND achievement_code = 'active-beta-participant'`,
      [verificationIds, extraActiveBetaUserIds]
    );
    const activeBetaTransactions = await client.query(
      `SELECT
         COUNT(*)::integer AS transaction_count,
         COUNT(DISTINCT client_id)::integer AS user_count,
         COALESCE(SUM(bonus_earned), 0)::bigint AS transaction_amount,
         COUNT(*) FILTER (
           WHERE client_id = ANY($1::bigint[])
         )::integer AS intended_count,
         COUNT(*) FILTER (
           WHERE client_id = ANY($2::bigint[])
         )::integer AS extra_count
       FROM transactions
       WHERE status = 'completed'
         AND reward_code = 'achievement:active-beta-participant'`,
      [verificationIds, extraActiveBetaUserIds]
    );
    const grantCheck = activeBetaLedger.rows[0] || {};
    const transactionCheck = activeBetaTransactions.rows[0] || {};
    const grantCount = number(grantCheck.grant_count);
    const extraGrantCount = number(grantCheck.extra_count);
    const transactionCount = number(transactionCheck.transaction_count);
    const extraTransactionCount = number(transactionCheck.extra_count);
    const batchGrantCount = grantCount - extraGrantCount;
    const batchTransactionCount = transactionCount - extraTransactionCount;

    const validGrantRecipients = (
      (batchAlreadyCompleted ? batchGrantCount <= expectedRecipients : batchGrantCount === expectedRecipients)
      && number(grantCheck.user_count) === grantCount
      && number(grantCheck.grant_amount) === grantCount * rewardPerUser
      && extraGrantCount <= extraActiveBetaUserIds.length
      && (batchAlreadyCompleted || number(grantCheck.intended_count) === expectedRecipients)
    );
    const validActiveBetaLedger = (
      validGrantRecipients
      && batchTransactionCount === expectedRecipients
      && number(transactionCheck.user_count) === transactionCount
      && number(transactionCheck.transaction_amount) === transactionCount * rewardPerUser
      && extraTransactionCount <= extraActiveBetaUserIds.length
      && (batchAlreadyCompleted || number(transactionCheck.intended_count) === expectedRecipients)
    );
    if (!validActiveBetaLedger) {
      throw new Error('Журнал уникального beta-достижения не прошёл проверку идемпотентности.');
    }

    let activeBetaOwnerGranted = 0;
    let activeBetaAdditionalGranted = 0;
    for (const [kind, userId] of [
      ['owner', ownerActiveBetaUserId],
      ['additional', additionalActiveBetaUserId]
    ]) {
      if (!userId) continue;
      await client.query(
        `SELECT id
         FROM users
         WHERE id = $1::bigint
           AND merged_into_user_id IS NULL
           AND deleted_at IS NULL
         FOR UPDATE`,
        [userId]
      );
      await ensureUserRewardAccounts(client, userId);
      if (await awardAchievement(
        client,
        userId,
        definitionByCode('active-beta-participant')
      )) {
        if (kind === 'owner') activeBetaOwnerGranted = 1;
        if (kind === 'additional') activeBetaAdditionalGranted = 1;
      }
    }"""
    replace_once(achievements, old_ledger, new_ledger, "KSEMAR idempotent beta grant and ledger validation")

    replace_once(
        achievements,
        """      activeBetaGranted,
      activeBetaLedgerCount: number(grantCheck.grant_count),""",
        """      activeBetaGranted,
      activeBetaOwnerResolved: Boolean(ownerActiveBetaUserId),
      activeBetaOwnerGranted,
      activeBetaAdditionalResolved: Boolean(additionalActiveBetaUserId),
      activeBetaAdditionalGranted,
      activeBetaLedgerCount: number(grantCheck.grant_count) + activeBetaOwnerGranted + activeBetaAdditionalGranted,""",
        "achievement initialization result includes KSEMAR"
    )
    replace_once(
        achievements,
        """      activeBetaLedgerAmount: number(grantCheck.grant_amount),
      activeBetaTransactionCount: number(transactionCheck.transaction_count),
      activeBetaTransactionAmount: number(transactionCheck.transaction_amount)""",
        """      activeBetaLedgerAmount: number(grantCheck.grant_amount) + (activeBetaOwnerGranted + activeBetaAdditionalGranted) * rewardPerUser,
      activeBetaTransactionCount: number(transactionCheck.transaction_count) + activeBetaOwnerGranted + activeBetaAdditionalGranted,
      activeBetaTransactionAmount: number(transactionCheck.transaction_amount) + (activeBetaOwnerGranted + activeBetaAdditionalGranted) * rewardPerUser""",
        "achievement initialization totals include KSEMAR"
    )

    achievement_test = repo / "test" / "achievements.integration.test.js"
    replace_once(
        achievement_test,
        """  assert.equal(
    ACHIEVEMENT_CATALOG.find((item) => item.code === 'active-beta-participant')?.rewardBonus,
    1000
  );""",
        """  const raiseShields = ACHIEVEMENT_CATALOG.find((item) => item.code === 'active-beta-participant');
  assert.equal(raiseShields?.title, 'Поднять щиты');
  assert.equal(
    raiseShields?.description,
    'Выдано самым активным участникам бета-теста за помощь в проверке и доработке приложения на раннем этапе.'
  );
  assert.equal(raiseShields?.rarity, 'legendary');
  assert.equal(raiseShields?.type, 'unique');
  assert.equal(raiseShields?.rewardBonus, 1000);""",
        "achievement catalog test for Raise Shields"
    )
    replace_once(
        achievement_test,
        """        provider_user_id TEXT NOT NULL,
        PRIMARY KEY (provider, provider_user_id),""",
        """        provider_user_id TEXT NOT NULL,
        provider_username TEXT,
        PRIMARY KEY (provider, provider_user_id),""",
        "achievement test Telegram identity username column"
    )
    replace_once(
        achievement_test,
        """    for (const [telegramId, username, firstName, frame] of [
      [9001, 'DrolTed', 'Первый тестировщик', 'anna'],
      [9002, 'distraktor', 'Второй тестировщик', 'olesya'],
      [9003, 'not-selected-beta', 'Другой участник', 'vladislav'],
      [9004, 'owner', 'Создатель', 'money']
    ]) {""",
        """    for (const [telegramId, username, firstName, frame, providerUsername = username] of [
      [9001, 'DrolTed', 'Первый тестировщик', 'anna'],
      [9002, 'distraktor', 'Второй тестировщик', 'olesya'],
      [9003, 'not-selected-beta', 'Другой участник', 'vladislav'],
      [9004, 'owner', 'Создатель', 'money'],
      [9005, null, 'Дополнительный тестировщик', 'none', 'KSEMAR']
    ]) {""",
        "achievement test includes KSEMAR existing Telegram account"
    )
    replace_once(
        achievement_test,
        """        `INSERT INTO user_identities (user_id, provider, provider_user_id)
         VALUES ($1, 'telegram', $2)`,
        [userId, String(telegramId)]""",
        """        `INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username)
         VALUES ($1, 'telegram', $2, $3)`,
        [userId, String(telegramId), providerUsername]""",
        "achievement test stores Telegram provider username"
    )
    replace_once(
        achievement_test,
        """    assert.equal(first.activeBetaLedgerCount, 2);
    assert.equal(first.activeBetaLedgerAmount, 2000);
    assert.equal(first.activeBetaTransactionCount, 2);
    assert.equal(first.activeBetaTransactionAmount, 2000);
    assert.equal(second.activeBetaGranted, 0);
    assert.equal(second.activeBetaLedgerCount, 2);
    assert.equal(second.activeBetaLedgerAmount, 2000);
    assert.equal(second.activeBetaTransactionCount, 2);
    assert.equal(second.activeBetaTransactionAmount, 2000);""",
        """    assert.equal(first.activeBetaOwnerResolved, true);
    assert.equal(first.activeBetaOwnerGranted, 1);
    assert.equal(first.activeBetaAdditionalResolved, true);
    assert.equal(first.activeBetaAdditionalGranted, 1);
    assert.equal(first.activeBetaLedgerCount, 4);
    assert.equal(first.activeBetaLedgerAmount, 4000);
    assert.equal(first.activeBetaTransactionCount, 4);
    assert.equal(first.activeBetaTransactionAmount, 4000);
    assert.equal(second.activeBetaGranted, 0);
    assert.equal(second.activeBetaOwnerResolved, true);
    assert.equal(second.activeBetaOwnerGranted, 0);
    assert.equal(second.activeBetaAdditionalResolved, true);
    assert.equal(second.activeBetaAdditionalGranted, 0);
    assert.equal(second.activeBetaLedgerCount, 4);
    assert.equal(second.activeBetaLedgerAmount, 4000);
    assert.equal(second.activeBetaTransactionCount, 4);
    assert.equal(second.activeBetaTransactionAmount, 4000);""",
        "achievement test validates one-time KSEMAR reward"
    )
    replace_once(
        achievement_test,
        """    assert.equal(Number(activeGrants.rows[0].count), 2);
    assert.equal(Number(activeGrants.rows[0].amount), 2000);""",
        """    assert.equal(Number(activeGrants.rows[0].count), 4);
    assert.equal(Number(activeGrants.rows[0].amount), 4000);""",
        "achievement test active grant total includes KSEMAR"
    )
    replace_once(
        achievement_test,
        """    assert.equal(Number(activeLedger.rows[0].count), 2);""",
        """    assert.equal(Number(activeLedger.rows[0].count), 4);
    const ownerWallet = await db.query(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [users[3]]
    );
    assert.equal(Number(ownerWallet.rows[0].balance), 1000);
    const ksemarWallet = await db.query(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [users[4]]
    );
    assert.equal(Number(ksemarWallet.rows[0].balance), 1000);""",
        "achievement test KSEMAR wallet/history"
    )
    replace_once(
        achievement_test,
        """    assert.equal(afterDeletion.activeBetaLedgerCount, 1);
    assert.equal(afterDeletion.activeBetaLedgerAmount, 1000);""",
        """    assert.equal(afterDeletion.activeBetaLedgerCount, 3);
    assert.equal(afterDeletion.activeBetaLedgerAmount, 3000);
    const ksemarAfterRestart = await db.query(
      `SELECT w.balance,
              COUNT(rg.*)::integer AS grants
       FROM wallets w
       LEFT JOIN reward_grants rg
         ON rg.user_id = w.user_id
        AND rg.achievement_code = 'active-beta-participant'
       WHERE w.user_id = $1
       GROUP BY w.balance`,
      [users[4]]
    );
    assert.equal(Number(ksemarAfterRestart.rows[0].balance), 1000);
    assert.equal(Number(ksemarAfterRestart.rows[0].grants), 1);""",
        "achievement test KSEMAR remains idempotent after restart"
    )

    server = repo / "server.js"
    replace_once(
        server,
        """} from './achievements.js';
import {""",
        """} from './achievements.js';
import { reconcileReferral } from './referrals.js';
import {""",
        "server referral import"
    )
    replace_once(
        server,
        """  { code: 'referral-beta', title: 'Пригласить друга', description: 'Реферальная программа пока недоступна.', badge: 'Скоро', active: false, sortOrder: 30 }""",
        """  { code: 'referral-beta', title: 'Пригласить друга', description: 'Пригласи друга — получишь 100 бонусов. Друг получит 50 бонусов. Ему нужно ввести твой код в первый день после регистрации и за следующие 3 дня купить в Пивнике в общей сложности на 500 ₽.', badge: '100 Б + 50 Б', active: true, sortOrder: 30 }""",
        "default referral promotion"
    )
    replace_once(
        server,
        """await client.query("ALTER TABLE transactions ADD CONSTRAINT transactions_mode_check CHECK (mode IN ('accrue','redeem','adjustment','beer_gift','welcome','shop','achievement'))");""",
        """await client.query("ALTER TABLE transactions ADD CONSTRAINT transactions_mode_check CHECK (mode IN ('accrue','redeem','adjustment','beer_gift','welcome','shop','achievement','referral'))");""",
        "transactions referral mode constraint"
    )
    replace_once(
        server,
        """if (mode && ['accrue','redeem','adjustment','beer_gift','welcome','shop'].includes(mode)) { params.push(mode); where.push(`t.mode = $${params.length}`); }""",
        """if (mode && ['accrue','redeem','adjustment','beer_gift','welcome','shop','achievement','referral'].includes(mode)) { params.push(mode); where.push(`t.mode = $${params.length}`); }""",
        "admin transaction filter includes achievement/referral"
    )
    replace_once(
        server,
        """      await client.query('COMMIT');
      await syncUserAchievements(pool, existing.rows[0].client_id);
      return res.json({""",
        """      await client.query('COMMIT');
      await syncUserAchievements(pool, existing.rows[0].client_id);
      await reconcileReferral(pool, existing.rows[0].client_id).catch((error) => {
        console.error('Referral reconciliation after replayed purchase failed:', error?.code || error?.message || 'unknown');
      });
      return res.json({""",
        "reconcile replayed real purchase"
    )
    replace_once(
        server,
        """    await client.query('COMMIT');
    await syncUserAchievements(pool, targetUser.id);
    const tx = txResult.rows[0];""",
        """    await client.query('COMMIT');
    await syncUserAchievements(pool, targetUser.id);
    await reconcileReferral(pool, targetUser.id).catch((error) => {
      console.error('Referral reconciliation after purchase failed:', error?.code || error?.message || 'unknown');
    });
    const tx = txResult.rows[0];""",
        "reconcile completed real purchase"
    )
    replace_once(
        server,
        """    await client.query('COMMIT');
    const profile = await getProfile(tx.client_id);
    if (!tx.__idempotentReplay) await sendTelegramMessage(profile.telegramId, `Операция в баре «Пивник» отменена.""",
        """    await client.query('COMMIT');
    await reconcileReferral(pool, tx.client_id).catch((error) => {
      console.error('Referral reconciliation after staff cancellation failed:', error?.code || error?.message || 'unknown');
    });
    const profile = await getProfile(tx.client_id);
    if (!tx.__idempotentReplay) await sendTelegramMessage(profile.telegramId, `Операция в баре «Пивник» отменена.""",
        "reconcile staff cancellation"
    )
    replace_once(
        server,
        """    await client.query('COMMIT');
    const profile = await getProfile(tx.client_id);
    if (!tx.__idempotentReplay) await sendTelegramMessage(profile.telegramId, `Операция в баре «Пивник» отменена владельцем.""",
        """    await client.query('COMMIT');
    await reconcileReferral(pool, tx.client_id).catch((error) => {
      console.error('Referral reconciliation after admin cancellation failed:', error?.code || error?.message || 'unknown');
    });
    const profile = await getProfile(tx.client_id);
    if (!tx.__idempotentReplay) await sendTelegramMessage(profile.telegramId, `Операция в баре «Пивник» отменена владельцем.""",
        "reconcile admin cancellation"
    )

    package = repo / "package.json"
    replace_once(
        package,
        """node --check achievements.js && node --check server.js && node --check universal-server.js""",
        """node --check achievements.js && node --check referrals.js && node --check server.js && node --check universal-server.js""",
        "package check includes referrals"
    )

    universal = repo / "universal-server.js"
    replace_once(
        universal,
        """} from './achievements.js';
import {""",
        """} from './achievements.js';
import {
  applyReferralCode,
  expireOverdueReferrals,
  getReferralOverview,
  reconcileReferral
} from './referrals.js';
import {""",
        "gateway referral import"
    )

    replace_once(
        universal,
        """      await client.query('COMMIT');
      await ensureSupplementalRecords(userId);
      return { token, ...(await getAppPayload(userId, provider, { startup: true })) };""",
        """      await client.query('COMMIT');
      await ensureSupplementalRecords(userId);
      await reconcileReferral(pool, userId).catch((error) => {
        console.error('Referral reconciliation after auth failed:', error?.code || error?.message || 'unknown');
      });
      return { token, ...(await getAppPayload(userId, provider, { startup: true })) };""",
        "reconcile referral after auth"
    )

    referral_routes_anchor = """    if (req.method === 'GET' && url.pathname === '/api/achievements') {"""
    referral_routes = """    if (req.method === 'GET' && url.pathname === '/api/me/referral') {
      const user = await requireGatewayUser(req);
      platformFromRequest(req, user.payload.platform || 'unknown');
      if (!user.termsAccepted) {
        return sendJson(res, 428, { error: 'Сначала примите правила программы.' });
      }
      return sendJson(res, 200, await getReferralOverview(pool, user.id));
    }

    if (req.method === 'POST' && url.pathname === '/api/me/referral/apply') {
      const user = await requireGatewayUser(req);
      platformFromRequest(req, user.payload.platform || 'unknown');
      if (!user.termsAccepted) {
        return sendJson(res, 428, { error: 'Сначала примите правила программы.' });
      }
      enforceRateLimit(
        `referral-apply:${user.id}:${requestAddress(req)}`,
        12,
        15 * 60 * 1000
      );
      const body = parseJsonBody(await readRequestBody(req));
      await applyReferralCode(pool, user.id, body.code);
      return sendJson(res, 200, await getReferralOverview(pool, user.id));
    }

    if (req.method === 'GET' && url.pathname === '/api/achievements') {"""
    replace_once(universal, referral_routes_anchor, referral_routes, "referral gateway API routes")

    replace_once(
        universal,
        """      `Achievement ledger is ready: active beta ${achievementInitialization.activeBetaResolved}, new grants ${achievementInitialization.activeBetaGranted}, deferred ${achievementInitialization.deferred}.`""",
        """      `Achievement ledger is ready: active beta ${achievementInitialization.activeBetaResolved}, new grants ${achievementInitialization.activeBetaGranted}, owner shield ${Boolean(achievementInitialization.activeBetaOwnerResolved)}, owner new grant ${achievementInitialization.activeBetaOwnerGranted || 0}, KSEMAR resolved ${Boolean(achievementInitialization.activeBetaAdditionalResolved)}, KSEMAR new grant ${achievementInitialization.activeBetaAdditionalGranted || 0}, deferred ${achievementInitialization.deferred}.`""",
        "startup KSEMAR audit log"
    )
    replace_once(
        universal,
        """      await initPlatformDatabase();
      await refreshDatabaseFingerprint();""",
        """      await initPlatformDatabase();
      await refreshDatabaseFingerprint();
      const referralExpiryTimer = setInterval(() => {
        void expireOverdueReferrals(pool).catch((error) => {
          console.error('Referral expiry reconciliation failed:', error?.code || error?.message || 'unknown');
        });
      }, 5 * 60 * 1000);
      referralExpiryTimer.unref();""",
        "periodic referral expiry/reconciliation"
    )

    app = repo / "app.js"
    replace_once(
        app,
        """const APP_VERSION = '20.0-achievement-ledger';""",
        """const APP_VERSION = '21.0-referral-v2';""",
        "client version"
    )
    replace_once(
        app,
        """  if (item.icon === 'beta-active' || item.code === 'active-beta-participant') return '<span class="beta-achievement-icon">★</span>';""",
        """  if (item.icon === 'beta-active' || item.code === 'active-beta-participant') return '<img class="raise-shields-art" src="/assets/achievements/raise-shields.webp?v=1" alt="Поднять щиты">';""",
        "Raise Shields achievement artwork"
    )
    replace_once(
        app,
        """const telegramInitDataFromUrl = readTelegramLaunchData();
let telegramBridgeInitialized = false;""",
        """const telegramInitDataFromUrl = readTelegramLaunchData();
const referralLaunchCode = readReferralLaunchCode();
let telegramBridgeInitialized = false;""",
        "read launch referral"
    )
    replace_once(
        app,
        """function refreshTelegramBridge() {""",
        """function readReferralLaunchCode() {
  const values = [];
  for (const rawParams of [location.hash.slice(1), location.search.slice(1)]) {
    if (!rawParams) continue;
    try {
      const params = new URLSearchParams(rawParams);
      for (const key of ['ref', 'referral', 'startapp', 'start_param', 'tgWebAppStartParam']) {
        if (params.get(key)) values.push(params.get(key));
      }
    } catch (_) {}
  }
  const telegramStartParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  if (telegramStartParam) values.push(telegramStartParam);

  for (const raw of values) {
    const match = String(raw || '').toUpperCase().match(/PVK-[A-Z2-9]{8}/);
    if (match) return match[0];
  }
  return '';
}

function refreshTelegramBridge() {""",
        "launch referral parser"
    )
    replace_once(
        app,
        """  transactions: [],
  historyTab: 'purchases',
  bootSecondaryStarted: false,""",
        """  transactions: [],
  historyTab: 'purchases',
  referral: null,
  referralLoading: false,
  bootSecondaryStarted: false,""",
        "referral client state"
    )

    referral_client_code = r"""
function formatReferralRemaining(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  if (days > 0) return `Осталось: ${days} ${days === 1 ? 'день' : 'дн.'} ${hours} ч.`;
  return `Осталось: ${hours} ч.`;
}

function referralShareUrl(code) {
  const url = new URL(IS_VK ? '/vk' : '/', location.origin);
  url.searchParams.set('ref', code);
  return url.toString();
}

function renderReferral() {
  const data = state.referral;
  if (!data) return;

  if ($('#referralOwnCode')) $('#referralOwnCode').textContent = data.ownCode || '—';
  if ($('#referralInvitedCount')) $('#referralInvitedCount').textContent = fmt(data.inviterStats?.invited || 0);
  if ($('#referralRewardedCount')) $('#referralRewardedCount').textContent = fmt(data.inviterStats?.rewarded || 0);
  if ($('#referralMonthlyCount')) {
    $('#referralMonthlyCount').textContent =
      `${fmt(data.inviterStats?.rewardedThisMonth || 0)} / ${fmt(data.inviterStats?.monthlyRewardLimit || 10)}`;
  }

  const canApply = Boolean(data.registrationWindow?.canApply);
  const linked = Boolean(data.referral?.linked);
  $('#referralApplyBlock')?.classList.toggle('hidden', linked || !canApply);
  $('#referralWindowClosed')?.classList.toggle('hidden', linked || canApply);

  const progress = $('#referralProgress');
  const done = $('#referralDone');
  const expired = $('#referralExpired');
  progress?.classList.toggle('hidden', !linked || data.referral.completed || data.referral.expired);
  done?.classList.toggle('hidden', !data.referral?.completed);
  expired?.classList.toggle('hidden', !data.referral?.expired);

  if (linked && $('#referralProgressAmount')) {
    $('#referralProgressAmount').textContent =
      `Покупки: ${fmt(Number(data.referral.purchasesCents || 0) / 100)} / ${fmt(Number(data.referral.targetCents || 50000) / 100)} ₽`;
  }
  if (linked && $('#referralProgressRemaining')) {
    $('#referralProgressRemaining').textContent =
      formatReferralRemaining(data.referral.remainingSeconds);
  }
}

async function loadReferral() {
  const data = await api('/api/me/referral', { retries: 1, timeoutMs: 7000 });
  state.referral = data;
  renderReferral();
  return data;
}

async function applyReferralCodeFromUi(code, { silent = false } = {}) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) {
    if (!silent) toast('Введите referral-код');
    return null;
  }
  const data = await api('/api/me/referral/apply', {
    method: 'POST',
    body: JSON.stringify({ code: normalized }),
    retries: 0,
    timeoutMs: 7000
  });
  state.referral = data;
  renderReferral();
  if (!silent) toast('Referral-код применён');
  return data;
}

async function applyLaunchReferral() {
  const launchCode = referralLaunchCode || readReferralLaunchCode();
  if (!launchCode || !state.token) return;
  try {
    await applyReferralCodeFromUi(launchCode, { silent: true });
  } catch (error) {
    // Deep-link must never cause a popup on every launch. 24h/duplicate/self
    // constraints remain server-side and are intentionally only logged here.
    console.warn('Referral deep-link was not applied:', error?.status || error?.message || 'unknown');
  }
}

async function openReferral() {
  openModal('referralModal');
  if (!state.referralLoading) {
    state.referralLoading = true;
    try { await loadReferral(); }
    finally { state.referralLoading = false; }
  }
}
""".strip()

    replace_once(
        app,
        """async function refreshMe() {""",
        referral_client_code + "\n\nasync function refreshMe() {",
        "referral client UI functions"
    )

    replace_once(
        app,
        """  const jobs = [loadCurrentShift(), loadPromotions(), loadCatalog(), loadLeaderboard(), loadAchievements(), loadShopContact(), loadWalletConfig()];""",
        """  const jobs = [loadCurrentShift(), loadPromotions(), loadCatalog(), loadLeaderboard(), loadAchievements(), loadShopContact(), loadWalletConfig(), loadReferral()];""",
        "preload referral overview"
    )
    replace_once(
        app,
        """    $('#bootText').textContent = 'Открываем профиль…';
    renderCoreProfile();""",
        """    $('#bootText').textContent = 'Открываем профиль…';
    await applyLaunchReferral();
    renderCoreProfile();""",
        "silent deep-link apply during boot"
    )
    replace_once(
        app,
        """    achievement: ['Достижение', '◆']""",
        """    achievement: ['Достижение', '◆'],
    referral: ['Пригласи друга', '↗']""",
        "referral transaction label"
    )
    replace_once(
        app,
        """  } else if (transaction.mode === 'adjustment') {""",
        """  } else if (transaction.mode === 'referral') {
    primary = `+${transaction.bonusEarned} Б`;
    detail = publicReleaseLabel(transaction.reason) || 'Referral-награда';
  } else if (transaction.mode === 'adjustment') {""",
        "referral transaction history detail"
    )
    replace_once(
        app,
        """  if (tab === 'rewards') return ['beer_gift', 'shop', 'achievement'].includes(transaction.mode);""",
        """  if (tab === 'rewards') return ['beer_gift', 'shop', 'achievement', 'referral'].includes(transaction.mode);""",
        "referral reward history tab"
    )
    replace_once(
        app,
        """      : transaction.mode === 'welcome' ? 'Приветственный бонус'
        : transaction.mode === 'redeem' ? 'Списание'
          : transaction.mode === 'adjustment' ? 'Корректировка' : 'Начисление';""",
        """      : transaction.mode === 'welcome' ? 'Приветственный бонус'
        : transaction.mode === 'referral' ? 'Referral-награда'
          : transaction.mode === 'achievement' ? 'Достижение'
            : transaction.mode === 'redeem' ? 'Списание'
              : transaction.mode === 'adjustment' ? 'Корректировка' : 'Начисление';""",
        "admin history labels referral reward"
    )
    replace_once(
        app,
        """$('#openConnectedServices')?.addEventListener('click', openConnectedServices);
$('#openNotifications')?.addEventListener('click', () => { renderNotificationPreferences(); openModal('notificationsModal'); });""",
        """$('#openConnectedServices')?.addEventListener('click', openConnectedServices);
$('#openReferral')?.addEventListener('click', () => openReferral().catch((error) => toast(error.message)));
$('#copyReferralCode')?.addEventListener('click', async () => {
  const code = state.referral?.ownCode || $('#referralOwnCode')?.textContent || '';
  try { await navigator.clipboard.writeText(code); toast('Referral-код скопирован'); }
  catch (_) { toast(`Код: ${code}`); }
});
$('#copyReferralLink')?.addEventListener('click', async () => {
  const code = state.referral?.ownCode || $('#referralOwnCode')?.textContent || '';
  if (!code || code === '—') return;
  const link = referralShareUrl(code);
  try { await navigator.clipboard.writeText(link); toast('Referral-ссылка скопирована'); }
  catch (_) { toast(link); }
});
$('#applyReferralCode')?.addEventListener('click', () => {
  applyReferralCodeFromUi($('#referralCodeInput')?.value || '').catch((error) => toast(error.message));
});
$('#openNotifications')?.addEventListener('click', () => { renderNotificationPreferences(); openModal('notificationsModal'); });""",
        "referral profile event handlers"
    )

    html = repo / "index.html"
    replace_once(
        html,
        """          <button type="button" id="openConnectedServices"><span>↔</span><div><b>Telegram и VK</b><small id="profileServicesValue">Подключён текущий сервис</small></div><i>›</i></button>
          <button type="button" id="openNotifications"><span>◉</span><div><b>Уведомления</b><small>Награды, бонусы и важные новости</small></div><i>›</i></button>""",
        """          <button type="button" id="openConnectedServices"><span>↔</span><div><b>Telegram и VK</b><small id="profileServicesValue">Подключён текущий сервис</small></div><i>›</i></button>
          <button type="button" id="openReferral"><span>↗</span><div><b>Пригласить друга</b><small>100 Б вам · 50 Б другу</small></div><i>›</i></button>
          <button type="button" id="openNotifications"><span>◉</span><div><b>Уведомления</b><small>Награды, бонусы и важные новости</small></div><i>›</i></button>""",
        "profile referral menu item"
    )

    referral_modal = r"""
  <div class="modal" id="referralModal" aria-hidden="true">
    <div class="modal-sheet tall-sheet premium-sheet referral-sheet">
      <button class="close" data-close="referralModal">×</button>
      <span class="muted">Профиль</span>
      <h2>Пригласить друга</h2>
      <p class="help-intro referral-copy">Пригласи друга — получишь 100 бонусов. Друг получит 50 бонусов. Ему нужно ввести твой код в первый день после регистрации и за следующие 3 дня купить в Пивнике в общей сложности на 500 ₽.</p>

      <div class="referral-code-card">
        <small>Ваш код</small>
        <strong id="referralOwnCode">—</strong>
        <div class="referral-actions">
          <button type="button" class="secondary" id="copyReferralCode">Скопировать код</button>
          <button type="button" class="secondary" id="copyReferralLink">Скопировать ссылку</button>
        </div>
      </div>

      <div class="referral-inviter-stats">
        <div><small>Приглашено</small><strong id="referralInvitedCount">0</strong></div>
        <div><small>Выполнили условие</small><strong id="referralRewardedCount">0</strong></div>
        <div><small>Наград в этом месяце</small><strong id="referralMonthlyCount">0 / 10</strong></div>
      </div>

      <div id="referralApplyBlock" class="referral-apply hidden">
        <label for="referralCodeInput">Код друга</label>
        <div class="referral-input-row">
          <input id="referralCodeInput" type="text" maxlength="16" autocomplete="off" autocapitalize="characters" placeholder="PVK-XXXXXXXX">
          <button type="button" class="primary" id="applyReferralCode">Применить</button>
        </div>
        <small>Код можно применить только в первые 24 часа после регистрации.</small>
      </div>

      <div id="referralWindowClosed" class="referral-status-card hidden">
        <strong>Срок ввода кода завершён</strong>
        <small>После первых 24 часов пригласившего изменить или привязать нельзя.</small>
      </div>

      <div id="referralProgress" class="referral-status-card hidden">
        <strong id="referralProgressAmount">Покупки: 0 / 500 ₽</strong>
        <small id="referralProgressRemaining">Осталось: —</small>
      </div>

      <div id="referralDone" class="referral-status-card referral-done hidden">
        <strong>Условие выполнено — награды начислены</strong>
      </div>

      <div id="referralExpired" class="referral-status-card hidden">
        <strong>Срок выполнения условия завершён</strong>
        <small>Покупки после окончания трёхдневного окна не учитываются.</small>
      </div>
    </div>
  </div>
""".rstrip()

    replace_once(
        html,
        """  <div class="modal" id="notificationsModal" aria-hidden="true">""",
        referral_modal + "\n  <div class=\"modal\" id=\"notificationsModal\" aria-hidden=\"true\">",
        "referral modal"
    )

    css = repo / "styles.css"
    referral_css = r"""
/* REFERRAL_V2_UI */
.referral-sheet {
  overflow: auto;
}
.referral-copy {
  line-height: 1.55;
}
.referral-code-card,
.referral-status-card,
.referral-apply {
  margin-top: 14px;
  padding: 16px;
  border: 1px solid rgba(255,255,255,.10);
  border-radius: 18px;
  background: rgba(37, 8, 16, .42);
  backdrop-filter: blur(16px);
}
.referral-code-card > small,
.referral-apply > small,
.referral-status-card > small {
  display: block;
  margin-top: 7px;
  opacity: .72;
}
.referral-code-card > strong {
  display: block;
  margin-top: 7px;
  font-size: 24px;
  letter-spacing: .08em;
}
.referral-actions,
.referral-input-row {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
.referral-actions > *,
.referral-input-row > * {
  min-width: 0;
  flex: 1;
}
.referral-input-row input {
  width: 100%;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.referral-status-card strong {
  display: block;
  line-height: 1.35;
}
.referral-inviter-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 14px;
}
.referral-inviter-stats > div {
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(255,255,255,.10);
  border-radius: 14px;
  background: rgba(37, 8, 16, .34);
}
.referral-inviter-stats small {
  display: block;
  min-height: 24px;
  font-size: 9px;
  line-height: 1.25;
  opacity: .72;
}
.referral-inviter-stats strong {
  display: block;
  margin-top: 4px;
  font-size: 16px;
}
.referral-done {
  border-color: rgba(255,255,255,.22);
}
@media (max-width: 390px) {
  .referral-actions,
  .referral-input-row {
    flex-direction: column;
  }
}
"""
    append_once(css, "/* REFERRAL_V2_UI */", referral_css, "referral styles")

    raise_shields_css = r"""
/* RAISE_SHIELDS_ART */
.raise-shields-art {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}
.achievement-tile-icon:has(.raise-shields-art),
.achievement-details-icon:has(.raise-shields-art),
.achievement-celebration-icon:has(.raise-shields-art) {
  overflow: hidden;
  padding: 0;
  background: rgba(0,0,0,.18);
}
"""
    append_once(css, "/* RAISE_SHIELDS_ART */", raise_shields_css, "Raise Shields artwork styles")

    print("\nPatch applied. Next run:")
    print("  npm test")
    print("  npm run check")
    print("  git diff --check")
    print("  git diff")

if __name__ == "__main__":
    main()
