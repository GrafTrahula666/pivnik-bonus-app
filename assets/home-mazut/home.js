// Mount the approved home on the existing live profile and actions.
if (new URLSearchParams(location.search).get('mazut') !== '0') {
  enableMazutHome().catch((error) => console.warn('Pivnik home unavailable:', error));
}

async function enableMazutHome() {
  const home = document.querySelector('.client-home[data-screen="client"]');
  const byId = (id) => document.getElementById(id);
  const avatar = byId('profileAvatar');
  const name = byId('clientName');
  const balance = byId('clientBalance');
  const status = byId('openStatuses');
  const statusProgress = byId('statusProgress')?.parentElement;
  const remaining = byId('nextRewardText');
  const statusText = byId('statusProgressText');
  const beerText = byId('beerProgressText');
  const beerProgress = byId('beerProgressBar');
  const beerGift = byId('beerGiftReady');
  const qr = byId('heroQrButton');
  const profileNav = document.querySelector('.bottom-nav [data-target="profile"]');
  if (!home || !avatar || !name || !balance || !status || !statusProgress ||
      !remaining || !statusText || !beerText || !beerProgress || !qr || !profileNav) return;

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/assets/home-mazut/home.css?v=6';
  const cssReady = new Promise((resolve, reject) => {
    stylesheet.onload = resolve;
    stylesheet.onerror = reject;
  });
  document.head.append(stylesheet);
  await cssReady;

  const stage = document.createElement('section');
  stage.className = 'mazut-stage';
  stage.setAttribute('aria-label', 'Главная Пивника');
  stage.innerHTML = `
    <div class="mazut-fluid" aria-hidden="true"><canvas></canvas></div>
    <div class="mazut-gesture" aria-hidden="true"></div>
    <div class="mazut-content">
      <div class="mazut-profile">
        <div class="mazut-avatar"></div>
        <div class="mazut-profile-copy">
          <button class="mazut-profile-link" type="button" aria-label="Открыть профиль"></button>
          <div class="mazut-status"></div>
          <div class="mazut-status-progress"></div>
          <div class="mazut-status-caption"></div>
        </div>
        <strong class="mazut-brand" data-mazut-ink>ПИВНИК</strong>
      </div>
      <div class="mazut-wallet">
        <button class="mazut-balance" type="button" aria-label="История бонусов"><small>бонусов</small></button>
        <div class="mazut-beer" aria-label="Прогресс до бесплатного литра"><span>До подарка</span></div>
      </div>
      <nav class="mazut-dock" aria-label="Быстрые действия">
        <button class="mazut-lab" type="button" aria-controls="spaceverseLabScreen">
          <img class="mazut-lab-cube" src="/assets/home-mazut/lab-cube.png" width="25" height="25" alt="">
          <span>SpaceVerse Lab</span>
        </button>
      </nav>
    </div>
    `;

  const slot = (selector) => stage.querySelector(selector);
  slot('.mazut-avatar').append(avatar);
  slot('.mazut-profile-link').append(name);
  slot('.mazut-status').append(status);
  slot('.mazut-status-progress').append(statusProgress);
  slot('.mazut-status-caption').append(statusText, remaining);
  slot('.mazut-balance').prepend(balance);
  slot('.mazut-beer').append(beerText, beerProgress);
  for (const element of [name, status, statusProgress, statusText, remaining, beerProgress]) {
    element.setAttribute('data-mazut-ink', '');
  }
  if (beerGift) slot('.mazut-beer').append(beerGift);
  const qrImage = document.createElement('img');
  qrImage.width = 495;
  qrImage.height = 318;
  qrImage.alt = '';
  // Keep the real button and its existing QR action, including a text fallback.
  qrImage.onload = () => { qr.replaceChildren(qrImage); qr.classList.add('mazut-qr-ready'); };
  qrImage.src = '/assets/home-mazut/qr.png';
  qr.classList.add('mazut-qr');
  slot('.mazut-dock').prepend(qr);

  function openProfile() { profileNav.click(); }
  slot('.mazut-profile-link').addEventListener('click', openProfile);
  slot('.mazut-avatar').addEventListener('click', (event) => {
    event.stopPropagation();
    openProfile();
  }, { capture: true });
  slot('.mazut-avatar').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    openProfile();
  }, { capture: true });
  avatar.setAttribute('aria-label', 'Открыть профиль');
  slot('.mazut-balance').addEventListener('click', () => {
    openProfile();
    requestAnimationFrame(() => document.querySelector('.profile-history-card')?.scrollIntoView({ block: 'start' }));
  });

  const labButton = slot('.mazut-lab');
  const labEntry = byId('openSpaceverseLab');
  if (labEntry) labEntry.classList.add('mazut-moved-to-lab');
  for (const id of ['openRunButton', 'openWheelButton']) {
    byId(id)?.classList.add('mazut-moved-to-lab');
  }
  let fluid;
  let entering = false;
  labButton.addEventListener('click', () => {
    if (entering || document.querySelector('dialog[open]')) return;
    const show = () => {
      entering = false;
      fluid?.stopPull();
      if (!home.classList.contains('active')) return;
      labEntry?.click();
      fluid?.sync();
    };
    if (!fluid || matchMedia('(prefers-reduced-motion: reduce)').matches) { show(); return; }
    entering = true;
    fluid.pullTowards(labButton);
    setTimeout(show, 380);
  });
  home.prepend(stage);
  home.classList.add('mazut-home');
  const { mountMazutFluid } = await import('/assets/home-mazut/fluid.js?v=3');
  fluid = mountMazutFluid({
    card: stage,
    layer: slot('.mazut-fluid'),
    canvas: slot('canvas'),
    isPaused: () => !home.classList.contains('active') || Boolean(document.querySelector('.modal.open, dialog[open]'))
  });
  const orientation = window.DeviceOrientationEvent;
  if (orientation && typeof orientation.requestPermission !== 'function') fluid.enableTilt();
  if (typeof orientation?.requestPermission === 'function') {
    const menu = document.querySelector('[data-screen="profile"] .profile-menu');
    const tiltButton = document.createElement('button');
    tiltButton.type = 'button';
    tiltButton.innerHTML = '<span aria-hidden="true">◇</span><div><b>Наклон телефона</b><small aria-live="polite">Включить движение мазута при наклоне</small></div><i aria-hidden="true">›</i>';
    tiltButton.addEventListener('click', async () => {
      const message = tiltButton.querySelector('small');
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        message.textContent = 'В системе включено уменьшение движения';
        return;
      }
      tiltButton.disabled = true;
      try {
        if (await orientation.requestPermission() === 'granted') {
          fluid.enableTilt();
          message.textContent = 'Наклон включён';
          return;
        }
        message.textContent = 'Доступ к датчику закрыт';
      } catch {
        message.textContent = 'Датчик недоступен в этом приложении';
      }
      tiltButton.disabled = false;
    });
    menu?.append(tiltButton);
  }

  const stateObserver = new MutationObserver(() => fluid.sync());
  stateObserver.observe(home, { attributes: true, attributeFilter: ['class'] });
  for (const modal of document.querySelectorAll('.modal, dialog')) {
    stateObserver.observe(modal, { attributes: true, attributeFilter: ['class', 'open'] });
  }
}
