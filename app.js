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
  resolvedClient: null,
  saleBusy: false,
  operationResultTimer: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const fmt = (number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(number || 0));
const roleCanStaff = (role) => ['staff', 'admin'].includes(role);
const roleCanAdmin = (role) => ['viewer', 'admin'].includes(role);
const roleCanWrite = (role) => role === 'admin';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');


function enhanceDom() {
  const topbar = $('.topbar');
  if (topbar) {
    const brandBlock = topbar.firstElementChild;
    if (brandBlock) {
      brandBlock.classList.add('brand-lockup');
      const title = $('#brandTitle');
      if (title && !title.parentElement.classList.contains('brand-line')) {
        const line = document.createElement('div');
        line.className = 'brand-line';
        title.before(line);
        line.append(title);
        line.insertAdjacentHTML('beforeend', '<span class="beta-badge">закрытая бета</span>');
      }
    }
  }
  if (topbar && !$('#networkBadge')) {
    const actions = document.createElement('div');
    actions.className = 'topbar-actions';
    actions.innerHTML = '<span class="network-badge" id="networkBadge"><i></i><span>онлайн</span></span>';
    const refresh = $('#refreshButton');
    if (refresh) actions.append(refresh);
    topbar.append(actions);
  }

  const heroCard = $('.hero-card');
  if (heroCard && !heroCard.querySelector('.hero-glow')) heroCard.insertAdjacentHTML('afterbegin', '<div class="hero-glow" aria-hidden="true"></div>');

  const progress = $('.hero-card .progress');
  if (progress && !$('#nextRewardText')) {
    const insights = document.createElement('div');
    insights.className = 'hero-insights';
    insights.innerHTML = '<div><span>Начисление</span><strong id="bonusPercentMirror">—</strong></div><div><span>До нового статуса</span><strong id="nextRewardText">—</strong></div>';
    progress.after(insights);
  }

  const hero = $('.hero-card');
  if (hero && !$('.client-tip')) {
    const tip = document.createElement('div');
    tip.className = 'client-tip';
    tip.innerHTML = '<span class="client-tip-icon">⌗</span><div><b>Один личный код</b><small>QR постоянный. Не отправляйте его посторонним.</small></div>';
    hero.after(tip);
  }

  const scan = $('#scanClient');
  if (scan && !$('#manualCodeButton')) {
    const manual = document.createElement('button');
    manual.id = 'manualCodeButton';
    manual.type = 'button';
    manual.className = 'secondary full manual-code-button';
    manual.textContent = 'Ввести короткий код';
    scan.after(manual);
  }

  const foundMeta = $('#foundMeta');
  if (foundMeta && !$('#foundCode')) {
    const code = document.createElement('small');
    code.id = 'foundCode';
    code.className = 'found-code';
    foundMeta.after(code);
  }

  const createSaleButton = $('#createSale');
  if (createSaleButton && !$('#operationResult')) {
    const result = document.createElement('div');
    result.id = 'operationResult';
    result.className = 'operation-result hidden';
    createSaleButton.before(result);
  }

  const staffCards = $$('[data-screen="staff"] .card');
  staffCards.forEach((card, index) => {
    card.classList.add('staff-step');
    const heading = card.querySelector(':scope > h3');
    if (heading && !heading.parentElement.classList.contains('step-heading')) {
      const raw = heading.textContent.replace(/^\d+\.\s*/, '');
      const descriptions = ['Введите полную сумму покупки', 'Сканируйте QR или введите код', 'Выберите начисление или списание'];
      const wrap = document.createElement('div');
      wrap.className = 'step-heading';
      wrap.innerHTML = `<span>${index + 1}</span><div><h3>${raw}</h3><small>${descriptions[index] || ''}</small></div>`;
      heading.replaceWith(wrap);
    }
  });
  $$('.mode').forEach((button) => {
    const label = button.textContent.trim();
    if (!button.querySelector('b')) button.innerHTML = `<b>${label}</b><small>${label === 'Списание' ? 'Сразу уменьшает баланс' : 'Начисляет бонусы за чек'}</small>`;
  });
  $('#createSale')?.classList.add('operation-button');

  const waitBox = $('#waitBox');
  if (waitBox) waitBox.classList.add('hidden');
  const redeemHint = $('#redeemHint');
  if (redeemHint) redeemHint.textContent = 'Списание проводится сразу после нажатия сотрудником';

  const metrics = $$('.metric-grid .metric');
  if (metrics.length >= 4 && !$('#metricSuspicious')) {
    metrics[3].classList.add('metric-alert');
    metrics[3].innerHTML = '<span>На проверке</span><strong id="metricSuspicious">0</strong><small>операций свыше 3 000 ₽</small>';
  }

  const qrSheet = $('#qrModal .qr-sheet');
  if (qrSheet && !$('#copyQrCode')) {
    const title = qrSheet.querySelector('h2');
    if (title) title.textContent = 'Личная бонусная карта';
    const qrParagraph = qrSheet.querySelector('p');
    if (qrParagraph) qrParagraph.innerHTML = 'Код постоянный и принадлежит только вам.';
    const copy = document.createElement('button');
    copy.id = 'copyQrCode';
    copy.type = 'button';
    copy.className = 'secondary full copy-code copy-code-button';
    copy.textContent = 'Скопировать короткий код';
    const qrImage = $('#qrImage');
    if (qrImage && !qrImage.parentElement.classList.contains('qr-frame')) {
      const frame = document.createElement('div');
      frame.className = 'qr-frame';
      qrImage.before(frame);
      frame.append(qrImage);
    }
    const token = $('#qrToken');
    if (token) token.after(copy);
    const warning = document.createElement('p');
    warning.className = 'qr-warning';
    warning.textContent = 'Передача QR или скриншота даёт доступ к вашему бонусному счёту.';
    qrSheet.append(warning);
  }

  const help = $('#helpModal');
  if (help) {
    help.innerHTML = help.innerHTML
      .replace('подтвердите запрос в приложении, если подтверждение включено в текущей версии', 'сообщите сумму списания сотруднику — бонусы списываются сразу')
      .replace('Если в текущей версии включено подтверждение, клиент получает запрос и завершает списание в приложении. При отказе или истечении времени операция не проводится.', 'После сканирования QR сотрудник указывает сумму бонусов и проводит списание сразу. Результат сохраняется в истории операций.')
      .replace('Если QR не читается, обновите экран и попробуйте снова.', 'QR является постоянным. Если он не читается, сотрудник может ввести короткий код вручную.')
      .replace('Версия документа: бета 0.1', 'Версия документа: бета 0.2');
  }

  const pending = $('#pendingModal');
  if (pending) pending.remove();

  if (!$('#consentModal')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal consent-modal" id="consentModal" aria-hidden="true">
      <div class="modal-sheet consent-sheet">
        <span class="consent-mark">П</span>
        <span class="muted">Закрытая бета</span>
        <h2>Добро пожаловать в «Пивник»</h2>
        <p>Продолжая, вы принимаете правила бонусной программы и условия обработки данных для работы приложения.</p>
        <button class="text-btn consent-link" id="openTermsFromConsent" type="button">Открыть справку и правила</button>
        <button class="primary full" id="acceptTerms" type="button">Принять и продолжить</button>
      </div>
    </div>`);
  }
}

enhanceDom();

function requestId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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

function updateNetworkBadge() {
  const badge = $('#networkBadge');
  if (!badge) return;
  const online = navigator.onLine;
  badge.classList.toggle('offline', !online);
  badge.lastChild.textContent = online ? 'онлайн' : 'нет сети';
}

function toast(text) {
  const element = $('#toast');
  element.textContent = text;
  element.classList.add('show');
  clearTimeout(element._timer);
  element._timer = setTimeout(() => element.classList.remove('show'), 2800);
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
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal(id) {
  const modal = $(`#${id}`);
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function switchScreen(target) {
  $$('.screen').forEach((screen) => screen.classList.toggle('active', screen.dataset.screen === target));
  $$('.bottom-nav button').forEach((button) => button.classList.toggle('active', button.dataset.target === target));
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
  $('#showQrButton').lastChild.textContent = design.texts?.qrButton || 'Показать QR';
  $('#byline').textContent = `${design.texts?.byline || 'by Kirill Gamilton'} △`;

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
  if ($('#bonusPercentMirror')) $('#bonusPercentMirror').textContent = `${profile.status.bonusPercent}%`;
  $('#profileAvatar').textContent = (profile.firstName || 'П').slice(0, 1).toUpperCase();
  $('#staffName').textContent = profile.firstName || 'Бармен';

  const min = Number(profile.status.minSpend || 0);
  const next = profile.status.nextSpend;
  if (next) {
    const percentage = Math.max(0, Math.min(100, ((profile.spend12m - min) / (next - min)) * 100));
    const remaining = Math.max(0, next - profile.spend12m);
    $('#statusProgress').style.width = `${percentage}%`;
    $('#statusProgressText').textContent = `${fmt(profile.spend12m)} / ${fmt(next)} ₽`;
    $('#nextRewardText').textContent = `ещё ${fmt(remaining)} ₽`;
  } else {
    $('#statusProgress').style.width = '100%';
    $('#statusProgressText').textContent = 'Максимальный статус';
    $('#nextRewardText').textContent = 'максимум';
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
        <div class="status-level-head"><b>${escapeHtml(level.name)}</b>${current ? '<span>Ваш статус</span>' : ''}</div>
        <small>от ${fmt(level.min)} ₽ за 12 месяцев</small>
        <p>${level.bonusPercent}% бонусами${level.discountPercent ? ` · скидка ${level.discountPercent}%` : ''}</p>
      </div>
      <div class="status-level-mark">${current ? '●' : reached ? '✓' : '○'}</div>
    </article>`;
  }).join('');
}

function renderTransaction(transaction) {
  const isRedeem = transaction.mode === 'redeem';
  const mode = isRedeem ? 'Списание' : transaction.mode === 'adjustment' ? 'Корректировка' : 'Начисление';
  const icon = isRedeem ? '−' : transaction.mode === 'adjustment' ? '±' : '+';
  const primary = transaction.mode === 'adjustment'
    ? `${transaction.bonusEarned ? '+' : '-'}${transaction.bonusEarned || transaction.bonusSpent} Б`
    : `${fmt(transaction.checkAmount)} ₽`;
  const detail = isRedeem
    ? `Списано ${transaction.bonusSpent} Б · начислено ${transaction.bonusEarned} Б`
    : transaction.mode === 'adjustment'
      ? transaction.reason || 'Ручная корректировка'
      : `Начислено ${transaction.bonusEarned} Б · скидка ${fmt(transaction.discount)} ₽`;
  const suspicious = transaction.isSuspicious ? '<span class="op-alert">проверить</span>' : '';
  return `<div class="op-row ${transaction.isSuspicious ? 'suspicious' : ''}">
    <span class="op-icon">${icon}</span>
    <div><b>${mode}${suspicious}</b><small>${new Date(transaction.createdAt).toLocaleString('ru-RU')}<br>${escapeHtml(detail)}</small></div>
    <strong>${primary}</strong>
  </div>`;
}

async function refreshMe() {
  const data = await api('/api/me');
  state.profile = data.profile;
  state.statuses = data.statuses || state.statuses;
  applyDesign(data.design);
  renderProfile();
  renderStatuses();
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

function showConsentIfNeeded() {
  if (!state.profile?.termsAccepted) openModal('consentModal');
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
    await finishBoot();
    showConsentIfNeeded();
  } catch (error) {
    $('#bootText').textContent = error.message;
    $('#bootScreen').classList.add('error');
  }
}

async function acceptTerms() {
  const button = $('#acceptTerms');
  button.disabled = true;
  try {
    const data = await api('/api/me/consent', { method: 'POST', body: '{}' });
    state.profile = data.profile;
    closeModal('consentModal');
    toast('Правила приняты');
  } finally {
    button.disabled = false;
  }
}

async function createQr() {
  const data = await api('/api/me/qr', { method: 'POST', body: '{}' });
  state.qr = data;
  $('#qrImage').src = data.image;
  $('#qrToken').textContent = data.shortCode;
}

async function showQr() {
  openModal('qrModal');
  await createQr();
}

async function copyQrCode() {
  const code = state.qr?.shortCode || $('#qrToken').textContent;
  try {
    await navigator.clipboard.writeText(code);
    toast('Короткий код скопирован');
  } catch {
    toast(`Код: ${code}`);
  }
}

async function showHistory() {
  const data = await api('/api/me/transactions');
  $('#historyList').className = `operation-list${data.transactions.length ? '' : ' empty-state'}`;
  $('#historyList').innerHTML = data.transactions.length ? data.transactions.map(renderTransaction).join('') : 'Операций пока нет';
  openModal('historyModal');
}

async function resolveQr(payload) {
  const data = await api('/api/staff/qr/resolve', { method: 'POST', body: JSON.stringify({ payload }) });
  state.resolvedClient = { qrToken: data.qrToken, shortCode: data.shortCode, profile: data.client };
  $('#scanClient').classList.add('hidden');
  $('#manualCodeButton').classList.add('hidden');
  $('#clientFound').classList.remove('hidden');
  $('#foundName').textContent = `${data.client.firstName} · ${data.client.status.name}`;
  $('#foundMeta').textContent = `${fmt(data.client.balance)} бонусов · ${data.client.status.bonusPercent}% начисление`;
  $('#foundCode').textContent = data.shortCode || data.client.qrShortCode || '';
  $('#foundAvatar').textContent = data.client.firstName.slice(0, 1).toUpperCase();
  updateCalculation();
  haptic('medium');
}

function scanQr() {
  if (tg?.showScanQrPopup) {
    tg.showScanQrPopup({ text: 'Наведите камеру на QR-код клиента' }, (text) => {
      if (!text) return false;
      resolveQr(text)
        .then(() => tg.closeScanQrPopup())
        .catch((error) => toast(error.message));
      return true;
    });
    return;
  }
  manualCode();
}

function manualCode() {
  const code = prompt('Введите короткий код клиента, например PVK-AB12-CD34:');
  if (code?.trim()) resolveQr(code.trim()).catch((error) => toast(error.message));
}

function clearResolvedClient() {
  state.resolvedClient = null;
  $('#scanClient').classList.remove('hidden');
  $('#manualCodeButton').classList.remove('hidden');
  $('#clientFound').classList.add('hidden');
  hideOperationResult();
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
      $('#redeemHint').textContent = `Можно списать до ${fmt(max)} бонусов`;
      cash = amount - requested;
      earn = Math.floor(cash * client.status.bonusPercent / 100);
    }
  }
  $('#cashDue').textContent = `${fmt(Math.max(0, cash))} ₽`;
  $('#bonusEarn').textContent = `+${fmt(earn)}`;
  $('#createSale').disabled = !(amount > 0 && client && !state.saleBusy);
  $('#createSale').textContent = state.saleBusy
    ? 'Проводим…'
    : state.mode === 'redeem' ? 'Списать бонусы' : 'Начислить бонусы';
}

function showOperationResult(transaction, client) {
  const element = $('#operationResult');
  const isRedeem = transaction.mode === 'redeem';
  const title = isRedeem ? 'Бонусы списаны' : 'Бонусы начислены';
  const detail = isRedeem
    ? `−${transaction.bonusSpent} Б · +${transaction.bonusEarned} Б`
    : `+${transaction.bonusEarned} Б`;
  element.innerHTML = `<span class="result-check">✓</span><div><b>${title}</b><small>${escapeHtml(client.firstName)} · ${detail}<br>Новый баланс: ${fmt(client.balance)} Б</small></div>`;
  element.classList.remove('hidden');
  clearTimeout(state.operationResultTimer);
  state.operationResultTimer = setTimeout(() => element.classList.add('hidden'), 6500);
}

function hideOperationResult() {
  $('#operationResult')?.classList.add('hidden');
}

async function createSale() {
  if (state.saleBusy || !state.resolvedClient) return;
  const amount = Number(String($('#saleAmount').value || '').replace(',', '.')) || 0;
  state.saleBusy = true;
  updateCalculation();
  try {
    const data = await api('/api/staff/transactions', {
      method: 'POST',
      body: JSON.stringify({
        qrToken: state.resolvedClient.qrToken,
        amount,
        mode: state.mode,
        bonusToSpend: Number($('#bonusToSpend').value || 0),
        requestKey: requestId()
      })
    });
    showOperationResult(data.transaction, data.client);
    toast(state.mode === 'redeem' ? `Списано ${data.transaction.bonusSpent} бонусов` : `Начислено ${data.transaction.bonusEarned} бонусов`);
    haptic('medium');
    $('#saleAmount').value = '';
    $('#bonusToSpend').value = '';
    state.resolvedClient = { ...state.resolvedClient, profile: data.client };
    $('#foundMeta').textContent = `${fmt(data.client.balance)} бонусов · ${data.client.status.bonusPercent}% начисление`;
  } finally {
    state.saleBusy = false;
    updateCalculation();
  }
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
  const type = transaction.mode === 'redeem' ? 'Списание' : transaction.mode === 'adjustment' ? 'Корректировка' : 'Начисление';
  return `<div class="op-row admin-op ${transaction.isSuspicious ? 'suspicious' : ''}">
    <span class="op-icon">${transaction.mode === 'redeem' ? '−' : transaction.mode === 'adjustment' ? '±' : '+'}</span>
    <div><b>${escapeHtml(client)}${transaction.isSuspicious ? '<span class="op-alert">проверить</span>' : ''}</b><small>${new Date(transaction.createdAt).toLocaleString('ru-RU')} · ${escapeHtml(staff)}<br>${type} · +${transaction.bonusEarned} / −${transaction.bonusSpent} Б</small></div>
    <strong>${fmt(transaction.checkAmount)} ₽</strong>
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
  $('#metricSuspicious').textContent = fmt(summaryData.summary.suspiciousOperations);
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
          <button class="text-btn" data-adjust-user="${user.id}" type="button">Баланс</button>
          <button class="text-btn danger-text" data-reissue-user="${user.id}" type="button">Новый QR</button>
        </div>`
      : `<small>${escapeHtml(user.role)}</small>`;
    return `<div class="user-row">
      <div><b>${escapeHtml(user.name)}</b><small>${escapeHtml(user.telegramId)}${user.username ? ` · @${escapeHtml(user.username)}` : ''}<br>${escapeHtml(user.qrShortCode || 'QR не создан')}</small></div>
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
    const reason = prompt('Причина корректировки:', 'Корректировка владельца');
    if (!reason?.trim()) return;
    try {
      await api(`/api/admin/users/${button.dataset.adjustUser}/adjust`, { method: 'POST', body: JSON.stringify({ amount: Number(amount), reason: reason.trim() }) });
      toast('Баланс изменён');
      await loadAdmin();
    } catch (error) { toast(error.message); }
  }));

  $$('[data-reissue-user]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Перевыпустить личный QR? Старый код перестанет работать.')) return;
    try {
      const data = await api(`/api/admin/users/${button.dataset.reissueUser}/reissue-qr`, { method: 'POST', body: '{}' });
      toast(`Новый код: ${data.shortCode}`);
      await loadAdmin();
    } catch (error) { toast(error.message); }
  }));
}

$$('.bottom-nav button').forEach((button) => button.addEventListener('click', () => switchScreen(button.dataset.target)));
$$('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
$$('.modal:not(.consent-modal)').forEach((modal) => modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(modal.id); }));
$('#showQrButton').addEventListener('click', () => showQr().catch((error) => toast(error.message)));
$('#showHistoryButton').addEventListener('click', () => showHistory().catch((error) => toast(error.message)));
$('#openStatuses').addEventListener('click', () => { renderStatuses(); openModal('statusesModal'); });
$('#openHelpButton').addEventListener('click', () => openModal('helpModal'));
$('#openTermsFromConsent').addEventListener('click', () => openModal('helpModal'));
$('#acceptTerms').addEventListener('click', () => acceptTerms().catch((error) => toast(error.message)));
$('#copyQrCode').addEventListener('click', () => copyQrCode());
$('#refreshButton').addEventListener('click', () => refreshMe().then(() => toast('Данные обновлены')).catch((error) => toast(error.message)));
$('#scanClient').addEventListener('click', scanQr);
$('#manualCodeButton').addEventListener('click', manualCode);
$('#clearClient').addEventListener('click', clearResolvedClient);
$('#saleAmount').addEventListener('input', updateCalculation);
$('#bonusToSpend').addEventListener('input', updateCalculation);
$$('.mode').forEach((button) => button.addEventListener('click', () => {
  state.mode = button.dataset.mode;
  $$('.mode').forEach((item) => item.classList.toggle('active', item === button));
  $('#redeemControls').classList.toggle('hidden', state.mode !== 'redeem');
  hideOperationResult();
  updateCalculation();
}));
$('#createSale').addEventListener('click', () => createSale().catch((error) => toast(error.message)));
$('#saveDraft').addEventListener('click', () => saveDraft().catch((error) => toast(error.message)));
$('#publishDesign').addEventListener('click', () => publishDesign().catch((error) => toast(error.message)));
$('#reloadAdmin').addEventListener('click', () => loadAdmin().catch((error) => toast(error.message)));
$('#reloadUsers').addEventListener('click', () => loadAdmin().catch((error) => toast(error.message)));
$$('[data-design-color], [data-design-text], [data-design-section], [data-design-radius]').forEach((input) => input.addEventListener('input', () => {
  if (input.matches('[data-design-radius]')) $('#radiusValue').textContent = input.value;
  if (state.adminSettings) applyDesign(readDesignForm());
}));
window.addEventListener('online', updateNetworkBadge);
window.addEventListener('offline', updateNetworkBadge);
updateNetworkBadge();
boot();
