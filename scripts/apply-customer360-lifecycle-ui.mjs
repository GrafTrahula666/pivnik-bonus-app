import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appPath = path.join(root, 'app.js');
let source = fs.readFileSync(appPath, 'utf8');

const marker = 'const CUSTOMER360_LIFECYCLE_LABELS = {';
if (source.includes(marker)) {
  console.log('Customer 360 lifecycle UI already materialized');
  process.exit(0);
}

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

fs.writeFileSync(appPath, source);
console.log('Customer 360 lifecycle UI materialized');
