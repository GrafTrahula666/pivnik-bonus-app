import { BrowserQRCodeReader } from '@zxing/browser';

const $ = (s, root = document) => root.querySelector(s);
const app = $('#app'), modal = $('#modal');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => {
  const paths = {
    scan: '<path d="M4 8V4h4m8 0h4v4M4 16v4h4m8 0h4v-4M7 12h10"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
    trophy: '<path d="M8 3h8v7a4 4 0 0 1-8 0Zm4 11v6m-4 1h8M8 5H3v3a5 5 0 0 0 5 5m8-8h5v3a5 5 0 0 1-5 5"/>',
    tv: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7Z"/>', check: '<path d="m5 12 4 4L20 5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
    logout: '<path d="M9 4H4v16h5m5-13 5 5-5 5m-6-5h11"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    ticket: '<path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4Zm12 0v14"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'
  };
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.trophy}</svg>`;
};
const labels = { first: 'I место', second: 'II место', third: 'III место' };
const errors = {
  login_required: 'Войдите в приложение.', invalid_login: 'Проверьте логин и пароль.', login_rate_limited: 'Слишком много попыток. Подождите 10 минут.',
  forbidden: 'У этой роли нет доступа.', guest_not_found: 'Персональный код не найден.', invalid_qr: 'Это не персональный QR Пивника.',
  registration_closed: 'Регистрация временно закрыта.', rules_locked: 'После первого розыгрыша правило менять нельзя.',
  empty_local_pool: 'Нет допущенных гостей. Зарегистрируйте участников.', reveal_pending_draw_first: 'Сначала раскройте предыдущий результат.',
  not_due: 'По времени в БД приём билетов ещё открыт.', not_closed: 'Сначала закройте приём билетов после установленного срока.',
  main_already_drawn: 'Главный розыгрыш уже сохранён.', invalid_reveal_order: 'Результаты раскрываются последовательно.',
  already_revealed: 'Этот результат уже показан.', service_unavailable: 'Сервер недоступен. Изменение не подтверждено.',
  reward_bridge_not_configured: 'Выдача бонусов не подключена. Награда остаётся в ожидании.', reward_operation_failed: 'Операция выдачи не подтверждена. Повторите с тем же ключом.',
  award_final: 'Статус выдачи уже зафиксирован.', invalid_origin: 'Адрес приложения не совпадает с настройкой сервера.',
  invalid_scanner_link: 'Ссылка сканера устарела. Откройте новую ссылку, которую выдал владелец.',
  main_verification_failed: 'Проверка главного розыгрыша не пройдена.', snapshot_mismatch: 'Снимок билетов не прошёл проверку.'
};
let view = location.pathname.slice(1) || 'control';
let passwordlessScanner = false;
if (!['control', 'scanner', 'screen'].includes(view)) view = 'control';
document.body.dataset.view = view;
let state, actor, stream, connected = false, selectedPrize = '', busy = false, camera, scannerBusy = false, torch = false, stageTimer, lastStageId, audioContext;
const pending = new Map();

function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.className = error ? 'visible error' : 'visible';
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.className = '', 4500);
}
function connection(value) {
  connected = value;
  document.querySelectorAll('[data-connection]').forEach(el => { el.className = `connection ${value ? 'online' : 'offline'}`; el.textContent = value ? 'В эфире' : 'Нет связи с сервером'; });
  document.body.classList.toggle('disconnected', !value);
}
async function api(path, options = {}) {
  let response;
  try { response = await fetch(`/api/${path}`, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } }); }
  catch { throw new Error('Нет связи с сервером. Изменение не подтверждено. Повторите после подключения.'); }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('login')) { stream?.close(); camera?.stop(); login(); }
    const error = new Error(errors[data.error] || data.error || 'Запрос не выполнен.'); error.code = data.error; throw error;
  }
  return data;
}
async function action(name, input = {}) {
  const fingerprint = JSON.stringify({ name, input });
  const key = pending.get(fingerprint) || crypto.randomUUID(); pending.set(fingerprint, key);
  try {
    const result = await api(`actions/${name}`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(input) });
    pending.delete(fingerprint); await refresh(); return result;
  } catch (error) {
    // Keep the same key in memory for an ambiguous network failure; never persist QR payloads.
    if (error.code) pending.delete(fingerprint);
    throw error;
  }
}
async function refresh() { state = await api(`state?view=${view}`); render(); }
function listen() {
  stream?.close(); stream = new EventSource(`/api/events?view=${view}`);
  stream.onopen = () => connection(true);
  stream.onmessage = event => { state = JSON.parse(event.data); connection(true); render(); };
  stream.onerror = () => connection(false);
  stream.addEventListener('unavailable', () => connection(false));
}
const branding = `<a class="brand" href="/${view}"><img src="/icon.svg" alt=""/><span>PIVNIK<small>HALLOWEEN LIVE</small></span></a>`;
function header() {
  return `<header>${branding}<div class="header-right"><span class="event-date">31 октября 2026 <i>·</i> Ночь котлов</span><span data-connection class="connection">Подключение</span>${passwordlessScanner ? '' : `<button class="icon-button" data-action="logout" aria-label="Выйти">${icon('logout')}</button>`}</div></header>`;
}
function cauldron(cls = '') {
  return `<div class="cauldron-scene ${cls}" aria-hidden="true"><div class="halo"></div><div class="smoke smoke-a"></div><div class="smoke smoke-b"></div><div class="embers"></div><div class="flames"><i></i><i></i><i></i><i></i></div><div class="pot"><div class="pot-rim"></div><div class="potion"></div><div class="pot-glint"></div><span>П</span><i class="foot left"></i><i class="foot right"></i></div><div class="floor-glow"></div></div>`;
}
function login() {
  clearInterval(stageTimer); lastStageId = undefined;
  app.innerHTML = `<main class="login"><div class="login-art">${cauldron('large')}<span class="eyebrow">31 ОКТЯБРЯ · НОЧЬ КОТЛОВ</span><h1>Вечер, в котором<br>есть <em>магия.</em></h1></div><section class="login-panel">${branding}<span class="eyebrow">${view === 'scanner' ? 'СКАНЕР ГОСТЕЙ' : view === 'screen' ? 'ТЕЛЕВИЗИОННЫЙ ЭКРАН' : 'ПУЛЬТ ВЕДУЩЕГО'}</span><h2>Добро пожаловать</h2><p>Войдите под своей учётной записью.</p><form id="login-form"><label>Логин<input name="account" autocomplete="username" required autofocus></label><label>Пароль<input type="password" name="password" autocomplete="current-password" required></label><button class="primary" type="submit">Войти ${icon('arrow')}</button><p class="form-error" role="alert"></p></form><small class="muted">Доступ выдаёт владелец бара «Пивник».</small></section></main>`;
  $('#login-form').onsubmit = async event => {
    event.preventDefault(); const form = event.currentTarget, button = $('button', form); button.disabled = true;
    try {
      actor = await api('login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const allowed = { owner: ['control', 'scanner', 'screen'], operator: ['control', 'scanner', 'screen'], scanner: ['scanner'], screen: ['screen'] };
      if (!allowed[actor.role].includes(view)) { location.href = `/${allowed[actor.role][0]}`; return; }
      await bootSession();
    } catch (error) { $('.form-error', form).textContent = error.message; } finally { button.disabled = false; }
  };
}
function demoBanner() { return state.mode === 'demo' ? '<div class="demo-banner">ДЕМО · вымышленные гости и билеты · финансовые операции отключены</div>' : ''; }
function render() {
  if (!actor || !state) return;
  if (view === 'scanner') renderScanner(); else if (view === 'screen') renderScreen(); else renderControl();
  connection(connected);
}
function renderControl() {
  const local = state.draws.at(-1), main = state.main;
  const pendingDraw = local && !local.revealedAt;
  const next = main?.slots.find(s => !main.revealed.includes(s.slot));
  if (!state.prizes.some(p => p.id === selectedPrize)) selectedPrize = state.prizes[0]?.id;
  const closeDate = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(state.source.closesAt));
  const active = state.guests.filter(g => g.active);
  app.innerHTML = `${demoBanner()}${header()}<main class="control"><div class="page-heading"><div><span class="eyebrow">ПУЛЬТ ВЕДУЩЕГО</span><h1>Ночь котлов<span class="orange">.</span></h1><p>Гости собираются. Магия начинается здесь.</p></div><div class="heading-actions"><a class="secondary" href="/scanner" target="_blank">${icon('scan')} Сканер</a><button class="secondary" data-action="screen">${icon('tv')} Экран шоу</button></div></div>
  <div class="draw-grid"><section class="draw-card main-card"><div class="card-top"><span class="pill purple">ГЛАВНЫЙ РОЗЫГРЫШ</span><span class="tiny-status">${main ? '1 жеребьёвка · результат сохранён' : state.source.status === 'open' ? '0 жеребьёвок · билеты открыты' : '0 жеребьёвок · снимок сохранён'}</span></div><div class="card-content"><div class="card-copy"><h2>Главная магия<br>этой ночи</h2><p>Три призовых места.<br>Пять особенных рамок.</p><div class="card-counts"><div><strong>${state.source.participants}</strong><span>участников</span></div><div><strong>${state.source.tickets}</strong><span>билетов</span></div></div></div>${cauldron('card-pot')}</div><div class="prize-strip">${icon('trophy')} <strong>5 000 ₽</strong><span>депозит за I место</span><span class="gold">+ эксклюзивная рамка</span></div><div class="card-footer"><span>${icon('clock')} Закрытие: ${esc(closeDate)} МСК</span><button class="primary" data-action="${main ? 'reveal-main' : state.source.status === 'open' ? 'close-main' : 'draw-main'}" ${busy || (main && !next) || actor.role !== 'owner' && !main ? 'disabled' : ''}>${main ? next ? `Раскрыть ${labels[next.slot] || 'рамку ' + next.slot.slice(-1)}` : 'Все места раскрыты' : state.source.status === 'open' ? state.mode === 'demo' ? 'Закрыть демо-билеты' : 'Закрыть приём' : 'Провести жеребьёвку'} ${icon('arrow')}</button></div></section>
  <section class="draw-card local-card"><div class="card-top"><span class="pill orange-pill">ЛОКАЛЬНЫЙ РОЗЫГРЫШ</span><span class="tiny-status"><i class="green-dot"></i>${state.registrationOpen ? 'Регистрация открыта' : 'Регистрация закрыта'}</span></div><div class="local-hero"><div class="local-mark">${icon('ticket')}</div><h2>Среди своих</h2><p>Все, кто сегодня с нами.<br>Один гость — один шанс.</p></div><div class="local-counts"><div><strong>${state.count}</strong><span>в баре</span></div><div><strong>${state.eligible}</strong><span>допущены</span></div><div><strong>${state.draws.length}</strong><span>розыгрышей</span></div></div><div class="local-bottom"><label for="prize-select">ПРИЗ СЛЕДУЮЩЕГО РОЗЫГРЫША</label><div class="prize-picker"><select id="prize-select">${state.prizes.map(p => `<option value="${esc(p.id)}" ${selectedPrize === p.id ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select><button class="icon-button" data-action="prize" aria-label="Создать или изменить приз">${icon('plus')}</button></div><button class="primary wide" data-action="${pendingDraw ? 'reveal-local' : 'draw-local'}" ${busy || !pendingDraw && !state.eligible ? 'disabled' : ''}>${icon(pendingDraw ? 'tv' : 'bolt')} ${pendingDraw ? 'Раскрыть победителя на экране' : 'Начать локальный розыгрыш'} ${icon('arrow')}</button></div></section></div>
  <div class="below-grid"><section class="panel guest-panel"><div class="section-heading"><h3>${icon('people')} Гости в баре <span class="count-badge">${active.length}</span></h3><button class="text-button" data-action="manual">Добавить по коду ${icon('plus')}</button></div>${active.length ? `<div class="guest-list">${[...active].reverse().slice(0, 30).map(g => `<div class="guest-row"><span class="avatar">${esc(g.name[0])}</span><div><strong>${esc(g.name)}</strong><small>Зарегистрирован · ${new Date(g.registeredAt).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })}</small></div><span class="guest-number">№ ${String(g.number).padStart(3, '0')}</span></div>`).join('')}</div>` : `<div class="empty">${icon('scan')}<h4>Первые гости уже на подходе</h4><p>Отсканируйте персональный QR в приложении сканера.<br>Гость сразу появится здесь.</p>${state.mode === 'demo' ? '<small>Для проверки: PVK-DEMO-0001 … PVK-DEMO-0016</small>' : ''}</div>`}</section>
  <section class="panel history-panel"><div class="section-heading"><h3>${icon('clock')} История вечера</h3><a class="icon-button" href="/api/report" download aria-label="Скачать отчёт">${icon('download')}</a></div>${state.draws.length ? `<div class="history-list">${[...state.draws].reverse().map(d => `<button class="history-row" data-action="award" data-id="${esc(d.id)}"><span class="history-icon">${icon('trophy')}</span><span><strong>${esc(d.prize.title)}</strong><small>${esc(d.revealedAt ? d.winner.name : 'Результат сохранён · ожидает раскрытия')}</small></span><span class="status-tag ${d.status}">${{ pending: 'Ожидает', given: 'Вручён', absent: 'Отсутствует' }[d.status]}</span></button>`).join('')}</div>` : '<div class="empty compact"><h4>Всё ещё впереди</h4><p>Проведённые розыгрыши и выдача призов<br>сохраняются здесь.</p></div>'}</section></div>
  <footer><span>Состояние сохраняется на сервере · версия ${state.revision}</span><button class="text-button" data-action="settings">Правила и регистрация</button><button class="text-button" data-action="waiting">Экран ожидания</button>${actor.role === 'owner' ? '<a class="text-button" href="/api/audit" target="_blank">Аудит</a>' : ''}</footer></main>`;
  $('#prize-select').onchange = event => selectedPrize = event.target.value;
}

function renderScanner() {
  if (!$('#scanner-view')) {
    app.innerHTML = `${demoBanner()}${header()}<main id="scanner-view"><div class="scanner-heading"><span class="eyebrow">PIVNIK SCANNER</span><h1>Встречаем гостей</h1><p>Наведите камеру на персональный QR</p></div><div class="camera-frame"><video id="camera" autoplay muted playsinline></video><div class="camera-shade"></div><div class="scan-corners"></div><div class="scan-line"></div><div class="camera-caption">QR ГОСТЯ PIVNIK</div><div id="scan-result" aria-live="polite"></div><button class="camera-start secondary" data-action="camera">${icon('scan')} Включить камеру</button></div><div class="scanner-actions"><button class="secondary" data-action="manual">${icon('ticket')} Ввести код</button><button class="secondary" id="torch" data-action="torch" disabled>${icon('bolt')} Фонарик</button></div><div class="scanner-counter"><div><span>ГОСТЕЙ ЗАРЕГИСТРИРОВАНО</span><strong id="scan-count">0</strong></div><span class="live-ring">${icon('people')}</span></div><section class="recent"><h3>Последние гости</h3><div id="recent-guests"></div></section><p class="install-note">Установка на iPhone: Safari → Поделиться → На экран «Домой».</p></main>`;
    startCamera();
  }
  $('#scan-count').textContent = state.count;
  $('#recent-guests').innerHTML = state.guests.slice(-5).reverse().map(g => `<div class="guest-row"><span class="avatar">${esc(g.name[0])}</span><div><strong>${esc(g.name)}</strong><small>№ ${String(g.number).padStart(3, '0')}</small></div>${['owner', 'scanner'].includes(actor.role) ? `<button class="icon-button" data-action="remove" data-id="${esc(g.userId)}" aria-label="Удалить регистрацию ${esc(g.name)}">${icon('close')}</button>` : ''}</div>`).join('') || '<p class="muted">Пока никого. Отсканируйте первого гостя.</p>';
}
async function startCamera() {
  if (camera || scannerBusy) return;
  const button = $('.camera-start'); button.disabled = true;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Камера доступна через HTTPS или localhost. Используйте ручной ввод.');
    const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 1200 });
    camera = await reader.decodeFromConstraints({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } }, $('#camera'), result => { if (result && !scannerBusy && connected && !modal.open) register(result.getText()); });
    button.hidden = true;
    const track = $('#camera').srcObject?.getVideoTracks()[0];
    $('#torch').disabled = !track?.getCapabilities?.().torch;
  } catch (error) {
    const message = error.name === 'NotAllowedError' ? 'Разрешите доступ к камере в настройках Safari или введите код.' : error.name === 'NotFoundError' ? 'Камера не найдена. Введите персональный код вручную.' : error.name === 'NotReadableError' ? 'Камера занята другим приложением. Закройте его и повторите.' : error.message || 'Камера недоступна. Введите код вручную.';
    toast(message, true); button.disabled = false;
  }
}
async function register(payload) {
  if (scannerBusy) return;
  if (!navigator.onLine || !connected) { toast('Нет связи. Регистрация не сохранена. Попробуйте снова после подключения.', true); return; }
  scannerBusy = true;
  try {
    const result = await action('register', { payload });
    const target = $('#scan-result');
    if (target) {
      target.className = `scan-feedback ${result.duplicate ? 'duplicate' : 'success'}`;
      target.innerHTML = `${result.guest.photo ? `<img class="success-photo" src="${esc(result.guest.photo)}" alt="">` : icon('check')}<h2>${result.duplicate ? 'Уже зарегистрирован' : 'Гость зарегистрирован'}</h2><p>${esc(result.guest.name)}</p><strong>№ ${String(result.guest.number).padStart(3, '0')}</strong>`;
      setTimeout(() => { target.className = ''; target.innerHTML = ''; }, 1800);
    } else toast(`${result.duplicate ? 'Уже зарегистрирован' : 'Гость зарегистрирован'}: ${result.guest.name}`);
    if (!result.duplicate) {
      navigator.vibrate?.([70, 30, 70]);
      try { audioContext ||= new AudioContext(); const tone = audioContext.createOscillator(), gain = audioContext.createGain(); gain.gain.value = 0.08; tone.frequency.value = 880; tone.connect(gain).connect(audioContext.destination); tone.start(); tone.stop(audioContext.currentTime + 0.1); } catch { /* Audio feedback is optional on iOS. */ }
    }
  } catch (error) { toast(error.message || 'Регистрация не подтверждена сервером. Повторите сканирование.', true); }
  finally { setTimeout(() => scannerBusy = false, 1900); }
}
function renderScreen() {
  const stage = state.stage;
  if ($('#stage')) $('#stage-count').textContent = `${state.count} гостей уже с нами`;
  if (lastStageId === stage.id) return;
  lastStageId = stage.id; clearInterval(stageTimer);
  const waiting = stage.status === 'waiting';
  app.innerHTML = `<main id="stage" class="show ${stage.kind === 'main' ? 'grand' : ''} ${stage.slot === 'first' ? 'first-place' : ''}"><div class="show-vignette"></div>${state.mode === 'demo' ? '<span class="show-demo">ДЕМО</span>' : ''}<div class="show-top">${branding}<span data-connection class="connection"></span></div><div class="show-content"><span class="eyebrow">${waiting ? '31 ОКТЯБРЯ · НОЧЬ КОТЛОВ' : stage.kind === 'main' ? labels[stage.slot] || 'ДОПОЛНИТЕЛЬНАЯ РАМКА' : 'ЛОКАЛЬНЫЙ РОЗЫГРЫШ'}</span><h1 id="show-title">${waiting ? 'Магия уже близко' : esc(stage.prize)}</h1>${cauldron('show-pot')}<div id="show-numbers"></div><div id="winner" class="winner" aria-live="polite"><span class="eyebrow">ПОБЕДИТЕЛЬ</span><h2>${waiting ? '' : esc(stage.winner.name)}</h2><strong>${waiting ? '' : stage.kind === 'main' ? `Билет № ${stage.winner.ticket}` : `Гость № ${String(stage.winner.number).padStart(3, '0')}`}</strong></div><p class="waiting-copy">${waiting ? 'Собираемся. Загадываем. Выигрываем.' : 'Котёл выбирает своего героя…'}</p></div><div class="show-bottom"><span>ПИВНИК · HALLOWEEN 2026</span><span id="stage-count">${state.count} гостей уже с нами</span></div><div class="flash"></div><div class="screen-tools"><button class="secondary" data-action="fullscreen">На весь экран</button><button class="secondary" data-action="graphics">Лёгкая графика</button></div></main>`;
  if (localStorage.getItem('pivnik-light') === '1') $('#stage').classList.add('light-graphics');
  if (!waiting) {
    const duration = stage.slot === 'first' ? 14000 : stage.kind === 'main' ? 11000 : 8500;
    // Numbers are a fixed theatrical sequence, never a browser-side winner selection.
    const sequence = ['013', '027', '008', '042', '019', '031', '005', '016'];
    function frame() {
      const elapsed = Date.now() - new Date(stage.startedAt).getTime();
      const phase = elapsed < 1000 ? 'prize' : elapsed < 2200 ? 'cauldron' : elapsed < 3200 ? 'fire' : elapsed < duration - 400 ? 'suspense' : elapsed < duration ? 'flash-phase' : 'won';
      $('#stage').dataset.phase = phase;
      $('#show-numbers').textContent = phase === 'suspense' ? `№ ${sequence[Math.floor(elapsed / 90) % sequence.length]}` : '';
      if (phase === 'won') { clearInterval(stageTimer); $('.waiting-copy').textContent = 'Поздравляем!'; }
    }
    frame(); if ($('#stage').dataset.phase !== 'won') stageTimer = setInterval(frame, 60);
  }
}
function openModal(content, submit) {
  $('#modal-content').innerHTML = `<button type="button" class="modal-close icon-button" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button>${content}<p class="form-error" role="alert"></p>`;
  $('#modal-form').onsubmit = async event => {
    event.preventDefault(); const button = $('button[type=submit]', modal); if (button) button.disabled = true;
    try { await submit(Object.fromEntries(new FormData(event.currentTarget))); modal.close(); }
    catch (error) { $('.form-error', modal).textContent = error.message || 'Нет связи с сервером. Повторите.'; }
    finally { if (button) button.disabled = false; }
  };
  modal.showModal();
}
app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const name = button.dataset.action;
  if (name === 'manual') {
    openModal(`<span class="eyebrow">РЕГИСТРАЦИЯ ГОСТЯ</span><h2>Персональный код</h2><p>Код находится под QR в приложении Пивника.</p><label>Код гостя<input name="payload" placeholder="PVK-XXXX-XXXX" autocomplete="off" autocapitalize="characters" required maxlength="100"></label><button class="primary wide" type="submit">Зарегистрировать ${icon('check')}</button>`, async ({ payload }) => {
      const r = await action('register', { payload }); toast(`${r.duplicate ? 'Уже зарегистрирован' : 'Гость зарегистрирован'}: ${r.guest.name}`);
    }); return;
  }
  if (name === 'prize') {
    const p = state.prizes.find(p => p.id === selectedPrize);
    openModal(`<span class="eyebrow">ПРИЗЫ ВЕЧЕРА</span><h2>Подготовить приз</h2><label>Название<input name="title" maxlength="100" required></label><label>Тип<select name="kind"><option value="custom">Произвольный приз</option value="beer">Пиво</option value="bonus">Бонусы</option></select></label><label>Количество (мл или бонусов)<input name="amount" type="number" value="0" min="0" max="10000"></label><label class="checkbox"><input type="checkbox" name="edit" value="yes">Изменить выбранный: ${esc(p?.title)}</label><button class="primary wide" type="submit">Сохранить приз</button>`, values => action('prize', { ...values, id: values.edit ? selectedPrize : undefined })); return;
  }
  if (name === 'settings') {
    openModal(`<span class="eyebrow">ПРАВИЛА ВЕЧЕРА</span><h2>Регистрация и допуск</h2><label>Регистрация<select name="registrationOpen"><option value="true" ${state.registrationOpen ? 'selected' : ''}>Открыта</option><option value="false" ${!state.registrationOpen ? 'selected' : ''}>Закрыта</option></select></label><label>Повторные победы<select name="excludeWinners" ${state.draws.length ? 'disabled' : ''}><option value="true" ${state.excludeWinners ? 'selected' : ''}>Один локальный приз за вечер</option><option value="false" ${!state.excludeWinners ? 'selected' : ''}>Разрешены повторные победы</option></select></label><p>Правило фиксируется перед первым розыгрышем.</p><button class="primary wide" type="submit">Сохранить</button>`, v => action('settings', { registrationOpen: v.registrationOpen === 'true', ...(v.excludeWinners !== undefined ? { excludeWinners: v.excludeWinners === 'true' } : {}) })); return;
  }
  if (name === 'remove') {
    const guest = state.guests.find(g => g.userId === button.dataset.id);
    openModal(`<h2>Удалить регистрацию?</h2><p>${esc(guest.name)} перестанет участвовать в следующих розыгрышах. Сохранённые результаты останутся в истории.</p><label>Причина<input name="reason" minlength="3" maxlength="160" required></label><button class="primary wide" type="submit">Подтвердить удаление</button>`, v => action('remove', { userId: guest.userId, confirm: true, reason: v.reason })); return;
  }
  if (name === 'award') {
    const d = state.draws.find(d => d.id === button.dataset.id);
    if (!d.revealedAt) { toast('Сначала раскройте результат на экране.'); return; }
    openModal(`<span class="eyebrow">${esc(d.prize.title)}</span><h2>${esc(d.winner.name)}</h2><p>Гость № ${d.winner.number} · ${d.snapshot.length} допущенных гостей</p><label>Статус<select name="status"><option value="pending">Ожидает выдачи</option><option value="given">Приз вручен</option><option value="absent">Победитель отсутствует</option></select></label><label>Комментарий / основание<input name="note" maxlength="300" required minlength="3" placeholder="Кто вручил приз или причина отсутствия"></label>${d.status === 'absent' ? '<label class="checkbox"><input name="reroll" type="checkbox" value="yes">Повторить жеребьёвку с сохранением истории</label>' : ''}<button class="primary wide" type="submit" ${d.status === 'given' ? 'disabled' : ''}>Сохранить</button>`, v => v.reroll ? action('reroll', { drawId: d.id, reason: v.note }) : action('award', { drawId: d.id, status: v.status, note: v.note })); return;
  }
  if (name === 'screen') {
    if (window.pivnikDesktop) {
      const displays = await window.pivnikDesktop.displays();
      openModal(`<h2>Экран шоу</h2><label>Монитор<select name="displayId">${displays.map(d => `<option value="${d.id}">${esc(d.label)}</option>`).join('')}</select></label><button class="primary wide" type="submit">Открыть на весь экран</button>`, v => window.pivnikDesktop.showScreen(Number(v.displayId)));
    } else window.open('/screen', 'pivnik-screen'); return;
  }
  if (name === 'camera') { startCamera(); return; }
  if (name === 'torch') { try { const track = $('#camera').srcObject.getVideoTracks()[0]; torch = !torch; await track.applyConstraints({ advanced: [{ torch }] }); button.classList.toggle('active', torch); } catch { toast('Фонарик недоступен в этом браузере.', true); } return; }
  if (name === 'fullscreen') { document.documentElement.requestFullscreen?.().catch(() => toast('Включите полноэкранный режим средствами браузера.')); return; }
  if (name === 'graphics') { const on = $('#stage').classList.toggle('light-graphics'); localStorage.setItem('pivnik-light', on ? '1' : '0'); return; }
  if (busy) return;
  if (['draw-local', 'draw-main', 'close-main'].includes(name)) {
    const label = name === 'draw-local' ? `Провести розыгрыш «${state.prizes.find(p => p.id === selectedPrize)?.title}» среди ${state.eligible} гостей?` : name === 'draw-main' ? 'Сохранить единственную главную жеребьёвку? Результаты будут раскрыты отдельно.' : 'Закрыть приём билетов по времени из БД и зафиксировать снимок?';
    openModal(`<h2>${esc(label)}</h2><p>Действие сохранится на сервере с записью в аудит.</p><button class="primary wide" type="submit">Подтвердить</button>`, () => action(name === 'close-main' && state.mode === 'demo' ? 'demo-close' : name, name === 'draw-local' ? { prizeId: selectedPrize } : {})); return;
  }
  busy = true; button.disabled = true;
  try {
    if (name === 'logout') { await api('logout', { method: 'POST', body: '{}' }); actor = null; stream?.close(); camera?.stop(); camera = null; connection(false); login(); }
    else if (name === 'reveal-local') await action('reveal', { drawId: state.draws.at(-1).id, kind: 'local' });
    else if (name === 'reveal-main') await action('reveal', { kind: 'main', slot: state.main.slots.find(s => !state.main.revealed.includes(s.slot)).slot });
    else if (name === 'waiting') await action('waiting');
  } catch (error) { toast(error.message || 'Нет связи. Повторите действие.', true); }
  finally { busy = false; if (state && actor) render(); }
});
modal.addEventListener('click', event => { if (event.target.closest('[data-action="close-modal"]')) modal.close(); });
window.addEventListener('offline', () => { connection(false); toast('Нет интернета. Регистрация и розыгрыши недоступны.', true); });
if (view === 'scanner') document.addEventListener('pointerdown', () => {
  try { audioContext ||= new AudioContext(); audioContext.resume().catch(() => {}); } catch { /* Optional feedback. */ }
}, { once: true });
window.addEventListener('online', () => { refresh().then(listen).catch(() => connection(false)); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && actor) refresh().catch(() => connection(false)); });
async function bootSession() { await refresh(); listen(); }
async function init() {
  if (view === 'scanner' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try {
    const health = view === 'scanner' ? await fetch('/health', { cache: 'no-store' }).then(r => r.json()) : null;
    const linkToken = view === 'scanner' ? new URLSearchParams(location.hash.slice(1)).get('access') : null;
    let savedToken;
    try { savedToken = view === 'scanner' ? sessionStorage.getItem('pivnik-scanner-access') : null; } catch { /* Cookies still keep the current session. */ }
    const scannerToken = linkToken || savedToken;
    passwordlessScanner = health?.mode === 'demo' || Boolean(scannerToken);
    actor = health?.mode === 'demo' ? await api('demo-scanner', { method: 'POST', body: '{}' })
      : scannerToken ? await api('scanner-link', { method: 'POST', body: JSON.stringify({ token: scannerToken }) }) : await api('me');
    if (linkToken) {
      try { sessionStorage.setItem('pivnik-scanner-access', linkToken); } catch { /* The session cookie suffices. */ }
      history.replaceState(null, '', location.pathname + location.search);
    }
    if (actor.role === 'scanner' && view !== 'scanner' || actor.role === 'screen' && view !== 'screen') { location.replace(`/${actor.role}`); return; }
    await bootSession();
  } catch { login(); }
}
init();
