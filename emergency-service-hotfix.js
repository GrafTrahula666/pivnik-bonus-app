(() => {
  'use strict';

  const DARK_HEADER = '#0b0e13';

  function enforceTelegramHeader() {
    try {
      const webApp = window.Telegram?.WebApp;
      webApp?.setHeaderColor?.(DARK_HEADER);
    } catch (_) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', DARK_HEADER);
  }

  function ensureHomeServiceAccess() {
    const home = document.querySelector('.screen.client-home[data-screen="client"]');
    const hero = home?.querySelector('.spaceverse-home-hero');
    const profileStaff = document.getElementById('profileStaffNav');
    const profileAdmin = document.getElementById('profileAdminNav');
    if (!home || !hero || !profileStaff || !profileAdmin) return null;

    let card = document.getElementById('homeEmergencyServiceAccess');
    if (!card) {
      card = document.createElement('section');
      card.id = 'homeEmergencyServiceAccess';
      card.className = 'home-emergency-service-access hidden';
      card.setAttribute('aria-label', 'Служебный доступ');
      card.innerHTML = [
        '<span class="home-emergency-kicker">Служебный доступ</span>',
        '<div class="home-emergency-actions">',
        '<button type="button" id="homeEmergencyStaff">Бармен</button>',
        '<button type="button" id="homeEmergencyAdmin">Админ-панель</button>',
        '</div>'
      ].join('');
      hero.insertAdjacentElement('afterend', card);
      card.querySelector('#homeEmergencyStaff')?.addEventListener('click', () => profileStaff.click());
      card.querySelector('#homeEmergencyAdmin')?.addEventListener('click', () => profileAdmin.click());
    }

    const staffAllowed = !profileStaff.classList.contains('hidden');
    const adminAllowed = !profileAdmin.classList.contains('hidden');
    card.classList.toggle('hidden', !staffAllowed && !adminAllowed);
    card.querySelector('#homeEmergencyStaff')?.classList.toggle('hidden', !staffAllowed);
    card.querySelector('#homeEmergencyAdmin')?.classList.toggle('hidden', !adminAllowed);
    return card;
  }

  function sync() {
    enforceTelegramHeader();
    ensureHomeServiceAccess();
  }

  document.addEventListener('DOMContentLoaded', () => {
    sync();
    const targets = [
      document.getElementById('profileStaffNav'),
      document.getElementById('profileAdminNav'),
      document.getElementById('profileServiceAccess')
    ].filter(Boolean);
    const observer = new MutationObserver(sync);
    targets.forEach((target) => observer.observe(target, { attributes: true, attributeFilter: ['class'] }));
    [0, 250, 800, 1800, 3500].forEach((delay) => window.setTimeout(sync, delay));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) sync();
    });
  });
})();