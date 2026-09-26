import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appPath = path.join(root, 'app.js');
const indexPath = path.join(root, 'index.html');
const stylesPath = path.join(root, 'styles.css');
let app = fs.readFileSync(appPath, 'utf8');
let html = fs.readFileSync(indexPath, 'utf8');
let css = fs.readFileSync(stylesPath, 'utf8');
let changed = false;

if (!app.includes('function openCustomer360(userId)')) {
  const anchor = 'function renderUsers(users, target = \'#usersList\', compact = false) {';
  if (!app.includes(anchor)) throw new Error('Customer 360 renderUsers anchor not found');
  const helpers = `function customer360Date(value, withTime = false) {
  if (!value) return 'Нет данных';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Нет данных';
  return date.toLocaleString('ru-RU', withTime ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const CUSTOMER360_LIFECYCLE_LABELS = { new: 'Новый клиент', active: 'Активный', at_risk: 'В зоне риска', sleeping: 'Спящий', no_visits: 'Без визитов' };
function customer360Money(cents) { return \`\${fmt(Number(cents || 0) / 100)} ₽\`; }
function customer360ModeLabel(mode) { return ({ accrue: 'Покупка · начисление', redeem: 'Покупка · списание', adjustment: 'Ручная корректировка', beer_reward: 'Пивная награда', gift: 'Подарок' })[mode] || mode || 'Операция'; }

function renderCustomer360(customer) {
  const metrics = customer?.metrics || {};
  $('#customer360Title').textContent = customer?.name || customer?.username || \`Клиент #\${customer?.id || ''}\`;
  $('#customer360Subtitle').textContent = [CUSTOMER360_LIFECYCLE_LABELS[customer?.lifecycle?.status] || 'CRM', customer?.username ? \`@\${customer.username}\` : '', \`ID \${customer?.id || '—'}\`].filter(Boolean).join(' · ');
  $('#customer360Error').hidden = true;
  const metricItems = [['LTV / оборот', customer360Money(metrics.lifetimeCheckCents)], ['Средний чек', customer360Money(metrics.averageCheckCents)], ['Визиты', fmt(metrics.visits)], ['За 30 дней', customer360Money(metrics.spend30dCents)], ['Визиты · 30 дней', fmt(metrics.visits30d)], ['Частота / 30 дней', fmt(metrics.frequency30d)]];
  $('#customer360Metrics').innerHTML = metricItems.map(([label, value]) => \`<div class="customer360-metric"><span>\${escapeHtml(label)}</span><strong>\${escapeHtml(value)}</strong></div>\`).join('');
  const facts = [['Последний визит', customer360Date(metrics.lastVisitAt, true)], ['Регистрация', customer360Date(customer?.createdAt)], ['Бонусный баланс', \`\${compactBonus(customer?.balance)} Б\`], ['Начислено бонусов', \`\${compactBonus(metrics.bonusEarned)} Б\`], ['Списано бонусов', \`\${compactBonus(metrics.bonusSpent)} Б\`], ['Пиво оплачено', \`\${fmtLiters(Number(customer?.beerPaidMlTotal || 0) / 1000)} л\`], ['Подарочный баланс', \`\${fmtLiters(Number(customer?.beerGiftMlBalance || 0) / 1000)} л\`], ['Маркетинг', customer?.marketingOptIn ? 'Согласие получено' : 'Нет согласия'], ['QR', customer?.qrShortCode || 'Не создан']];
  $('#customer360Facts').innerHTML = facts.map(([label, value]) => \`<div class="customer360-fact"><span>\${escapeHtml(label)}</span><b>\${escapeHtml(value)}</b></div>\`).join('');
  const history = Array.isArray(customer?.history) ? customer.history : [];
  $('#customer360History').innerHTML = history.length ? history.map((item) => \`<div class="customer360-history-row \${item.status === 'cancelled' ? 'is-cancelled' : ''}"><div><b>\${escapeHtml(customer360ModeLabel(item.mode))}</b><small>\${escapeHtml(customer360Date(item.created_at, true))}\${item.staff_name ? ' · ' + escapeHtml(item.staff_name) : ''}</small></div><strong>\${Number(item.check_amount_cents || 0) ? customer360Money(item.check_amount_cents) : 'Без чека'}</strong></div>\`).join('') : '<div class="empty-state">Истории операций пока нет</div>';
}

async function openCustomer360(userId) {
  const id = String(userId || '').trim();
  if (!/^[1-9]\\d*$/.test(id)) throw new Error('Некорректный ID клиента.');
  state.customer360UserId = id;
  $('#customer360Title').textContent = 'Загрузка клиента…';
  $('#customer360Subtitle').textContent = 'Customer 360';
  $('#customer360Metrics').innerHTML = '<div class="customer360-loading">Собираем показатели…</div>';
  $('#customer360Facts').innerHTML = '';
  $('#customer360History').innerHTML = '';
  $('#customer360Retry').hidden = true;
  $('#customer360Error').hidden = true;
  openModal('customer360Modal');
  try {
    const data = await api(\`/api/admin/users/\${id}\`);
    if (String(state.customer360UserId) === id) renderCustomer360(data.customer);
  } catch (error) {
    if (String(state.customer360UserId) !== id) return;
    $('#customer360Title').textContent = 'Не удалось загрузить клиента';
    $('#customer360Error').hidden = false;
    $('#customer360Error').textContent = error.message || 'Ошибка загрузки Customer 360.';
    $('#customer360Retry').hidden = false;
    throw error;
  }
}

`;
  app = app.replace(anchor, helpers + anchor);

  const controlsAnchor = '    const controls = !compact && roleCanWrite(state.profile.role) && user.role !== \'admin\'';
  const controlsReplacement = `    const customerCardButton = !compact && user.role === 'client' ? \`<button class="text-btn customer360-open-button" data-customer360-user="\${user.id}" type="button">Карточка клиента</button>\` : '';
    const controls = !compact && roleCanWrite(state.profile.role) && user.role !== 'admin'`;
  if (!app.includes(controlsAnchor)) throw new Error('Customer 360 controls anchor not found');
  app = app.replace(controlsAnchor, controlsReplacement);
  const actionsAnchor = '      ? `<div class="user-actions">\n          <select data-role-user="${user.id}">';
  if (!app.includes(actionsAnchor)) throw new Error('Customer 360 actions anchor not found');
  app = app.replace(actionsAnchor, '      ? `<div class="user-actions">\n          ${customerCardButton}\n          <select data-role-user="${user.id}">');
  const readonlyAnchor = '      : `<small>${user.role === \'viewer\'';
  if (!app.includes(readonlyAnchor)) throw new Error('Customer 360 readonly anchor not found');
  app = app.replace(readonlyAnchor, '      : `${customerCardButton}<small>${user.role === \'viewer\'');
  const bindAnchor = "  root.querySelectorAll('[data-role-user]').forEach";
  if (!app.includes(bindAnchor)) throw new Error('Customer 360 binding anchor not found');
  app = app.replace(bindAnchor, `  root.querySelectorAll('[data-customer360-user]').forEach((button) => button.addEventListener('click', () => openCustomer360(button.dataset.customer360User).catch((error) => toast(error.message))));\n  ${bindAnchor}`);
  changed = true;
}

const legacyStatusOptions = `          <option value="">Все статусы</option>
          <option value="new">Новые · до 7 дней</option>
          <option value="active">Активные · были за 30 дней</option>
          <option value="inactive">Давно не были · 30+ дней</option>
          <option value="no_ops">Без операций</option>`;
const lifecycleStatusOptions = `          <option value="">Все статусы</option>
          <option value="new">Новые · без визитов до 30 дней</option>
          <option value="active">Активные · визит до 30 дней</option>
          <option value="at_risk">В зоне риска · 30–60 дней</option>
          <option value="sleeping">Спящие · более 60 дней</option>
          <option value="no_visits">Без визитов · более 30 дней</option>`;
if (html.includes(legacyStatusOptions)) {
  html = html.replace(legacyStatusOptions, lifecycleStatusOptions);
  changed = true;
} else if (!html.includes('<option value="at_risk">В зоне риска · 30–60 дней</option>')) {
  throw new Error('Customer 360 lifecycle filter anchor not found');
}

if (!html.includes('id="customer360Modal"')) {
  const modal = `\n  <div class="modal" id="customer360Modal" aria-hidden="true"><div class="modal-backdrop" data-close="customer360Modal"></div><section class="modal-card customer360-card"><button class="modal-close" data-close="customer360Modal" type="button">×</button><span class="eyebrow">CRM · CUSTOMER 360</span><h2 id="customer360Title">Карточка клиента</h2><p id="customer360Subtitle" class="muted">Показатели и история</p><div id="customer360Error" class="customer360-error" hidden></div><button id="customer360Retry" class="text-btn" type="button" hidden>Повторить</button><div id="customer360Metrics" class="customer360-metrics"></div><div id="customer360Facts" class="customer360-facts"></div><h3>История операций</h3><div id="customer360History" class="customer360-history"></div></section></div>\n`;
  if (!html.includes('</body>')) throw new Error('Customer 360 body anchor not found');
  html = html.replace('</body>', `${modal}</body>`);
  changed = true;
}

if (!css.includes('/* CUSTOMER360_UI */')) {
  css += `\n/* CUSTOMER360_UI */\n.customer360-card{max-width:760px}.customer360-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:18px 0}.customer360-metric,.customer360-fact{padding:12px;border:1px solid rgba(171,137,73,.2);border-radius:14px;background:rgba(255,255,255,.035)}.customer360-metric span,.customer360-fact span{display:block;color:var(--muted);font-size:11px}.customer360-metric strong{display:block;margin-top:5px;font-size:18px}.customer360-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:18px}.customer360-history{display:grid;gap:8px}.customer360-history-row{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.08)}.customer360-history-row small{display:block;color:var(--muted);margin-top:4px}.customer360-history-row.is-cancelled{opacity:.55}.customer360-error{padding:12px;border-radius:12px;background:rgba(170,40,40,.12);color:#e9a5a5}.customer360-loading{grid-column:1/-1;color:var(--muted);padding:16px 0}@media(max-width:640px){.customer360-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.customer360-facts{grid-template-columns:1fr}}\n`;
  changed = true;
}

if (changed) {
  fs.writeFileSync(appPath, app);
  fs.writeFileSync(indexPath, html);
  fs.writeFileSync(stylesPath, css);
  console.log('Customer 360 CRM UI materialized');
} else console.log('Customer 360 CRM UI already materialized');