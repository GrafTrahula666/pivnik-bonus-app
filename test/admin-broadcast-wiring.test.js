import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('admin broadcast backend is admin-only and supports Telegram plus VK', () => {
  const server = read('server.js');
  assert.match(server, /app\.get\('\/api\/admin\/broadcast\/preview',[\s\S]*?requireRole\('admin'\)/);
  assert.match(server, /app\.post\('\/api\/admin\/broadcast',[\s\S]*?requireRole\('admin'\)/);
  assert.match(server, /BROADCAST_MAX_TEXT = 3000/);
  assert.match(server, /BROADCAST_MAX_RECIPIENTS = 500/);
  assert.match(server, /api\.telegram\.org\/bot\$\{botToken\}\/sendMessage/);
  assert.match(server, /TELEGRAM_BROADCAST_MAX_RETRY_AFTER_SECONDS = 15/);
  assert.match(server, /payload\?\.parameters\?\.retry_after/);
  assert.match(server, /response\.status === 429/);
  assert.match(server, /retryAttempt < 1/);
  assert.match(server, /sendTelegramMessage\(telegramId, text, retryAttempt \+ 1\)/);
  assert.doesNotMatch(server, /allow_paid_broadcast/);
  assert.match(server, /createBroadcastCampaignStore/);
  assert.match(server, /broadcastCampaignStore\.ensureSchema/);
  assert.match(server, /broadcastCampaignStore\.claim/);
  assert.match(server, /broadcastCampaignStore\.complete/);
  assert.match(server, /broadcastCampaignStore\.fail/);
  assert.match(server, /deduplicated: true/);
  assert.match(server, /Повторная отправка заблокирована/);
  assert.match(server, /api\.vk\.com\/method\/messages\.send/);
  assert.match(server, /VK_COMMUNITY_TOKEN/);
  assert.match(server, /random_id/);
});

test('owner UI exposes preview, confirmation and delivery result', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.match(html, /id="openBroadcastAdmin"/);
  assert.match(html, /id="broadcastModal"/);
  assert.match(html, /id="broadcastMessage"[^>]*maxlength="3000"/);
  assert.match(app, /async function loadBroadcastPreview\(\)/);
  assert.match(app, /async function sendAdminBroadcast\(\)/);
  assert.match(app, /window\.confirm\(/);
  assert.match(app, /Telegram: доставлено/);
  assert.match(app, /VK: доставлено/);
});

test('VK promotional messaging permission is requested only from an explicit settings action', () => {
  const app = read('app.js');
  const vk = read('vk-platform.js');
  assert.match(app, /saveNotifications[\s\S]*saveNotificationPreferences/);
  assert.match(app, /__PIVNIK_VK_REQUEST_COMMUNITY_MESSAGES__/);
  assert.match(vk, /VKWebAppAllowMessagesFromGroup/);
  assert.match(vk, /group_id: groupId/);
});

test('VK broadcast secrets are environment-only', () => {
  const env = read('.env.example');
  const server = read('server.js');
  assert.match(env, /^VK_COMMUNITY_ID=$/m);
  assert.match(env, /^VK_COMMUNITY_TOKEN=$/m);
  assert.match(env, /^VK_API_VERSION=5\.199$/m);
  assert.doesNotMatch(server, /VK_COMMUNITY_TOKEN\s*=\s*['"][^'"]+['"]/);
});

test('promotional broadcasts require explicit server-side consent', () => {
  const server = read('server.js');
  const html = read('index.html');
  const app = read('app.js');
  assert.match(server, /marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(server, /app\.post\('\/api\/me\/marketing-consent'/);
  assert.match(server, /AND u\.marketing_opt_in = TRUE/);
  assert.match(server, /MARKETING_CONSENT_VERSION/);
  assert.match(app, /promotions: false/);
  assert.match(app, /\/api\/me\/marketing-consent/);
  assert.match(app, /config\?\.marketingOptIn === true/);
  assert.match(html, /согласие на рекламную рассылку/);
  assert.doesNotMatch(html, /id="notifyPromotions"[^>]*checked/);
});
