import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('admin dashboard reads only real journal/profile aggregates for V1 KPIs', async () => {
  const server = await read('server.js');

  assert.match(server, /AS new_clients_7d/);
  assert.match(server, /AS active_clients_30d/);
  assert.match(server, /AS inactive_clients_30d/);
  assert.match(server, /AS redeemed/);
  assert.match(server, /AS yesterday_check_cents/);
  assert.match(server, /AS lifetime_check_cents/);
  assert.match(server, /status='completed'/);
  assert.match(server, /deleted_at IS NULL/);
  assert.match(server, /WITH tx_metrics AS/);
  assert.match(server, /completed_activity AS/);
  assert.match(server, /LEFT JOIN completed_activity activity ON activity\.client_id = u\.id/);
  assert.match(server, /WHERE activity\.last_completed_at >= NOW\(\) - INTERVAL '30 days'/);
  assert.match(server, /WHERE activity\.last_completed_at < NOW\(\) - INTERVAL '30 days'/);
  assert.match(server, /FROM user_metrics\s+CROSS JOIN tx_metrics/);
  assert.doesNotMatch(server, /\(SELECT COUNT\(DISTINCT client_id\)::int FROM transactions/);

  assert.match(server, /newClients7d:/);
  assert.match(server, /activeClients30d:/);
  assert.match(server, /inactiveClients30d:/);
  assert.match(server, /yesterdayCheck:/);
  assert.match(server, /lifetimeCheck:/);
});

test('admin V1 exposes real KPI cards and honest AI state', async () => {
  const [html, app] = await Promise.all([read('index.html'), read('app.js')]);

  for (const id of [
    'metricClients',
    'metricNewClients',
    'metricActiveClients',
    'metricInactiveClients',
    'metricToday',
    'metricTodayDelta',
    'metricLifetimeCheck',
    'metricIssued',
    'metricRedeemed',
    'metricSuspicious',
    'metricCancelled'
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  assert.match(app, /summary\.newClients7d/);
  assert.match(app, /summary\.activeClients30d/);
  assert.match(app, /summary\.inactiveClients30d/);
  assert.match(app, /summary\.yesterdayCheck/);
  assert.match(app, /summary\.lifetimeCheck/);
  assert.match(app, /summary\.todayCompletedOperations/);
  assert.match(app, /summary\.yesterdayCompletedOperations/);
  assert.match(app, /summary\.todayAverageCheck/);
  assert.match(app, /summary\.yesterdayAverageCheck/);
  assert.match(app, /salesDelta/);
  assert.match(app, /averageCheckDelta/);
  assert.match(app, /выручка .*продажи .*ср\. чек/s);
  assert.match(app, /нет базы сравнения/);

  assert.match(html, /id="adminAiCard"/);
  assert.match(html, /AI-анализ/);
  assert.match(html, /НЕ ПОДКЛЮЧЁН/);
  assert.match(html, /данные клиентов не отправляются во внешнюю AI-модель/i);
  assert.doesNotMatch(html, /AI (?:наш[её]л|увеличил|повысил).*[+]?\d+%/i);
});

test('admin navigation has explicit CRM, content, broadcast and AI tabs without a new stylesheet', async () => {
  const [tabs, surfaces, html] = await Promise.all([
    read('red-cosmos-v2.js'),
    read('black-frosted-surfaces.css'),
    read('index.html')
  ]);

  assert.match(tabs, /\['dashboard', 'Обзор'\]/);
  assert.match(tabs, /\['users', 'CRM'\]/);
  assert.match(tabs, /\['content', 'Контент'\]/);
  assert.match(tabs, /\['broadcast', 'Рассылки'\]/);
  assert.match(tabs, /\['ai', 'AI'\]/);
  assert.match(tabs, /adminBroadcastCard/);
  assert.match(tabs, /adminAiCard/);

  assert.match(html, /id="adminBroadcastCard"/);
  assert.match(html, /id="openBroadcastFromTab"/);
  assert.match(surfaces, /\.red-cosmos-admin-tab\.active/);
  assert.match(surfaces, /\.admin-ai-grid/);
  assert.match(surfaces, /rgba\(92,74,210,.25\)/);

  assert.doesNotMatch(html, /admin-dashboard-v1\.css/);
  assert.doesNotMatch(tabs, /admin-dashboard-v1\.css/);
});
