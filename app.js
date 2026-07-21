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
  selectedGiftLiters: 0.5,
  operationResultTimer: null,
  currentShift: null,
  shiftStaff: [],
  staffSession: localStorage.getItem('pivnik_staff_session') || '',
  activeStaff: null,
  staffAvailable: [],
  catalog: [],
  promotions: [],
  adminContent: { promotions: [], shopItems: [] },
  editingContent: null,
  selectedShopItem: 'craft-05',
  leaderboard: null,
  staffRecent: [],
  profileDraft: null,
  profileSetupStep: 1,
  beerVolumeConfirmed: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const fmt = (number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(number || 0));
const fmtLiters = (number) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: Number(number) % 1 ? 1 : 0, maximumFractionDigits: 2 }).format(Number(number || 0));
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

const AVATAR_OPTIONS = [
  ['01-panda', 'Панда'], ['02-cat', 'Кот'], ['03-dog', 'Пёс'], ['04-fox', 'Лиса'], ['05-bear', 'Медведь'],
  ['06-rabbit', 'Кролик'], ['07-owl', 'Сова'], ['08-raccoon', 'Енот'], ['09-wolf', 'Волк'], ['10-deer', 'Олень'],
  ['11-koala', 'Коала'], ['12-tiger', 'Тигр'], ['13-red-panda', 'Красная панда'], ['14-penguin', 'Пингвин'],
  ['15-mouse', 'Мышонок'], ['16-dragon', 'Дракон'], ['17-unicorn', 'Единорог'], ['18-griffin', 'Грифон'], ['19-fire-imp', 'Огонёк']
].map(([key, name]) => ({ key, name }));
const AGE_OPTIONS = ['', '18-24', '25-34', '35-44', '45-54', '55+'];

function avatarAssetUrl(entity = {}) {
  const source = entity.avatarSource || 'preset_male';
  if (source === 'telegram' && entity.photoUrl) return entity.photoUrl;
  if (source === 'preset_female') return '/assets/avatars/preset-female.webp?v=12.2';
  if (source === 'animal' && entity.avatarKey) return `/assets/avatars/${encodeURIComponent(entity.avatarKey)}.webp?v=12.2`;
  return '/assets/avatars/preset-male.webp?v=12.2';
}

function avatarFallback(entity = {}) {
  return String(entity.firstName || entity.name || 'П').trim().slice(0, 1).toUpperCase() || 'П';
}

function avatarFrameClass(entity = {}) {
  return entity.profileFrame === 'cosmic' ? 'avatar-frame avatar-frame-cosmic' : entity.profileFrame === 'fire' ? 'avatar-frame avatar-frame-fire' : '';
}

function avatarInlineHtml(entity = {}, className = 'avatar', respectPrivacy = false) {
  const visible = !respectPrivacy || entity.showAvatar !== false;
  const fallback = visible ? avatarFallback(entity) : '•';
  const src = visible ? avatarAssetUrl(entity) : '';
  return `<span class="${className} avatar-render ${avatarFrameClass(entity)}"><span class="avatar-fallback">${escapeHtml(fallback)}</span>${src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
}

function renderAvatarInto(element, entity = {}, respectPrivacy = false) {
  if (!element) return;
  element.innerHTML = avatarInlineHtml(entity, 'avatar-render-inner', respectPrivacy);
}

function profileDraftFromCurrent() {
  const profile = state.profile || {};
  return {
    avatarSource: profile.avatarSource || 'preset_male',
    avatarKey: profile.avatarKey || null,
    ageGroup: profile.ageGroup || '',
    privacy: {
      publicProfile: profile.privacy?.publicProfile !== false,
      showName: profile.privacy?.showName !== false,
      showAvatar: profile.privacy?.showAvatar !== false,
      showMonthlySpend: profile.privacy?.showMonthlySpend !== false,
      showStats: profile.privacy?.showStats !== false
    }
  };
}

function selectedAvatarPreview() {
  return {
    firstName: state.profile?.firstName || 'П',
    photoUrl: state.profile?.photoUrl || null,
    avatarSource: state.profileDraft?.avatarSource || 'preset_male',
    avatarKey: state.profileDraft?.avatarKey || null
  };
}

function renderAnimalPicker() {
  const grid = $('#animalAvatarGrid');
  if (!grid) return;
  grid.innerHTML = AVATAR_OPTIONS.map((item) => `<button type="button" class="animal-avatar-choice ${state.profileDraft?.avatarKey === item.key ? 'active' : ''}" data-animal-avatar="${item.key}">
    <img src="/assets/avatars/${item.key}.webp?v=12.2" alt="${escapeHtml(item.name)}"><small>${escapeHtml(item.name)}</small>
  </button>`).join('');
  grid.querySelectorAll('[data-animal-avatar]').forEach((button) => button.addEventListener('click', () => {
    state.profileDraft.avatarSource = 'animal';
    state.profileDraft.avatarKey = button.dataset.animalAvatar;
    if (!state.profile?.onboardingComplete) state.profileDraft.privacy.showAvatar = true;
    closeModal('animalPickerModal');
    renderProfileSetup();
  }));
}

function renderProfileSetup(step = state.profileSetupStep || 1) {
  state.profileSetupStep = step;
  if (!state.profileDraft) state.profileDraft = profileDraftFromCurrent();
  $('#profileSetupStepAvatar')?.classList.toggle('hidden', step !== 1);
  $('#profileSetupStepPrivacy')?.classList.toggle('hidden', step !== 2);
  $('#profileSetupBack')?.classList.toggle('hidden', step !== 2);
  const close = $('#profileSetupClose');
  if (close) close.classList.toggle('hidden', !state.profile?.onboardingComplete);

  $$('#profileSetupModal [data-avatar-source]').forEach((button) => {
    const source = button.dataset.avatarSource;
    const selected = state.profileDraft.avatarSource === source;
    button.classList.toggle('active', selected);
    if (source === 'telegram') {
      button.disabled = !state.profile?.photoUrl;
      const small = button.querySelector('small');
      if (small) small.textContent = state.profile?.photoUrl ? 'Фото из профиля Telegram' : 'В Telegram нет фото';
    }
  });
  $('#openAnimalPicker')?.classList.toggle('active', state.profileDraft.avatarSource === 'animal');
  const telegramPreview = $('#telegramAvatarPreview');
  if (telegramPreview) {
    if (state.profile?.photoUrl) renderAvatarInto(telegramPreview, { ...state.profile, avatarSource: 'telegram' });
    else telegramPreview.textContent = 'T';
  }
  renderAvatarInto($('#profileSetupPreview'), selectedAvatarPreview());
  const selectedText = $('#profileSetupSelectedText');
  if (selectedText) {
    const source = state.profileDraft.avatarSource;
    selectedText.textContent = source === 'telegram' ? 'Фото Telegram' : source === 'preset_female' ? 'Женский силуэт' : source === 'animal' ? 'Аватар из коллекции' : 'Мужской силуэт';
  }
  $$('#profileAgeOptions [data-age]').forEach((button) => button.classList.toggle('active', button.dataset.age === (state.profileDraft.ageGroup || '')));
  const privacy = state.profileDraft.privacy;
  if ($('#privacyPublicProfile')) $('#privacyPublicProfile').checked = privacy.publicProfile;
  if ($('#privacyShowName')) $('#privacyShowName').checked = privacy.showName;
  if ($('#privacyShowAvatar')) $('#privacyShowAvatar').checked = privacy.showAvatar;
  if ($('#privacyShowSpend')) $('#privacyShowSpend').checked = privacy.showMonthlySpend;
  if ($('#privacyShowStats')) $('#privacyShowStats').checked = privacy.showStats;
}

function openProfileSetup(step = 1) {
  state.profileDraft = profileDraftFromCurrent();
  renderProfileSetup(step);
  renderAnimalPicker();
  openModal('profileSetupModal');
}

function syncPrivacyDraft() {
  if (!state.profileDraft) state.profileDraft = profileDraftFromCurrent();
  state.profileDraft.privacy = {
    publicProfile: Boolean($('#privacyPublicProfile')?.checked),
    showName: Boolean($('#privacyShowName')?.checked),
    showAvatar: Boolean($('#privacyShowAvatar')?.checked),
    showMonthlySpend: Boolean($('#privacyShowSpend')?.checked),
    showStats: Boolean($('#privacyShowStats')?.checked)
  };
}

async function saveProfileSettings() {
  syncPrivacyDraft();
  const button = $('#saveProfileSettings');
  if (button) button.disabled = true;
  try {
    const data = await api('/api/me/profile', { method: 'PUT', body: JSON.stringify(state.profileDraft) });
    state.profile = data.profile;
    state.profileDraft = null;
    closeModal('profileSetupModal');
    renderProfile();
    await loadLeaderboard();
    toast('Профиль сохранён');
  } finally {
    if (button) button.disabled = false;
  }
}


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


  const profileAvatar = $('#profileAvatar');
  if (profileAvatar) {
    profileAvatar.setAttribute('role', 'button');
    profileAvatar.setAttribute('tabindex', '0');
    profileAvatar.setAttribute('aria-label', 'Настроить профиль и аватар');
  }
  const heroActions = $('.hero-actions');
  if (heroActions && !$('#openProfileSettings')) {
    heroActions.insertAdjacentHTML('afterend', '<button class="profile-settings-link" id="openProfileSettings" type="button">Аватар и конфиденциальность</button>');
  }

  if (!$('#profileSetupModal')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal consent-modal profile-setup-modal" id="profileSetupModal" aria-hidden="true">
      <div class="modal-sheet tall-sheet profile-setup-sheet">
        <button class="close" id="profileSetupClose" type="button">×</button>
        <button class="profile-back hidden" id="profileSetupBack" type="button">← Назад</button>
        <section id="profileSetupStepAvatar">
          <span class="muted">Личный профиль</span>
          <h2>Выберите аватар</h2>
          <p class="help-intro">Никаких случайных изображений: выберите вариант сами. Настройки можно изменить позже.</p>
          <div class="primary-avatar-grid">
            <button class="primary-avatar-choice" data-avatar-source="preset_male" type="button"><img src="/assets/avatars/preset-male.webp" alt="Мужской аватар"><b>Мужской</b></button>
            <button class="primary-avatar-choice" data-avatar-source="preset_female" type="button"><img src="/assets/avatars/preset-female.webp" alt="Женский аватар"><b>Женский</b></button>
          </div>
          <div class="secondary-avatar-grid">
            <button class="secondary-avatar-choice" data-avatar-source="telegram" type="button"><span class="telegram-avatar-preview" id="telegramAvatarPreview">T</span><span><b>Фото Telegram</b><small>Фото из профиля Telegram</small></span></button>
            <button class="secondary-avatar-choice" id="openAnimalPicker" type="button"><img src="/assets/avatars/01-panda.webp" alt="Коллекция аватаров"><span><b>Выбрать аватар</b><small>Животные и мифические существа</small></span></button>
          </div>
          <div class="selected-avatar-line"><span id="profileSetupPreview"></span><div><small>Выбрано</small><b id="profileSetupSelectedText">Мужской силуэт</b></div></div>
          <div class="profile-age-block">
            <h3>Возрастная группа <small>по желанию</small></h3>
            <div class="age-option-grid" id="profileAgeOptions">
              <button type="button" data-age="">Не указывать</button><button type="button" data-age="18-24">18–24</button><button type="button" data-age="25-34">25–34</button><button type="button" data-age="35-44">35–44</button><button type="button" data-age="45-54">45–54</button><button type="button" data-age="55+">55+</button>
            </div>
            <p class="privacy-note">Возраст нужен только для внутренней статистики бара и не будет указан в профиле.</p>
          </div>
          <button class="primary full" id="profileSetupNext" type="button">Продолжить</button>
        </section>
        <section class="hidden" id="profileSetupStepPrivacy">
          <span class="muted">Настройки профиля</span>
          <h2>Конфиденциальность</h2>
          <p class="help-intro">Можно оставить в рейтинге только сумму, скрыв имя и аватар, либо запретить открывать подробный профиль.</p>
          <div class="privacy-switches">
            <label><span><b>Публичный профиль</b><small>Другие смогут открыть статистику и достижения</small></span><input id="privacyPublicProfile" type="checkbox" checked></label>
            <label><span><b>Показывать имя</b><small>В рейтинге и публичном профиле</small></span><input id="privacyShowName" type="checkbox" checked></label>
            <label><span><b>Показывать аватар</b><small>Фото Telegram или выбранный аватар</small></span><input id="privacyShowAvatar" type="checkbox" checked></label>
            <label><span><b>Показывать сумму</b><small>Сумма покупок за месяц в таблице лидеров</small></span><input id="privacyShowSpend" type="checkbox" checked></label>
            <label><span><b>Показывать статистику</b><small>Посещения, бонусы и будущие достижения</small></span><input id="privacyShowStats" type="checkbox" checked></label>
          </div>
          <p class="privacy-note">Владелец и сотрудники видят служебные данные, необходимые для начисления и списания бонусов.</p>
          <button class="primary full" id="saveProfileSettings" type="button">Сохранить профиль</button>
        </section>
      </div>
    </div>
    <div class="modal" id="animalPickerModal" aria-hidden="true">
      <div class="modal-sheet tall-sheet animal-picker-sheet">
        <button class="close" data-close="animalPickerModal">×</button>
        <span class="muted">Бесплатная коллекция</span>
        <h2>Выберите аватар</h2>
        <div class="animal-avatar-grid" id="animalAvatarGrid"></div>
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
      ...(state.staffSession ? { 'x-staff-session': state.staffSession } : {}),
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

function renderBeer(profile = state.profile) {
  const beer = profile?.beer;
  if (!beer) return;
  const target = Number(beer.paidTargetLiters || 14);
  const progress = Number(beer.progressLiters || 0);
  const remaining = Math.max(0, Number(beer.nextGiftLiters ?? target));
  const gifts = Number(beer.giftLitersBalance || 0);
  const percentage = Math.max(0, Math.min(100, (progress / target) * 100));
  $('#beerProgressBar').style.width = `${percentage}%`;
  $('#beerProgressText').textContent = `${fmtLiters(progress)} из ${fmtLiters(target)} л`;
  $('#beerRemainingText').textContent = remaining > 0 ? `ещё ${fmtLiters(remaining)} л` : 'подарок готов';
  $('#beerGiftBalance').textContent = fmtLiters(gifts);
  $('#beerGiftReady').textContent = gifts > 0 ? `Доступно ${fmtLiters(gifts)} л` : 'Подарков пока нет';
  $('#beerLoyaltyCard')?.classList.toggle('gift-ready', gifts > 0);
}

function imageMarkup(source, title, className) {
  if (!source) return `<div class="${className} content-image-fallback"><span>${escapeHtml((title || 'П').slice(0, 1).toUpperCase())}</span></div>`;
  return `<div class="${className}"><img data-content-image src="${escapeHtml(source)}" alt="${escapeHtml(title || 'Изображение')}" loading="lazy" /></div>`;
}

function bindContentImageFallbacks(root = document) {
  root.querySelectorAll('img[data-content-image]').forEach((image) => image.addEventListener('error', () => {
    const holder = image.parentElement;
    if (!holder) return;
    holder.classList.add('content-image-fallback');
    holder.innerHTML = '<span>П</span>';
  }, { once: true }));
}

function renderPromotions() {
  const list = $('#promosCatalog');
  if (!list) return;
  list.className = `premium-list${state.promotions.length ? '' : ' empty-state'}`;
  list.innerHTML = state.promotions.length ? state.promotions.map((item, index) => `<article class="premium-offer ${item.active ? 'active-offer' : 'disabled-offer'}">
    ${imageMarkup(item.imageSrc, item.title, 'premium-offer-media')}
    <span class="offer-index">${String(index + 1).padStart(2, '0')}</span>
    <div class="premium-offer-copy"><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.description)}</p><small>${item.active ? 'Доступно сейчас' : 'Недоступно / скоро'}</small></div>
    <strong>${escapeHtml(item.badge || (item.active ? 'Активно' : 'Скоро'))}</strong>
  </article>`).join('') : 'Акций пока нет';
  bindContentImageFallbacks(list);
}

async function loadPromotions() {
  const data = await api('/api/promotions');
  state.promotions = data.promotions || [];
  renderPromotions();
  return state.promotions;
}

function renderShopCatalog() {
  const clientList = $('#shopCatalog');
  if (clientList) {
    clientList.className = `shop-catalog${state.catalog.length ? '' : ' empty-state'}`;
    clientList.innerHTML = state.catalog.length ? state.catalog.map((item, index) => `<article class="shop-product ${item.active ? '' : 'disabled'}">
      ${imageMarkup(item.imageSrc, item.title, 'shop-product-media')}
      <div class="shop-product-number">${String(index + 1).padStart(2, '0')}</div>
      <div class="grow"><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.subtitle)}</p><span>${item.active ? 'Можно получить у сотрудника' : 'После бета-теста'}</span></div>
      <strong>${fmt(item.bonusPrice)} Б</strong>
    </article>`).join('') : 'Каталог пока пуст';
    bindContentImageFallbacks(clientList);
  }
  const staffList = $('#staffShopItems');
  if (staffList) {
    const activeItems = state.catalog.filter((item) => item.active);
    if (!activeItems.some((item) => item.code === state.selectedShopItem)) state.selectedShopItem = activeItems[0]?.code || '';
    staffList.className = `staff-shop-items${activeItems.length ? '' : ' empty-state'}`;
    staffList.innerHTML = activeItems.length ? activeItems.map((item) => `<label class="staff-shop-item">
      <input type="radio" name="staff-shop-item" value="${escapeHtml(item.code)}" ${item.code === state.selectedShopItem ? 'checked' : ''} />
      <span><b>${escapeHtml(item.title)}</b><small>${fmt(item.bonusPrice)} Б</small></span>
    </label>`).join('') : 'Активных товаров пока нет';
    staffList.querySelectorAll('input[name="staff-shop-item"]').forEach((input) => input.addEventListener('change', () => {
      state.selectedShopItem = input.value;
      updateCalculation();
    }));
  }
}

async function loadCatalog() {
  const data = await api('/api/shop/catalog');
  state.catalog = data.items || [];
  if ($('#shopNote') && data.note) $('#shopNote').textContent = data.note;
  renderShopCatalog();
  return state.catalog;
}

function renderLeaderboard() {
  const data = state.leaderboard;
  if (!data) return;
  if ($('#leaderboardMonth')) $('#leaderboardMonth').textContent = data.month;
  const preview = $('#leaderboardPreview');
  if (preview) {
    preview.innerHTML = [1, 2, 3].map((rank) => {
      const leader = data.leaders?.find((item) => item.rank === rank);
      return `<span class="${leader?.isMe ? 'is-me' : ''}"><i>${rank}</i><b>${escapeHtml(leader?.name || 'Пока свободно')}</b></span>`;
    }).join('');
  }
  if ($('#leaderboardMe')) $('#leaderboardMe').textContent = data.me?.spend > 0 ? `Ваше место: №${data.me.rank} · ${fmt(data.me.spend)} ₽` : 'Ваше место появится после первой покупки';
  if ($('#leaderboardModalTitle')) $('#leaderboardModalTitle').textContent = `Лидеры · ${data.month}`;
  if ($('#leaderboardPrizeNote')) $('#leaderboardPrizeNote').textContent = data.prizeNote || 'Награды за 1–3 место будут объявлены позже.';
  const list = $('#leaderboardList');
  if (list) {
    list.className = `leaderboard-list${data.leaders?.length ? '' : ' empty-state'}`;
    list.innerHTML = data.leaders?.length ? data.leaders.map((leader) => `<div class="leaderboard-row ${leader.isMe ? 'is-me' : ''} ${leader.rank <= 3 ? 'podium' : ''}">
      <span class="leader-rank">${leader.rank}</span>
      ${avatarInlineHtml(leader, 'leader-avatar', true)}
      <div><b>${escapeHtml(leader.name)}${leader.isMe ? ' · вы' : ''}</b><small>Покупки за текущий месяц</small></div>
      <strong>${leader.spend === null ? 'Скрыто' : `${fmt(leader.spend)} ₽`}</strong>
    </div>`).join('') : 'Пока нет покупок для рейтинга';
  }
}

async function loadLeaderboard() {
  state.leaderboard = await api('/api/leaderboard/monthly');
  renderLeaderboard();
  return state.leaderboard;
}

function updateResolvedBeer(profile = state.resolvedClient?.profile) {
  const beer = profile?.beer;
  if (!beer) return;
  $('#foundBeer').textContent = `До подарка: ${fmtLiters(beer.nextGiftLiters)} л · доступно ${fmtLiters(beer.giftLitersBalance)} л`;
  $('#staffGiftBalance').textContent = `${fmtLiters(beer.giftLitersBalance)} л`;
  $$('.gift-volume').forEach((button) => {
    const liters = Number(button.dataset.giftLiters || 0);
    button.disabled = liters > Number(beer.giftLitersBalance || 0);
  });
}

function renderCurrentShift() {
  const shift = state.currentShift;
  const container = $('#currentShiftTeam');
  if (container) {
    if (!shift?.members?.length) {
      container.innerHTML = '<div class="person"><span class="avatar">П</span><div><b>Команда Пивника</b><small>Смена пока не выбрана владельцем.</small></div></div>';
    } else {
      const members = shift.members.map((member) => `<div class="shift-person">
        ${avatarInlineHtml(member, 'avatar', true)}
        <div><b>${escapeHtml(member.showName === false ? 'Сотрудник Пивника' : (member.name || member.firstName || 'Сотрудник'))}</b><small>сегодня на смене</small></div>
      </div>`).join('');
      const note = shift.note ? `<div class="shift-team-note">${escapeHtml(shift.note)}</div>` : '';
      container.innerHTML = `<div class="shift-team-grid">${members}</div>${note}`;
    }
  }

  const badge = $('#staffShiftBadge');
  if (badge) {
    const memberIds = new Set((shift?.members || []).map((member) => String(member.id)));
    const onShift = Boolean(state.profile?.id && memberIds.has(String(state.profile.id)));
    badge.classList.toggle('on', onShift);
    badge.classList.toggle('off', !onShift);
    const label = badge.querySelector('span');
    if (label) label.textContent = !shift ? 'смена не выбрана' : onShift ? 'вы на смене' : 'не в составе смены';
  }
}

async function loadCurrentShift() {
  const data = await api('/api/shift/current');
  state.currentShift = data.shift || null;
  renderCurrentShift();
  return state.currentShift;
}

function renderShiftAdmin(data) {
  state.currentShift = data.shift || null;
  state.shiftStaff = data.staff || [];
  renderCurrentShift();
  const selected = new Set((state.currentShift?.members || []).map((member) => String(member.id)));
  const options = $('#shiftStaffOptions');
  if (options) {
    options.className = `shift-staff-options${state.shiftStaff.length ? '' : ' empty-state'}`;
    options.innerHTML = state.shiftStaff.length ? state.shiftStaff.map((staff) => `<label class="shift-staff-option">
      <input type="checkbox" value="${escapeHtml(staff.id)}" ${selected.has(String(staff.id)) ? 'checked' : ''} ${roleCanWrite(state.profile?.role) ? '' : 'disabled'} />
      <span class="avatar">${escapeHtml((staff.firstName || staff.name || 'П').slice(0, 1).toUpperCase())}</span>
      <span><b>${escapeHtml(staff.name || staff.firstName || 'Сотрудник')}</b><small>${staff.role === 'admin' ? 'владелец / админ' : 'сотрудник'}</small></span>
    </label>`).join('') : 'Сначала назначьте сотрудникам роль «Бармен» в разделе пользователей.';
  }
  if ($('#shiftNote')) {
    $('#shiftNote').value = state.currentShift?.note || '';
    $('#shiftNote').disabled = !roleCanWrite(state.profile?.role);
  }
  const badge = $('#shiftStatusBadge');
  if (badge) {
    badge.textContent = state.currentShift?.members?.length ? `${state.currentShift.members.length} на смене` : 'смена не выбрана';
    badge.classList.toggle('active', Boolean(state.currentShift?.members?.length));
  }
  const meta = $('#shiftMeta');
  if (meta) {
    meta.textContent = state.currentShift
      ? `Начата ${new Date(state.currentShift.startedAt).toLocaleString('ru-RU')}. Последнее изменение: ${new Date(state.currentShift.updatedAt).toLocaleString('ru-RU')}.`
      : 'Состав ещё не выбран. Клиенты видят нейтральную заглушку.';
  }
  $('#endShift')?.toggleAttribute('disabled', !roleCanWrite(state.profile?.role) || !state.currentShift);
  $('#saveShift')?.toggleAttribute('disabled', !roleCanWrite(state.profile?.role));
}

async function loadShiftAdmin() {
  if (!roleCanAdmin(state.profile?.role)) return;
  const data = await api('/api/admin/shift');
  renderShiftAdmin(data);
}

async function saveShift() {
  const staffIds = $$('#shiftStaffOptions input[type="checkbox"]:checked').map((input) => input.value);
  if (!staffIds.length) throw new Error('Выберите хотя бы одного сотрудника или нажмите «Завершить смену».');
  const data = await api('/api/admin/shift', {
    method: 'PUT',
    body: JSON.stringify({ staffIds, note: $('#shiftNote')?.value?.trim() || '' })
  });
  state.currentShift = data.shift || null;
  await loadShiftAdmin();
  await loadStaffSession();
  toast('Состав смены сохранён');
  haptic('medium');
}

async function endShift() {
  if (!state.currentShift) return;
  if (!confirm('Завершить текущую смену? Клиентский блок будет очищен.')) return;
  await api('/api/admin/shift', { method: 'PUT', body: JSON.stringify({ staffIds: [], note: '' }) });
  state.currentShift = null;
  await loadShiftAdmin();
  await loadStaffSession();
  toast('Смена завершена');
}

function activeStaffName() {
  const source = state.activeStaff || state.profile;
  return [source?.firstName, source?.lastName].filter(Boolean).join(' ') || 'Бармен';
}

function renderStaffSession() {
  const staffName = $('#staffName');
  if (staffName) staffName.textContent = activeStaffName();
  const button = $('#changeStaffButton');
  if (button) button.textContent = state.activeStaff ? 'Сменить сотрудника / PIN' : 'Сотрудник / PIN';
  const list = $('#staffSessionList');
  if (list) {
    list.className = `staff-session-list${state.staffAvailable.length ? '' : ' empty-state'}`;
    list.innerHTML = state.staffAvailable.length ? state.staffAvailable.map((staff) => {
      const active = String(state.activeStaff?.id || '') === String(staff.id);
      const disabled = !staff.pinConfigured;
      return `<label class="staff-session-option ${disabled ? 'disabled' : ''}">
        <input type="radio" name="staff-session-user" value="${escapeHtml(staff.id)}" ${active ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
        ${avatarInlineHtml(staff, 'avatar')}
        <div><b>${escapeHtml(staff.name || staff.firstName || 'Сотрудник')}</b><small>${disabled ? 'PIN ещё не задан владельцем' : 'PIN настроен'}</small></div>
      </label>`;
    }).join('') : 'В текущей смене нет сотрудников с ролью «Бармен».';
  }
  const clearButton = $('#clearStaffButton');
  if (clearButton) clearButton.classList.toggle('hidden', !state.activeStaff);
}

async function loadStaffSession() {
  if (!roleCanStaff(state.profile?.role)) return;
  const data = await api('/api/staff/session');
  state.staffAvailable = data.available || [];
  state.activeStaff = data.activeStaff || null;
  if (!state.activeStaff && state.staffSession) {
    state.staffSession = '';
    localStorage.removeItem('pivnik_staff_session');
  }
  renderStaffSession();
}

async function activateStaff() {
  const selected = $('#staffSessionList input[name="staff-session-user"]:checked');
  const pin = $('#staffPinInput')?.value?.trim() || '';
  if (!selected) throw new Error('Выберите сотрудника.');
  if (!/^\d{4,6}$/.test(pin)) throw new Error('Введите PIN из 4–6 цифр.');
  const data = await api('/api/staff/activate', {
    method: 'POST',
    body: JSON.stringify({ userId: selected.value, pin }),
    headers: { 'x-staff-session': '' }
  });
  state.staffSession = data.token;
  state.activeStaff = data.staff;
  localStorage.setItem('pivnik_staff_session', state.staffSession);
  $('#staffPinInput').value = '';
  renderStaffSession();
  closeModal('staffLoginModal');
  toast(`Смена: ${activeStaffName()}`);
  haptic('medium');
  await loadStaffRecent();
}

function clearStaffSession() {
  state.staffSession = '';
  state.activeStaff = null;
  localStorage.removeItem('pivnik_staff_session');
  renderStaffSession();
  closeModal('staffLoginModal');
  toast('Используется текущий Telegram-аккаунт');
}

function renderAchievements() {
  const section = $('#creatorAchievementSection');
  const profile = state.profile;
  const creator = profile?.achievements?.find((item) => item.code === 'creator');
  if (!section) return;
  section.classList.toggle('hidden', !creator);
  if (!creator) return;
  $('#creatorAchievementTitle').textContent = creator.title;
  $('#creatorAchievementRarity').textContent = creator.rarity;
  $('#creatorAchievementDescription').textContent = creator.description;
}

function renderProfile() {
  const profile = state.profile;
  if (!profile) return;
  $('#eyebrow').textContent = `${profile.firstName}${profile.username ? ` · @${profile.username}` : ''}`;
  $('#clientBalance').textContent = fmt(profile.balance);
  $('#statusName').textContent = profile.status.name;
  $('#bonusPercent').textContent = `${profile.status.bonusPercent}% бонусами`;
  if ($('#bonusPercentMirror')) $('#bonusPercentMirror').textContent = `${profile.status.bonusPercent}%`;
  renderAvatarInto($('#profileAvatar'), profile);
  renderAchievements();
  $('#staffName').textContent = activeStaffName();
  renderBeer(profile);

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
  const partnerView = profile.role === 'viewer';
  $('#adminRoleBadge').textContent = partnerView ? 'ПАРТНЁР' : 'ВЛАДЕЛЕЦ';
  $('#adminAccessLabel').textContent = partnerView ? 'Полный обзор · без изменений' : 'Полный доступ';
  if ($('#adminPanelTitle')) $('#adminPanelTitle').textContent = partnerView ? 'Партнёрский обзор' : 'Панель владельца';
  $$('.admin-write-only').forEach((element) => element.classList.toggle('hidden', !roleCanWrite(profile.role)));
  $$('.owner-only').forEach((element) => element.classList.toggle('hidden', !roleCanWrite(profile.role)));
  renderCurrentShift();
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
  const cancelled = transaction.status === 'cancelled';
  const labels = {
    accrue: ['Начисление', '+'],
    redeem: ['Списание', '−'],
    adjustment: ['Корректировка', '±'],
    beer_gift: ['Подарочный литр', '🍺'],
    welcome: ['Приветственный бонус', '100'],
    shop: ['Покупка в магазине', '□']
  };
  const [mode, icon] = labels[transaction.mode] || ['Операция', '•'];
  let primary = `${fmt(transaction.checkAmount)} ₽`;
  let detail = '';
  if (transaction.mode === 'beer_gift') {
    primary = `${fmtLiters(transaction.beerGiftSpentLiters)} л`;
    detail = `Бесплатно выдано ${fmtLiters(transaction.beerGiftSpentLiters)} л разливного пива`;
  } else if (transaction.mode === 'welcome') {
    primary = `+${transaction.bonusEarned} Б`;
    detail = transaction.reason || 'Бонус за первую регистрацию';
  } else if (transaction.mode === 'shop') {
    primary = `−${transaction.bonusSpent} Б`;
    detail = transaction.reason || 'Товар из магазина';
  } else if (transaction.mode === 'adjustment') {
    primary = `${transaction.bonusEarned ? '+' : '-'}${transaction.bonusEarned || transaction.bonusSpent} Б`;
    detail = transaction.reason || 'Ручная корректировка';
  } else {
    const beerDetails = transaction.beerLiters > 0
      ? ` · пиво ${fmtLiters(transaction.beerLiters)} л${transaction.beerGiftEarnedLiters ? ` · подарок +${fmtLiters(transaction.beerGiftEarnedLiters)} л` : ''}`
      : '';
    detail = transaction.mode === 'redeem'
      ? `Списано ${transaction.bonusSpent} Б · начислено ${transaction.bonusEarned} Б${beerDetails}`
      : `Начислено ${transaction.bonusEarned} Б · скидка ${fmt(transaction.discount)} ₽${beerDetails}`;
  }
  if (cancelled) detail = `ОТМЕНЕНО · ${transaction.cancelReason || 'причина указана в журнале'} · ${detail}`;
  const suspicious = transaction.isSuspicious ? '<span class="op-alert">проверить</span>' : '';
  return `<div class="op-row ${transaction.isSuspicious ? 'suspicious' : ''} ${cancelled ? 'cancelled' : ''}">
    <span class="op-icon">${icon}</span>
    <div><b>${mode}${cancelled ? '<span class="op-cancelled">отменено</span>' : ''}${suspicious}</b><small>${new Date(transaction.createdAt).toLocaleString('ru-RU')}<br>${escapeHtml(detail)}</small></div>
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
  await Promise.all([loadCurrentShift(), loadPromotions(), loadCatalog(), loadLeaderboard()]);
  if (roleCanStaff(state.profile?.role)) {
    await loadStaffSession();
    await loadStaffRecent();
  }
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

function showRequiredSetup() {
  if (!state.profile?.termsAccepted) {
    openModal('consentModal');
    return;
  }
  if (!state.profile?.onboardingComplete) openProfileSetup(1);
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
    $('#bootText').textContent = 'Проверяем текущую смену…';
    await Promise.all([loadCurrentShift(), loadPromotions(), loadCatalog(), loadLeaderboard()]);
    if (roleCanStaff(state.profile?.role)) {
      await loadStaffSession();
      await loadStaffRecent();
    }
    await finishBoot();
    showRequiredSetup();
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
    if (!state.profile?.onboardingComplete) openProfileSetup(1);
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
  renderAvatarInto($('#foundAvatar'), data.client);
  updateResolvedBeer(data.client);
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

function staffRecentHtml(transaction, quota) {
  const cancelled = transaction.status === 'cancelled';
  const canCancel = !cancelled && ['accrue', 'redeem', 'beer_gift', 'shop'].includes(transaction.mode) && quota?.active && quota.remaining > 0;
  const type = transaction.mode === 'beer_gift' ? 'Подарок' : transaction.mode === 'shop' ? 'Магазин' : transaction.mode === 'redeem' ? 'Списание' : 'Начисление';
  const value = transaction.mode === 'beer_gift' ? `${fmtLiters(transaction.beerGiftSpentLiters)} л` : transaction.mode === 'shop' ? `${transaction.bonusSpent} Б` : `${fmt(transaction.checkAmount)} ₽`;
  return `<div class="op-row staff-recent-op ${cancelled ? 'cancelled' : ''}">
    <span class="op-icon">${cancelled ? '×' : '✓'}</span>
    <div><b>${escapeHtml(transaction.clientName || 'Клиент')} · ${type}</b><small>${new Date(transaction.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}${cancelled ? `<br>Отменено: ${escapeHtml(transaction.cancelReason || '')}` : ''}</small></div>
    <strong>${value}</strong>
    ${canCancel ? `<button class="text-btn danger-text cancel-operation-button" data-staff-cancel="${transaction.id}" type="button">Отменить</button>` : ''}
  </div>`;
}

function renderStaffRecent(data) {
  state.staffRecent = data.transactions || [];
  const quota = data.quota || { active: false, limit: 3, used: 0, remaining: 0 };
  if ($('#staffCancelQuota')) $('#staffCancelQuota').textContent = quota.active
    ? `Отмены: ${quota.used} из ${quota.limit} · осталось ${quota.remaining}`
    : 'Отмены доступны только в активной смене';
  const list = $('#staffRecentOperations');
  if (!list) return;
  list.className = `operation-list${state.staffRecent.length ? '' : ' empty-state'}`;
  list.innerHTML = state.staffRecent.length ? state.staffRecent.map((tx) => staffRecentHtml(tx, quota)).join('') : 'Операций этой смены пока нет';
  list.querySelectorAll('[data-staff-cancel]').forEach((button) => button.addEventListener('click', async () => {
    const reason = prompt('Причина отмены операции:');
    if (!reason?.trim()) return;
    try {
      const result = await api(`/api/staff/transactions/${button.dataset.staffCancel}/cancel`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      if (state.resolvedClient?.profile?.id === result.client?.id) {
        state.resolvedClient.profile = result.client;
        $('#foundMeta').textContent = `${fmt(result.client.balance)} бонусов · ${result.client.status.bonusPercent}% начисление`;
        updateResolvedBeer(result.client);
      }
      toast('Операция отменена');
      await Promise.all([loadStaffRecent(), loadLeaderboard()]);
    } catch (error) { toast(error.message); }
  }));
}

async function loadStaffRecent() {
  if (!roleCanStaff(state.profile?.role)) return;
  const data = await api('/api/staff/recent');
  renderStaffRecent(data);
}

function updateCalculation() {
  const amount = Number(String($('#saleAmount').value || '').replace(',', '.')) || 0;
  const client = state.resolvedClient?.profile;
  const isGift = state.mode === 'beerGift';
  const isShop = state.mode === 'shop';
  const shopItem = state.catalog.find((item) => item.code === state.selectedShopItem && item.active);
  let cash = (isGift || isShop) ? 0 : amount;
  let earn = 0;
  if (client && amount > 0 && !isGift && !isShop) {
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
  $('#cashDue').textContent = (isGift || isShop) ? '0 ₽' : `${fmt(Math.max(0, cash))} ₽`;
  $('#bonusEarn').textContent = isGift ? 'подарок' : isShop ? `−${fmt(shopItem?.bonusPrice || 0)} Б` : `+${fmt(earn)}`;
  const giftAvailable = Number(client?.beer?.giftLitersBalance || 0) >= Number(state.selectedGiftLiters || 0.5);
  const shopAvailable = Boolean(client && shopItem && Number(client.balance || 0) >= Number(shopItem.bonusPrice || 0));
  const beerConfirmed = state.beerVolumeConfirmed;
  $('#createSale').disabled = isGift
    ? !(client && giftAvailable && !state.saleBusy)
    : isShop ? !(shopAvailable && !state.saleBusy)
      : !(amount > 0 && client && beerConfirmed && !state.saleBusy);
  const beerHint = $('#beerVolumeHint');
  if (beerHint && !isGift && !isShop) {
    beerHint.textContent = beerConfirmed
      ? `Учтём ${fmtLiters(Number(String($('#beerLiters').value || '0').replace(',', '.')) || 0)} л`
      : 'Обязательно выберите объём или «Без разливного»';
    beerHint.classList.toggle('confirmed', beerConfirmed);
  }
  $('#createSale').textContent = state.saleBusy
    ? 'Проводим…'
    : isGift ? `Выдать ${fmtLiters(state.selectedGiftLiters)} л бесплатно`
      : isShop ? shopItem ? `Списать ${fmt(shopItem.bonusPrice)} Б и выдать` : 'Выберите товар'
        : state.mode === 'redeem' ? 'Списать бонусы' : 'Начислить бонусы';
  $('#saleAmount').disabled = isGift || isShop;
  $('#beerLiters').disabled = isGift || isShop;
  $('.staff-step')?.classList.toggle('gift-operation-active', isGift || isShop);
}

function showOperationResult(transaction, client) {
  const element = $('#operationResult');
  const isRedeem = transaction.mode === 'redeem';
  const isGift = transaction.mode === 'beer_gift';
  const isShop = transaction.mode === 'shop';
  const title = isShop ? 'Товар выдан' : isGift ? 'Подарок выдан' : isRedeem ? 'Бонусы списаны' : 'Операция проведена';
  const beerLine = transaction.beerLiters > 0
    ? `<br>Учтено пива: ${fmtLiters(transaction.beerLiters)} л${transaction.beerGiftEarnedLiters ? ` · подарок +${fmtLiters(transaction.beerGiftEarnedLiters)} л` : ''}`
    : '';
  const detail = isShop
    ? `${escapeHtml(transaction.reason || 'Товар')} · −${transaction.bonusSpent} Б`
    : isGift
      ? `−${fmtLiters(transaction.beerGiftSpentLiters)} л подарка`
      : isRedeem
        ? `−${transaction.bonusSpent} Б · +${transaction.bonusEarned} Б${beerLine}`
        : `+${transaction.bonusEarned} Б${beerLine}`;
  const footer = isGift
    ? `Осталось подарочного объёма: ${fmtLiters(client.beer?.giftLitersBalance)} л`
    : `Новый баланс: ${fmt(client.balance)} Б`;
  element.innerHTML = `<span class="result-check">✓</span><div><b>${title}</b><small>${escapeHtml(client.firstName)} · ${detail}<br>${footer}</small></div>`;
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
  const beerLiters = Number(String($('#beerLiters').value || '').replace(',', '.')) || 0;
  const isGift = state.mode === 'beerGift';
  const isShop = state.mode === 'shop';
  if (!isGift && !isShop && !state.beerVolumeConfirmed) {
    toast('Выберите объём разливного или «Без разливного»');
    $('#beerLiters')?.focus();
    return;
  }
  state.saleBusy = true;
  updateCalculation();
  try {
    const path = isGift ? '/api/staff/beer-gift' : isShop ? '/api/staff/shop/purchase' : '/api/staff/transactions';
    const body = isGift ? {
      qrToken: state.resolvedClient.qrToken,
      giftLiters: state.selectedGiftLiters,
      requestKey: requestId()
    } : isShop ? {
      qrToken: state.resolvedClient.qrToken,
      itemCode: state.selectedShopItem,
      requestKey: requestId()
    } : {
      qrToken: state.resolvedClient.qrToken,
      amount,
      beerLiters,
      mode: state.mode,
      bonusToSpend: Number($('#bonusToSpend').value || 0),
      requestKey: requestId()
    };
    const data = await api(path, { method: 'POST', body: JSON.stringify(body) });
    showOperationResult(data.transaction, data.client);
    const message = isShop
      ? `Списано ${data.transaction.bonusSpent} Б · товар выдан`
      : isGift
        ? `Выдано ${fmtLiters(data.transaction.beerGiftSpentLiters)} л бесплатно`
        : state.mode === 'redeem'
          ? `Списано ${data.transaction.bonusSpent} бонусов`
          : data.transaction.beerGiftEarnedLiters
            ? `Начислено ${data.transaction.bonusEarned} Б и ${fmtLiters(data.transaction.beerGiftEarnedLiters)} л подарка`
            : `Начислено ${data.transaction.bonusEarned} бонусов`;
    toast(message);
    haptic('medium');
    $('#saleAmount').value = '';
    $('#beerLiters').value = '';
    state.beerVolumeConfirmed = false;
    $$('[data-beer-liters]').forEach((item) => item.classList.remove('active'));
    $('#bonusToSpend').value = '';
    state.resolvedClient = { ...state.resolvedClient, profile: data.client };
    $('#foundMeta').textContent = `${fmt(data.client.balance)} бонусов · ${data.client.status.bonusPercent}% начисление`;
    updateResolvedBeer(data.client);
    if (state.profile?.id === data.client.id) {
      state.profile = data.client;
      renderProfile();
    }
    await Promise.all([loadStaffRecent(), loadLeaderboard()]);
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
  const cancelled = transaction.status === 'cancelled';
  const type = transaction.mode === 'beer_gift' ? 'Подарочный литр'
    : transaction.mode === 'shop' ? 'Магазин'
      : transaction.mode === 'welcome' ? 'Приветственный бонус'
        : transaction.mode === 'redeem' ? 'Списание'
          : transaction.mode === 'adjustment' ? 'Корректировка' : 'Начисление';
  const beerInfo = transaction.mode === 'beer_gift'
    ? ` · −${fmtLiters(transaction.beerGiftSpentLiters)} л подарка`
    : transaction.beerLiters ? ` · ${fmtLiters(transaction.beerLiters)} л${transaction.beerGiftEarnedLiters ? ` · +${fmtLiters(transaction.beerGiftEarnedLiters)} л подарка` : ''}` : '';
  const canCancel = roleCanWrite(state.profile?.role) && !cancelled && ['accrue', 'redeem', 'beer_gift', 'shop'].includes(transaction.mode);
  return `<div class="op-row admin-op ${transaction.isSuspicious ? 'suspicious' : ''} ${cancelled ? 'cancelled' : ''}">
    <span class="op-icon">${cancelled ? '×' : transaction.mode === 'beer_gift' ? '🍺' : transaction.mode === 'shop' ? '□' : transaction.mode === 'redeem' ? '−' : transaction.mode === 'adjustment' ? '±' : '+'}</span>
    <div><b>${escapeHtml(client)}${cancelled ? '<span class="op-cancelled">отменено</span>' : ''}${transaction.isSuspicious ? '<span class="op-alert">проверить</span>' : ''}</b><small>${new Date(transaction.createdAt).toLocaleString('ru-RU')} · ${escapeHtml(staff)}<br>${type} · +${transaction.bonusEarned} / −${transaction.bonusSpent} Б${beerInfo}${cancelled ? `<br>Причина: ${escapeHtml(transaction.cancelReason || '')}` : ''}</small></div>
    <strong>${transaction.mode === 'beer_gift' ? `${fmtLiters(transaction.beerGiftSpentLiters)} л` : transaction.mode === 'shop' ? `${transaction.bonusSpent} Б` : `${fmt(transaction.checkAmount)} ₽`}</strong>
    ${canCancel ? `<button class="text-btn danger-text admin-cancel-button" data-admin-cancel="${transaction.id}" type="button">Отменить</button>` : ''}
  </div>`;
}

async function loadAdmin() {
  if (!roleCanAdmin(state.profile?.role)) return;
  const [summaryData, usersData, shiftData, contentData] = await Promise.all([
    api('/api/admin/summary'), api('/api/admin/users'), api('/api/admin/shift'), api('/api/admin/content')
  ]);
  state.adminSettings = summaryData.settings;
  $('#metricClients').textContent = fmt(summaryData.summary.clients);
  $('#metricIssued').textContent = fmt(summaryData.summary.issued);
  $('#metricToday').textContent = `${fmt(summaryData.summary.todayCheck)} ₽`;
  $('#metricTodayOps').textContent = `${summaryData.summary.todayOperations} операций`;
  $('#metricSuspicious').textContent = fmt(summaryData.summary.suspiciousOperations);
  if ($('#metricCancelled')) $('#metricCancelled').textContent = fmt(summaryData.summary.cancelledToday);
  $('#adminOperations').className = `operation-list${summaryData.operations.length ? '' : ' empty-state'}`;
  $('#adminOperations').innerHTML = summaryData.operations.length ? summaryData.operations.map(adminTransactionHtml).join('') : 'Операций пока нет';
  $('#adminOperations').querySelectorAll('[data-admin-cancel]').forEach((button) => button.addEventListener('click', async () => {
    const reason = prompt('Причина отмены операции владельцем:');
    if (!reason?.trim()) return;
    try {
      await api(`/api/admin/transactions/${button.dataset.adminCancel}/cancel`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      toast('Операция отменена');
      await Promise.all([loadAdmin(), loadLeaderboard()]);
    } catch (error) { toast(error.message); }
  }));
  if (roleCanWrite(state.profile?.role)) fillDesignForm(summaryData.settings.draft);
  renderUsers(usersData.users);
  renderShiftAdmin(shiftData);
  renderAdminContent(contentData);
}

function renderAdminContent(data = state.adminContent) {
  state.adminContent = { promotions: data?.promotions || [], shopItems: data?.shopItems || [] };
  const canWrite = roleCanWrite(state.profile?.role);
  const build = (items, type) => items.length ? items.map((item) => `<div class="admin-content-row ${item.active ? '' : 'inactive'}">
    ${imageMarkup(item.imageSrc, item.title, 'admin-content-thumb')}
    <div><b>${escapeHtml(item.title)}</b><small>${type === 'shop' ? `${fmt(item.bonusPrice)} Б` : escapeHtml(item.badge || 'Без подписи')} · ${item.active ? 'показывается' : 'скрыто'} · порядок ${item.sortOrder}</small></div>
    ${canWrite ? `<div class="admin-content-buttons"><button class="text-btn" data-content-edit="${type}" data-content-id="${item.id}" type="button">Изменить</button><button class="text-btn danger-text" data-content-delete="${type}" data-content-id="${item.id}" type="button">Удалить</button></div>` : '<small>Только просмотр</small>'}
  </div>`).join('') : 'Пока пусто';
  const promos = $('#adminPromotionsList');
  const shop = $('#adminShopItemsList');
  if (promos) { promos.className = `admin-content-list${state.adminContent.promotions.length ? '' : ' empty-state'}`; promos.innerHTML = build(state.adminContent.promotions, 'promotion'); bindContentImageFallbacks(promos); }
  if (shop) { shop.className = `admin-content-list${state.adminContent.shopItems.length ? '' : ' empty-state'}`; shop.innerHTML = build(state.adminContent.shopItems, 'shop'); bindContentImageFallbacks(shop); }
  $$('[data-content-edit]').forEach((button) => button.addEventListener('click', () => openContentEditor(button.dataset.contentEdit, button.dataset.contentId)));
  $$('[data-content-delete]').forEach((button) => button.addEventListener('click', () => deleteContentItem(button.dataset.contentDelete, button.dataset.contentId)));
}

async function reloadContent() {
  const data = await api('/api/admin/content');
  renderAdminContent(data);
  await Promise.all([loadPromotions(), loadCatalog()]);
}

function findContentItem(type, id) {
  const list = type === 'promotion' ? state.adminContent.promotions : state.adminContent.shopItems;
  return list.find((item) => String(item.id) === String(id)) || null;
}

function updateContentImagePreview() {
  const preview = $('#contentImagePreview');
  const source = state.editingContent?.imageSrc || '';
  if (!preview) return;
  preview.innerHTML = source ? `<img data-content-image src="${escapeHtml(source)}" alt="Предпросмотр" />` : '<span>Без фото</span>';
  preview.classList.toggle('has-image', Boolean(source));
  bindContentImageFallbacks(preview);
}

function openContentEditor(type, id = '') {
  if (!roleCanWrite(state.profile?.role)) return toast('Редактирование доступно только владельцу');
  const item = id ? findContentItem(type, id) : null;
  state.editingContent = { type, id: item?.id || '', imageSrc: item?.imageSrc || '', fileName: '' };
  $('#contentEditorType').value = type;
  $('#contentEditorId').value = item?.id || '';
  $('#contentEditorTitle').textContent = `${item ? 'Редактировать' : 'Добавить'} ${type === 'promotion' ? 'акцию' : 'товар'}`;
  $('#contentTitle').value = item?.title || '';
  $('#contentDescription').value = type === 'promotion' ? (item?.description || '') : (item?.subtitle || '');
  $('#contentBadge').value = item?.badge || '';
  $('#contentPrice').value = item?.bonusPrice || (type === 'shop' ? 600 : '');
  $('#contentSortOrder').value = item?.sortOrder ?? 10;
  $('#contentActive').checked = item?.active !== false;
  $('#contentImageUrl').value = item?.imageSrc?.startsWith('https://') ? item.imageSrc : '';
  $('#contentImageFile').value = '';
  $('#contentImageFileName').textContent = 'JPG, PNG или WEBP · до 6 МБ';
  $('#contentBadgeRow').classList.toggle('hidden', type !== 'promotion');
  $('#contentPriceRow').classList.toggle('hidden', type !== 'shop');
  updateContentImagePreview();
  openModal('contentEditorModal');
}

async function imageFileToDataUrl(file) {
  if (!file) return '';
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) throw new Error('Разрешены только JPG, PNG и WEBP.');
  if (file.size > 6 * 1024 * 1024) throw new Error('Исходный файл должен быть не больше 6 МБ.');
  const raw = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Файл изображения повреждён.'));
    img.src = raw;
  });
  let maxSide = 1280;
  let quality = 0.84;
  let output = '';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    output = canvas.toDataURL('image/webp', quality);
    if (output.length < 2_700_000) return output;
    maxSide = Math.max(640, Math.round(maxSide * 0.82));
    quality = Math.max(0.58, quality - 0.07);
  }
  if (output.length >= 3_000_000) throw new Error('Фотография слишком сложная. Выберите изображение меньшего размера.');
  return output;
}

async function saveContentItem() {
  const type = state.editingContent?.type;
  if (!type) return;
  const title = $('#contentTitle').value.trim();
  if (!title) return toast('Укажите название');
  const url = $('#contentImageUrl').value.trim();
  if (url && !/^https:\/\//i.test(url)) return toast('Ссылка должна начинаться с https://');
  const imageSrc = url || state.editingContent.imageSrc || '';
  const payload = {
    title,
    active: $('#contentActive').checked,
    sortOrder: Number($('#contentSortOrder').value || 0),
    imageSrc
  };
  if (type === 'promotion') {
    payload.description = $('#contentDescription').value.trim();
    payload.badge = $('#contentBadge').value.trim();
  } else {
    payload.subtitle = $('#contentDescription').value.trim();
    payload.bonusPrice = Number($('#contentPrice').value || 0);
    if (payload.bonusPrice < 1) return toast('Укажите цену в бонусах');
  }
  const id = state.editingContent.id;
  const base = type === 'promotion' ? '/api/admin/promotions' : '/api/admin/shop-items';
  const button = $('#saveContentItem');
  button.disabled = true;
  try {
    await api(id ? `${base}/${id}` : base, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    closeModal('contentEditorModal');
    toast(type === 'promotion' ? 'Акция сохранена' : 'Товар сохранён');
    await reloadContent();
  } finally {
    button.disabled = false;
  }
}

async function deleteContentItem(type, id) {
  if (!roleCanWrite(state.profile?.role)) return;
  const item = findContentItem(type, id);
  if (!confirm(`Удалить «${item?.title || 'эту карточку'}»?`)) return;
  const base = type === 'promotion' ? '/api/admin/promotions' : '/api/admin/shop-items';
  await api(`${base}/${id}`, { method: 'DELETE' });
  toast(type === 'promotion' ? 'Акция удалена' : 'Товар удалён');
  await reloadContent();
}

function openContentAdmin() {
  closeModal('promosModal');
  closeModal('shopModal');
  switchScreen('admin');
  setTimeout(() => $('#contentAdminCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
}

function renderUsers(users) {
  $('#usersList').className = `operation-list${users.length ? '' : ' empty-state'}`;
  $('#usersList').innerHTML = users.map((user) => {
    const controls = roleCanWrite(state.profile.role) && user.role !== 'admin'
      ? `<div class="user-actions">
          <select data-role-user="${user.id}">
            <option value="client" ${user.role === 'client' ? 'selected' : ''}>Клиент</option>
            <option value="staff" ${user.role === 'staff' ? 'selected' : ''}>Бармен</option>
            <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Партнёрский обзор</option>
          </select>
          <button class="text-btn" data-adjust-user="${user.id}" type="button">Баланс</button>
          ${user.role === 'staff' ? `<button class="text-btn" data-pin-user="${user.id}" type="button">${user.pinConfigured ? 'Сменить PIN' : 'Задать PIN'}</button><button class="text-btn" data-reset-cancel-user="${user.id}" type="button">Сбросить отмены</button>` : ''}
          <button class="text-btn danger-text" data-reissue-user="${user.id}" type="button">Новый QR</button>
        </div>`
      : `<small>${user.role === 'viewer' ? 'Партнёр · полный обзор' : user.role === 'staff' ? 'Бармен' : escapeHtml(user.role)}</small>`;
    return `<div class="user-row">
      <div><b>${escapeHtml(user.name)}</b><small>${escapeHtml(user.telegramId)}${user.username ? ` · @${escapeHtml(user.username)}` : ''}<br>${escapeHtml(user.qrShortCode || 'QR не создан')} · пиво ${fmtLiters(user.beerPaidLitersTotal)} л · подарок ${fmtLiters(user.beerGiftLitersBalance)} л${user.role === 'staff' ? `<br><span class="user-pin-state">${user.pinConfigured ? 'PIN настроен' : 'PIN не задан'}</span>` : ''}</small></div>
      <strong>${fmt(user.balance)} Б${user.unlimitedBonus ? '<small class="unlimited-mark">∞ безлимит</small>' : ''}</strong>
      ${controls}
    </div>`;
  }).join('');

  $$('[data-role-user]').forEach((select) => select.addEventListener('change', async () => {
    try {
      await api(`/api/admin/users/${select.dataset.roleUser}/role`, { method: 'POST', body: JSON.stringify({ role: select.value }) });
      toast('Роль обновлена');
      await loadAdmin();
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

  $$('[data-pin-user]').forEach((button) => button.addEventListener('click', async () => {
    const pin = prompt('Новый PIN сотрудника: 4–6 цифр');
    if (pin === null) return;
    if (!/^\d{4,6}$/.test(pin.trim())) return toast('PIN должен содержать 4–6 цифр');
    const confirmPin = prompt('Повторите PIN:');
    if (confirmPin !== pin) return toast('PIN-коды не совпадают');
    try {
      await api(`/api/admin/users/${button.dataset.pinUser}/pin`, { method: 'POST', body: JSON.stringify({ pin }) });
      toast('PIN сотрудника сохранён');
      await loadAdmin();
    } catch (error) { toast(error.message); }
  }));

  $$('[data-reset-cancel-user]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Сбросить лимит отмен этого сотрудника на текущую смену?')) return;
    try {
      await api(`/api/admin/users/${button.dataset.resetCancelUser}/cancel-limit/reset`, { method: 'POST', body: '{}' });
      toast('Сотруднику снова доступны 3 отмены');
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

$('#openProfileSettings')?.addEventListener('click', () => openProfileSetup(1));
$('#profileAvatar')?.addEventListener('click', () => openProfileSetup(1));
$('#profileAvatar')?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') openProfileSetup(1); });
$('#profileSetupClose')?.addEventListener('click', () => { if (state.profile?.onboardingComplete) closeModal('profileSetupModal'); });
$('#profileSetupBack')?.addEventListener('click', () => renderProfileSetup(1));
$('#profileSetupNext')?.addEventListener('click', () => renderProfileSetup(2));
$('#saveProfileSettings')?.addEventListener('click', () => saveProfileSettings().catch((error) => toast(error.message)));
$('#openAnimalPicker')?.addEventListener('click', () => { renderAnimalPicker(); openModal('animalPickerModal'); });
$$('#profileSetupModal [data-avatar-source]').forEach((button) => button.addEventListener('click', () => {
  if (button.disabled) return;
  state.profileDraft = state.profileDraft || profileDraftFromCurrent();
  state.profileDraft.avatarSource = button.dataset.avatarSource;
  state.profileDraft.avatarKey = null;
  if (!state.profile?.onboardingComplete) state.profileDraft.privacy.showAvatar = button.dataset.avatarSource !== 'telegram';
  renderProfileSetup();
}));
$$('#profileAgeOptions [data-age]').forEach((button) => button.addEventListener('click', () => {
  state.profileDraft = state.profileDraft || profileDraftFromCurrent();
  state.profileDraft.ageGroup = button.dataset.age || '';
  renderProfileSetup();
}));
['privacyPublicProfile','privacyShowName','privacyShowAvatar','privacyShowSpend','privacyShowStats'].forEach((id) => {
  $(`#${id}`)?.addEventListener('change', syncPrivacyDraft);
});

$('#creatorAchievementCard')?.addEventListener('click', () => {
  const card = $('#creatorAchievementCard');
  const expanded = !card.classList.contains('expanded');
  card.classList.toggle('expanded', expanded);
  card.setAttribute('aria-expanded', String(expanded));
});

$$('.bottom-nav button').forEach((button) => button.addEventListener('click', () => switchScreen(button.dataset.target)));
$$('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
$$('.modal:not(.consent-modal)').forEach((modal) => modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(modal.id); }));
$('#openPromosButton').addEventListener('click', () => { renderPromotions(); openModal('promosModal'); });
$('#openShopButton').addEventListener('click', () => { renderShopCatalog(); openModal('shopModal'); });
$('#openLeaderboardButton').addEventListener('click', () => { renderLeaderboard(); openModal('leaderboardModal'); });
$('#shopShowQr').addEventListener('click', () => { closeModal('shopModal'); showQr().catch((error) => toast(error.message)); });
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
$('#beerLiters').addEventListener('input', () => {
  state.beerVolumeConfirmed = true;
  $$('[data-beer-liters]').forEach((item) => item.classList.remove('active'));
  updateCalculation();
});
$$('[data-beer-liters]').forEach((button) => button.addEventListener('click', () => {
  $('#beerLiters').value = button.dataset.beerLiters;
  state.beerVolumeConfirmed = true;
  $$('[data-beer-liters]').forEach((item) => item.classList.toggle('active', item === button));
  updateCalculation();
}));
$$('.gift-volume').forEach((button) => button.addEventListener('click', () => {
  state.selectedGiftLiters = Number(button.dataset.giftLiters || 0.5);
  $$('.gift-volume').forEach((item) => item.classList.toggle('active', item === button));
  updateCalculation();
}));
$('#bonusToSpend').addEventListener('input', updateCalculation);
$$('.mode').forEach((button) => button.addEventListener('click', () => {
  state.mode = button.dataset.mode;
  $$('.mode').forEach((item) => item.classList.toggle('active', item === button));
  $('#redeemControls').classList.toggle('hidden', state.mode !== 'redeem');
  $('#beerGiftControls').classList.toggle('hidden', state.mode !== 'beerGift');
  $('#shopControls').classList.toggle('hidden', state.mode !== 'shop');
  if (state.mode === 'beerGift') updateResolvedBeer();
  if (state.mode === 'shop') renderShopCatalog();
  hideOperationResult();
  updateCalculation();
}));
$('#createSale').addEventListener('click', () => createSale().catch((error) => toast(error.message)));
$('#saveDraft').addEventListener('click', () => saveDraft().catch((error) => toast(error.message)));
$('#publishDesign').addEventListener('click', () => publishDesign().catch((error) => toast(error.message)));
$('#reloadAdmin').addEventListener('click', () => loadAdmin().catch((error) => toast(error.message)));
$('#reloadStaffRecent').addEventListener('click', () => loadStaffRecent().catch((error) => toast(error.message)));
$('#reloadUsers').addEventListener('click', () => loadAdmin().catch((error) => toast(error.message)));
$('#reloadContent').addEventListener('click', () => reloadContent().catch((error) => toast(error.message)));
$('#addPromotion').addEventListener('click', () => openContentEditor('promotion'));
$('#addShopItem').addEventListener('click', () => openContentEditor('shop'));
$('#editPromosQuick').addEventListener('click', openContentAdmin);
$('#editShopQuick').addEventListener('click', openContentAdmin);
$('#saveContentItem').addEventListener('click', () => saveContentItem().catch((error) => toast(error.message)));
$('#removeContentImage').addEventListener('click', () => {
  if (!state.editingContent) return;
  state.editingContent.imageSrc = '';
  $('#contentImageUrl').value = '';
  $('#contentImageFile').value = '';
  $('#contentImageFileName').textContent = 'Фотография удалена из карточки';
  updateContentImagePreview();
});
$('#contentImageFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file || !state.editingContent) return;
  const label = $('#contentImageFileName');
  label.textContent = 'Обрабатываем изображение…';
  try {
    state.editingContent.imageSrc = await imageFileToDataUrl(file);
    state.editingContent.fileName = file.name;
    $('#contentImageUrl').value = '';
    label.textContent = `${file.name} · сохранится как WEBP`;
    updateContentImagePreview();
  } catch (error) {
    event.target.value = '';
    label.textContent = 'JPG, PNG или WEBP · до 6 МБ';
    toast(error.message);
  }
});
$('#saveShift').addEventListener('click', () => saveShift().catch((error) => toast(error.message)));
$('#endShift').addEventListener('click', () => endShift().catch((error) => toast(error.message)));
$('#changeStaffButton').addEventListener('click', () => { renderStaffSession(); openModal('staffLoginModal'); });
$('#activateStaffButton').addEventListener('click', () => activateStaff().catch((error) => toast(error.message)));
$('#clearStaffButton').addEventListener('click', clearStaffSession);
$('#staffPinInput').addEventListener('input', (event) => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6); });
$$('[data-design-color], [data-design-text], [data-design-section], [data-design-radius]').forEach((input) => input.addEventListener('input', () => {
  if (input.matches('[data-design-radius]')) $('#radiusValue').textContent = input.value;
  if (state.adminSettings) applyDesign(readDesignForm());
}));
window.addEventListener('online', updateNetworkBadge);
window.addEventListener('offline', updateNetworkBadge);
updateNetworkBadge();
boot();
