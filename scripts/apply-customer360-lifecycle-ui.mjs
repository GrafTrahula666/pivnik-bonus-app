import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appPath = path.join(root, 'app.js');
const indexPath = path.join(root, 'index.html');
let source = fs.readFileSync(appPath, 'utf8');
let html = fs.readFileSync(indexPath, 'utf8');
let changed = false;

const marker = 'const CUSTOMER360_LIFECYCLE_LABELS = {';
if (!source.includes(marker)) {
  const modeAnchor = `function customer360ModeLabel(mode) {\n  return ({\n    accrue: 'Покупка · начисление',\n    redeem: 'Покупка · списание',\n    adjustment: 'Ручная корректировка',\n    beer_reward: 'Пивная награда',\n    gift: 'Подарок'\n  })[mode] || mode || 'Операция';\n}\n`;
  const lifecycleHelpers = `${modeAnchor}\nconst CUSTOMER360_LIFECYCLE_LABELS = {\n  new: 'Новый клиент',\n  active: 'Активный',\n  at_risk: 'В зоне риска',\n  sleeping: 'Спящий',\n  no_visits: 'Без визитов',\n  unknown: 'Статус неизвестен'\n};\n\nfunction customer360LifecycleLabel(lifecycle) {\n  const status = lifecycle?.status || 'unknown';\n  return CUSTOMER360_LIFECYCLE_LABELS[status] || CUSTOMER360_LIFECYCLE_LABELS.unknown;\n}\n\nfunction customer360LifecycleDetail(lifecycle) {\n  if (!lifecycle) return 'Недостаточно данных';\n  if (Number.isFinite(lifecycle.daysSinceLastVisit)) {\n    return lifecycle.daysSinceLastVisit === 0\n      ? 'Был сегодня'\n      : \`Последний визит \${fmt(lifecycle.daysSinceLastVisit)} дн. назад\`;\n  }\n  if (lifecycle.status === 'new') return 'Зарегистрирован недавно · визитов пока нет';\n  if (lifecycle.status === 'no_visits') return 'Завершённых визитов пока нет';\n  return 'Недостаточно данных';\n}\n`;
  if (!source.includes(modeAnchor)) throw new Error('Customer 360 mode anchor not found');
  source = source.replace(modeAnchor, lifecycleHelpers);

  const subtitleAnchor = `  subtitle.textContent = [\n    customer?.username ? \`@\${customer.username}\` : '',\n    customer?.telegramId ? \`Telegram \${customer.telegramId}\` : '',\n    \`ID \${customer?.id || '—'}\`\n  ].filter(Boolean).join(' · ');\n`;
  const subtitleReplacement = `  const lifecycle = customer?.lifecycle || { status: 'unknown' };\n  subtitle.textContent = [\n    customer360LifecycleLabel(lifecycle),\n    customer360LifecycleDetail(lifecycle),\n    customer?.username ? \`@\${customer.username}\` : '',\n    customer?.telegramId ? \`Telegram \${customer.telegramId}\` : '',\n    \`ID \${customer?.id || '—'}\`\n  ].filter(Boolean).join(' · ');\n`;
  if (!source.includes(subtitleAnchor)) throw new Error('Customer 360 subtitle anchor not found');
  source = source.replace(subtitleAnchor, subtitleReplacement);

  const factsAnchor = `  const factItems = [\n    ['Последний визит', customer360Date(metrics.lastVisitAt, true)],\n`;
  const factsReplacement = `  const factItems = [\n    ['Статус клиента', customer360LifecycleLabel(lifecycle)],\n    ['Последний визит', customer360Date(metrics.lastVisitAt, true)],\n`;
  if (!source.includes(factsAnchor)) throw new Error('Customer 360 facts anchor not found');
  source = source.replace(factsAnchor, factsReplacement);
  changed = true;
}

const directoryMarker = "const lifecycle = $('#userLifecycleFilter')?.value || '';";
if (!source.includes(directoryMarker)) {
  const paramsAnchor = `  const role = $('#userRoleFilter')?.value || '';\n  const status = $('#userStatusFilter')?.value || '';\n  if (q) params.set('q', q);\n  if (role) params.set('role', role);\n  if (status) params.set('status', status);\n`;
  const paramsReplacement = `  const role = $('#userRoleFilter')?.value || '';\n  const status = $('#userStatusFilter')?.value || '';\n  const lifecycle = $('#userLifecycleFilter')?.value || '';\n  if (q) params.set('q', q);\n  if (role) params.set('role', role);\n  if (status) params.set('status', status);\n  if (lifecycle) params.set('lifecycle', lifecycle);\n`;
  if (!source.includes(paramsAnchor)) throw new Error('Admin directory params anchor not found');
  source = source.replace(paramsAnchor, paramsReplacement);

  const eventAnchor = `$('#userStatusFilter')?.addEventListener('change', filterAdminUsers);\n$('#adminUsersPrev')?.addEventListener`;
  const eventReplacement = `$('#userStatusFilter')?.addEventListener('change', filterAdminUsers);\n$('#userLifecycleFilter')?.addEventListener('change', filterAdminUsers);\n$('#adminUsersPrev')?.addEventListener`;
  if (!source.includes(eventAnchor)) throw new Error('Admin directory lifecycle event anchor not found');
  source = source.replace(eventAnchor, eventReplacement);
  changed = true;
}

if (!html.includes('id="userLifecycleFilter"')) {
  const statusSelect = `        <select class="text-input" id="userStatusFilter">\n          <option value="">Все статусы</option>\n          <option value="new">Новые · до 7 дней</option>\n          <option value="active">Активные · были за 30 дней</option>\n          <option value="inactive">Давно не были · 30+ дней</option>\n          <option value="no_ops">Без операций</option>\n        </select>\n`;
  const lifecycleSelect = `${statusSelect}        <select class="text-input" id="userLifecycleFilter" aria-label="Этап жизненного цикла клиента">\n          <option value="">Все CRM-сегменты</option>\n          <option value="new">Новые · без визитов до 30 дней</option>\n          <option value="active">Активные · визит до 30 дней</option>\n          <option value="at_risk">В зоне риска · 31–60 дней</option>\n          <option value="sleeping">Спящие · 60+ дней</option>\n          <option value="no_visits">Без визитов · 30+ дней</option>\n        </select>\n`;
  if (!html.includes(statusSelect)) throw new Error('Admin directory status select anchor not found');
  html = html.replace(statusSelect, lifecycleSelect);
  changed = true;
}

if (changed) {
  fs.writeFileSync(appPath, source);
  fs.writeFileSync(indexPath, html);
  console.log('Customer 360 lifecycle UI materialized');
} else {
  console.log('Customer 360 lifecycle UI already materialized');
}
