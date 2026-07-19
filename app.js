const tg = window.Telegram?.WebApp ?? null;
if (tg) {
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor('#15110e');
    tg.setBackgroundColor('#0e0c0a');
    tg.setBottomBarColor('#120e0b');
  } catch (_) {}
}

const BOOT_MIN_MS = 1800;
const BOOT_FAILSAFE_MS = 12000;
const bootStartedAt = performance.now();

const state = {
  token: localStorage.getItem('pivnik_session') || '',
  profile: null,
  statuses: [],
  design: null,
  adminSettings: null,
  mode: 'accrue',
  qr: null,
  qrTimer: null,
  resolvedClient: null,
  pending: null,
  staffPendingId: null,
  pendingPoll: null,
  mePoll: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const fmt = (number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(number || 0));
const roleCanStaff = (role) => ['staff', 'admin'].includes(role);
const roleCanAdmin = (role) => ['viewer', 'admin'].includes(role);
const roleCanWrite = (role) => role === 'admin';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function finishBoot() {
  const elapsed = performance.now() - bootStartedAt;
  if (elapsed < BOOT_MIN_MS) await delay(BOOT_MIN_MS - elapsed);
  $('#bootScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
}

setTimeout(() => {
  const bootScreen = $('#bootScreen');
  if (!bootScreen || bootScreen.classList.contains('hidden')) return;
  $('#bootText').textContent = 'Почти готово…';
}, BOOT_FAILSAFE_MS / 2);

setTimeout(() => {
  const bootScreen = $('#bootScreen');
  if (!bootScreen || bootScreen.classList.contains('hidden')) return;
  $('#bootText').textContent = 'Соединение заняло больше времени обычного…';
}, BOOT_FAILSAFE_MS);

function toast(text) {
  const element = $('#toast');
  element.textContent = text;
  element.classList.add('show');
  clearTimeout(element._timer);
  element._timer = setTimeout(() => element.classList.remove('show'), 2600);
}

function haptic(type = 'light') {
  try { tg?.HapticFeedback?.impactOccurred(type); } catch (_) {}
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
  return data;
}

function openModal(id) {
  const modal = $(`#${id}`);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal(id) {
  const modal = $(`#${id}`);
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function switchScreen(target) {
  $$('.screen').forEach((screen) => screen.classList.toggle('active', screen.dataset.screen === target));
  $$('.bottom-nav button').forEach((button) => button.classList.toggle('active', button.dataset.target === target));
  if (target === 'admin') loadAdmin().catch((error) => toast(error.message));
}

function currentLevelIndex() {
  return Math.max(0, state.statuses.findIndex((level) => level.name === state.profile?.status?.name));
}

function applyDesign(design) {
  if (!design) return;
  state.design = structuredClone(design);
  const root = document.documentElement;
  const colors = design.colors || {};
  root.style.setProperty('--bg', colors.background || '#0e0c0a');
  root.style.setProperty('--header', colors.header || '#15110e');
  root.style.setProperty('--surface', colors.surface || '#1c1612');
  root.style.setProperty('--card', colors.card || '#231a14');
  root.style.setProperty('--text', colors.text || '#f7eee5');
  root.style.setProperty('--muted', colors.muted || '#a99580');
  root.style.setProperty('--gold', colors.accent || '#e9a83b');
  root.style.setProperty('--gold2', colors.accentSoft || '#ffc96b');
  root.style.setProperty('--radius', `${Number(design.radius || 20)}px`);

  $('#brandTitle').textContent = design.texts?.brand || 'Пивник';
  $('#balanceLabel').textContent = design.texts?.balanceLabel || 'Ваш баланс';
  const brand = design.texts?.brand || 'Пивник';
  $('#showQrButton').textContent = design.texts?.qrButton || 'Показать QR';
  $('#byline').textContent = `${design.texts?.byline || 'by Kirill Gamilton'} △`;
  $$('#bootSignGlitch span').forEach((element) => element.textContent = brand);

  Object.entries(design.sections || {}).forEach(([key, visible]) => {
    if (key === 'byline') $('#byline').classList.toggle('hidden', !visible);
    else document.querySelectorAll(`[data-config-section="${key}"]`).forEach((element) => element.classList.toggle('hidden', !visible));
  });

  try {
    tg?.setHeaderColor(colors.header || '#15110e');
    tg?.setBackgroundColor(colors.background || '#0e0c0a');
  } catch (_) {}
}

function renderProfile() {
  const profile = state.profile;
  if (!profile) return;
  $('#eyebrow').textContent = `${profile.firstName}${profile.username ? ` · @${profile.username}` : ''}`;
  $('#clientBalance').textContent = fmt(profile.balance);
  $('#statusName').textContent = profile.status.name;
  $('#bonusPercent').textContent = `${profile.status.bonusPercent}% бонусами`;
  $('#profileAvatar').textContent = (profile.firstName || 'П').slice(0, 1).toUpperCase();
  $('#staffName').textContent = profile.firstName || 'Бармен';

  const min = Number(profile.status.minSpend || 0);
  const next = profile.status.nextSpend;
  if (next) {
    const percentage = Math.max(0, Math.min(100, ((profile.spend12m - min) / (next - min)) * 100));
    $('#statusProgress').style.width = `${percentage}%`;
    $('#statusProgressText').textContent = `${fmt(profile.spend12m)} / ${fmt(next)} ₽`;
  } else {
    $('#statusProgress').style.width = '100%';
    $('#statusProgressText').textContent = 'Максимальный статус';
  }

  $('#staffNav').classList.toggle('hidden', !roleCanStaff(profile.role));
  $('#adminNav').classList.toggle('hidden', !roleCanAdmin(profile.role));
  if (!roleCanStaff(profile.role) && $('[data-screen="staff"]').classList.contains('active')) switchScreen('client');
  if (!roleCanAdmin(profile.role) && $('[data-screen="admin"]').classList.contains('active')) switchScreen('client');
  $('#adminRoleBadge').textContent = profile.role === 'viewer' ? 'VIEW' : 'ADMIN';
  $('#adminAccessLabel').textContent = profile.role === 'viewer' ? 'Только просмотр' : 'Полный доступ';
  $$('.admin-write-only').forEach((element) => element.classList.toggle('hidden', !roleCanWrite(profile.role)));
}

function renderStatuses() {
  const activeIndex = currentLevelIndex();
  $('#statusLevelsList').innerHTML = state.statuses.map((level, index) => {
    const reached = index <= activeIndex;
    const current = index === activeIndex;
    return `<article class="status-level ${current ? 'current' : ''} ${reached ? 'reached' : ''}">
      <div class="status-rank">${index + 1}</div>
      <div class="status-level-copy">
        <div class="status-level-head"><b>${level.name}</b>${current ? '<span>Ваш статус</span>' : ''}</div>
        <small>от ${fmt(level.min)} ₽ за 12 месяцев</small>
        <p>${level.bonusPercent}% бонусами${level.discountPercent ? ` · скидка ${level.discountPercent}%` : ''}</p>
      </div>
      <div class="status-level-mark">${current ? '●' : reached ? '✓' : '○'}</div>
    </article>`;
  }).join('');
}

function renderTransaction(transaction) {
  const mode = transaction.mode === 'redeem' ? 'Списание' : transaction.mode === 'adjustment' ? 'Коррекция' : 'Начисление';
  const statusText = {
    pending: 'ожидает подтверждения', completed: 'выполнено', declined: 'отклонено', expired: 'истекло', cancelled: 'отменено'
  }[transaction.status] || transaction.status;
  const primary = transaction.mode === 'adjustment'
    ? `${transaction.bonusEarned ? '+' : '-'}${transaction.bonusEarned || transaction.bonusSpent} Б`
    : `${fmt(transaction.checkAmount)} ₽`;
  const detail = transaction.mode === 'redeem'
    ? `−${transaction.bonusSpent} Б · +${transaction.bonusEarned} Б`
    : transaction.mode === 'adjustment'
      ? transaction.reason || 'Ручная корректировка'
      : `+${transaction.bonusEarned} Б · скидка ${fmt(transaction.discount)} ₽`;
  return `<div class="op-row">
    <b>${mode}</b><strong>${primary}</strong>
    <small>${new Date(transaction.createdAt).toLocaleString('ru-RU')} · ${statusText}<br>${detail}</small>
  </div>`;
}

async function refreshMe() {
  const data = await api('/api/me');
  state.profile = data.profile;
  applyDesign(data.design);
  renderProfile();
}

async function authenticate() {
  const initData = tg?.initData || '';
  const payload = { initData };
  if (!initData && new URLSearchParams(location.search).get('demo') === '1') payload.demoTelegramId = '999000111';
  const data = await api('/api/auth', { method: 'POST', body: JSON.stringify(payload), headers: { authorization: '' } });
  state.token = data.token;
  localStorage.setItem('pivnik_session', state.token);
  state.profile = data.profile;
  state.statuses = data.statuses || [];
  applyDesign(data.design);
  renderProfile();
  renderStatuses();
}

async function boot() {
  try {
    $('#bootText').textContent = 'Подключаем бонусный счёт…';
    if (state.token) {
      try {
        const me = await api('/api/me');
        state.profile = me.profile;
        state.statuses = me.statuses || [];
        applyDesign(me.design);
      } catch {
        state.token = '';
        localStorage.removeItem('pivnik_session');
      }
    }
    if (!state.token) {
      $('#bootText').textContent = 'Проверяем доступ в Telegram…';
      await authenticate();
    }
    $('#bootText').textContent = 'Собираем данные профиля…';
    renderProfile();
    renderStatuses();
    startPendingPolling();
    await finishBoot();
  } catch (error) {
    $('#bootText').textContent = error.message;
    $('#bootScreen').classList.add('error');
  }
}

async function createQr() {
  const data = await api('/api/me/qr', { method: 'POST', body: '{}' });
  state.qr = data;
  $('#qrImage').src = data.image;
  $('#qrToken').textContent = data.shortCode;
  const expires = new Date(data.expiresAt).getTime();
  clearInterval(state.qrTimer);
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((expires - Date.now()) / 1000));
    $('#qrCountdown').textContent = seconds;
    if (seconds <= 0) createQr().catch((error) => toast(error.message));
  };
  tick();
  state.qrTimer = setInterval(tick, 1000);
}

async function showQr() {
  openModal('qrModal');
  await createQr();
}

async function showHistory() {
  const data = await api('/api/me/transactions');
  $('#historyList').className = `operation-list${data.transactions.length ? '' : ' empty-state'}`;
  $('#historyList').innerHTML = data.transactions.length ? data.transactions.map(renderTransaction).join('') : 'Операций пока нет';
  openModal('historyModal');
}

async function resolveQr(payload) {
  const data = await api('/api/staff/qr/resolve', { method: 'POST', body: JSON.stringify({ payload }) });
  state.resolvedClient = { qrToken: data.qrToken, profile: data.client };
  $('#scanClient').classList.add('hidden');
  $('#clientFound').classList.remove('hidden');
  $('#foundName').textContent = `${data.client.firstName} · ${data.client.status.name}`;
  $('#foundMeta').textContent = `${fmt(data.client.balance)} бонусов · ${data.client.status.bonusPercent}%`;
  $('#foundAvatar').textContent = data.client.firstName.slice(0, 1).toUpperCase();
  updateCalculation();
  haptic('medium');
}

function scanQr() {
  if (tg?.showScanQrPopup) {
    tg.showScanQrPopup({ text: 'Наведите камеру на QR-код клиента' }, (text) => {
      if (!text) return false;
      resolveQr(text).then(() => tg.closeScanQrPopup()).catch((error) => toast(error.message));
      return true;
    });
    return;
  }
  const code = prompt('Введите шестизначный код клиента:');
  if (code) resolveQr(code).catch((error) => toast(error.message));
}

function clearResolvedClient() {
  state.resolvedClient = null;
  $('#scanClient').classList.remove('hidden');
  $('#clientFound').classList.add('hidden');
  updateCalculation();
}

function updateCalculation() {
  const amount = Number(String($('#saleAmount').value || '').replace(',', '.')) || 0;
  const client = state.resolvedClient?.profile;
  let cash = amount;
  let earn = 0;
  if (client && amount > 0) {
    if (state.mode === 'accrue') {
      const discount = amount * client.status.discountPercent / 100;
      cash = amount - discount;
      earn = Math.floor(cash * client.status.bonusPercent / 100);
    } else {
      const max = Math.min(client.balance, Math.floor(amount * 0.30));
      const requested = Math.min(max, Math.max(0, Math.floor(Number($('#bonusToSpend').value || max))));
      $('#bonusToSpend').max = String(max);
      $('#redeemHint').textContent = `Доступно максимум ${fmt(max)} бонусов`;
      cash = amount - requested;
      earn = Math.floor(cash * client.status.bonusPercent / 100);
    }
  }
  $('#cashDue').textContent = `${fmt(cash)} ₽`;
  $('#bonusEarn').textContent = `+${fmt(earn)}`;
  $('#createSale').disabled = !(amount > 0 && client && !state.staffPendingId);
}

async function createSale() {
  const amount = Number(String($('#saleAmount').value || '').replace(',', '.')) || 0;
  const requestKey = crypto.randomUUID();
  const data = await api('/api/staff/transactions', {
    method: 'POST',
    body: JSON.stringify({
      qrToken: state.resolvedClient.qrToken,
      amount,
      mode: state.mode,
      bonusToSpend: Number($('#bonusToSpend').value || 0),
      requestKey
    })
  });
  if (data.transaction.status === 'pending') {
    state.staffPendingId = data.transaction.id;
    $('#waitBox').classList.remove('hidden');
    $('#createSale').disabled = true;
    pollStaffPending();
    toast('Запрос отправлен клиенту');
  } else {
    toast(`Начислено ${data.transaction.bonusEarned} бонусов`);
    resetSaleForm();
  }
  haptic('medium');
}

function resetSaleForm() {
  clearInterval(state.pendingPoll);
  state.staffPendingId = null;
  $('#waitBox').classList.add('hidden');
  $('#saleAmount').value = '';
  $('#bonusToSpend').value = '';
  clearResolvedClient();
  updateCalculation();
}

function pollStaffPending() {
  clearInterval(state.pendingPoll);
  state.pendingPoll = setInterval(async () => {
    if (!state.staffPendingId) return;
    try {
      const data = await api(`/api/staff/transactions/${state.staffPendingId}`);
      if (data.transaction.status !== 'pending') {
        clearInterval(state.pendingPoll);
        toast(data.transaction.status === 'completed' ? 'Клиент подтвердил списание' : 'Списание не подтверждено');
        resetSaleForm();
      }
    } catch (error) {
      clearInterval(state.pendingPoll);
      toast(error.message);
      resetSaleForm();
    }
  }, 2000);
}

async function checkPending() {
  const data = await api('/api/me/pending');
  if (!data.pending) {
    if (state.pending) closeModal('pendingModal');
    state.pending = null;
    return;
  }
  if (state.pending?.id === data.pending.id) return;
  state.pending = data.pending;
  $('#pendingSummary').innerHTML = `
    <span>Чек <b>${fmt(data.pending.checkAmount)} ₽</b></span>
    <span>Списать <b>${fmt(data.pending.bonusSpent)} бонусов</b></span>
    <span>Начислится <b>${fmt(data.pending.bonusEarned)} бонусов</b></span>
    <span>Оплатить <b>${fmt(data.pending.cashPaid)} ₽</b></span>`;
  openModal('pendingModal');
  haptic('heavy');
}

function startPendingPolling() {
  clearInterval(state.mePoll);
  checkPending().catch(() => {});
  state.mePoll = setInterval(() => checkPending().catch(() => {}), 3000);
}

async function decidePending(approved) {
  if (!state.pending) return;
  const data = await api(`/api/me/pending/${state.pending.id}/decision`, {
    method: 'POST', body: JSON.stringify({ approved })
  });
  closeModal('pendingModal');
  state.pending = null;
  if (approved && data.profile) {
    state.profile = data.profile;
    renderProfile();
    toast('Списание подтверждено');
  } else toast('Списание отклонено');
}

function fillDesignForm(design) {
  if (!design) return;
  $$('[data-design-color]').forEach((input) => input.value = design.colors?.[input.dataset.designColor] || '#000000');
  $$('[data-design-text]').forEach((input) => input.value = design.texts?.[input.dataset.designText] || '');
  $$('[data-design-section]').forEach((input) => input.checked = Boolean(design.sections?.[input.dataset.designSection]));
  $('[data-design-radius]').value = String(design.radius || 20);
  $('#radiusValue').textContent = String(design.radius || 20);
}

function readDesignForm() {
  const design = structuredClone(state.adminSettings?.draft || state.design);
  design.colors ||= {};
  design.texts ||= {};
  design.sections ||= {};
  $$('[data-design-color]').forEach((input) => design.colors[input.dataset.designColor] = input.value);
  $$('[data-design-text]').forEach((input) => design.texts[input.dataset.designText] = input.value.trim());
  $$('[data-design-section]').forEach((input) => design.sections[input.dataset.designSection] = input.checked);
  design.radius = Number($('[data-design-radius]').value || 20);
  return design;
}

async function saveDraft() {
  const design = readDesignForm();
  await api('/api/admin/design/draft', { method: 'PUT', body: JSON.stringify({ design }) });
  state.adminSettings.draft = design;
  applyDesign(design);
  toast('Черновик сохранён');
}

async function publishDesign() {
  await saveDraft();
  const data = await api('/api/admin/design/publish', { method: 'POST', body: '{}' });
  state.adminSettings.published = data.design;
  applyDesign(data.design);
  toast('Дизайн опубликован для всех');
}

function adminTransactionHtml(transaction) {
  const client = transaction.clientName || 'Клиент';
  const staff = transaction.staffName || 'Система';
  return `<div class="op-row">
    <b>${client}</b><strong>${fmt(transaction.checkAmount)} ₽</strong>
    <small>${new Date(transaction.createdAt).toLocaleString('ru-RU')} · ${staff}<br>${transaction.status} · +${transaction.bonusEarned} / −${transaction.bonusSpent} Б</small>
  </div>`;
}

async function loadAdmin() {
  if (!roleCanAdmin(state.profile?.role)) return;
  const [summaryData, usersData] = await Promise.all([api('/api/admin/summary'), api('/api/admin/users')]);
  state.adminSettings = summaryData.settings;
  $('#metricClients').textContent = fmt(summaryData.summary.clients);
  $('#metricIssued').textContent = fmt(summaryData.summary.issued);
  $('#metricToday').textContent = `${fmt(summaryData.summary.todayCheck)} ₽`;
  $('#metricTodayOps').textContent = `${summaryData.summary.todayOperations} операций`;
  $('#adminOperations').className = `operation-list${summaryData.operations.length ? '' : ' empty-state'}`;
  $('#adminOperations').innerHTML = summaryData.operations.length ? summaryData.operations.map(adminTransactionHtml).join('') : 'Операций пока нет';
  fillDesignForm(summaryData.settings.draft);
  renderUsers(usersData.users);
}

function renderUsers(users) {
  $('#usersList').className = `operation-list${users.length ? '' : ' empty-state'}`;
  $('#usersList').innerHTML = users.map((user) => {
    const controls = roleCanWrite(state.profile.role) && user.role !== 'admin'
      ? `<div class="user-actions">
          <select data-role-user="${user.id}">
            <option value="client" ${user.role === 'client' ? 'selected' : ''}>Клиент</option>
            <option value="staff" ${user.role === 'staff' ? 'selected' : ''}>Бармен</option>
            <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Просмотр админки</option>
          </select>
          <button class="text-btn" data-adjust-user="${user.id}">Баланс</button>
        </div>`
      : `<small>${user.role}</small>`;
    return `<div class="user-row">
      <div><b>${user.name}</b><small>${user.telegramId}${user.username ? ` · @${user.username}` : ''}</small></div>
      <strong>${fmt(user.balance)} Б</strong>
      ${controls}
    </div>`;
  }).join('');

  $$('[data-role-user]').forEach((select) => select.addEventListener('change', async () => {
    try {
      await api(`/api/admin/users/${select.dataset.roleUser}/role`, { method: 'POST', body: JSON.stringify({ role: select.value }) });
      toast('Роль обновлена');
    } catch (error) { toast(error.message); }
  }));
  $$('[data-adjust-user]').forEach((button) => button.addEventListener('click', async () => {
    const amount = prompt('Изменение бонусов. Плюс — начислить, минус — списать:', '100');
    if (amount === null) return;
    const reason = prompt('Причина корректировки:', 'Тестовая корректировка');
    if (!reason) return;
    try {
      await api(`/api/admin/users/${button.dataset.adjustUser}/adjust`, { method: 'POST', body: JSON.stringify({ amount: Number(amount), reason }) });
      toast('Баланс изменён');
      await loadAdmin();
    } catch (error) { toast(error.message); }
  }));
}

$$('.bottom-nav button').forEach((button) => button.addEventListener('click', () => switchScreen(button.dataset.target)));
$$('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
$$('.modal').forEach((modal) => modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(modal.id); }));
$('#showQrButton').addEventListener('click', () => showQr().catch((error) => toast(error.message)));
$('#showHistoryButton').addEventListener('click', () => showHistory().catch((error) => toast(error.message)));
$('#openStatuses').addEventListener('click', () => { renderStatuses(); openModal('statusesModal'); });
$('#refreshButton').addEventListener('click', () => refreshMe().then(() => toast('Данные обновлены')).catch((error) => toast(error.message)));
$('#scanClient').addEventListener('click', scanQr);
$('#clearClient').addEventListener('click', clearResolvedClient);
$('#saleAmount').addEventListener('input', updateCalculation);
$('#bonusToSpend').addEventListener('input', updateCalculation);
$$('.mode').forEach((button) => button.addEventListener('click', () => {
  state.mode = button.dataset.mode;
  $$('.mode').forEach((item) => item.classList.toggle('active', item === button));
  $('#redeemControls').classList.toggle('hidden', state.mode !== 'redeem');
  updateCalculation();
}));
$('#createSale').addEventListener('click', () => createSale().catch((error) => toast(error.message)));
$('#approvePending').addEventListener('click', () => decidePending(true).catch((error) => toast(error.message)));
$('#declinePending').addEventListener('click', () => decidePending(false).catch((error) => toast(error.message)));
$('#saveDraft').addEventListener('click', () => saveDraft().catch((error) => toast(error.message)));
$('#publishDesign').addEventListener('click', () => publishDesign().catch((error) => toast(error.message)));
$('#reloadAdmin').addEventListener('click', () => loadAdmin().catch((error) => toast(error.message)));
$('#reloadUsers').addEventListener('click', () => loadAdmin().catch((error) => toast(error.message)));
$$('[data-design-color], [data-design-text], [data-design-section], [data-design-radius]').forEach((input) => input.addEventListener('input', () => {
  if (input.matches('[data-design-radius]')) $('#radiusValue').textContent = input.value;
  if (state.adminSettings) applyDesign(readDesignForm());
}));

boot();
