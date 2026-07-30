(() => {
  'use strict';

  const previousFetch = window.fetch.bind(window);
  const platform = window.__PIVNIK_PLATFORM__ === 'vk' ? 'vk' : 'telegram';
  let explicitConsent = false;
  let consentRequired = false;
  let consentObserver = null;
  let lastProfile = null;
  let linkStatus = null;
  let activeCode = null;
  let countdownTimer = null;

  function getToken() {
    try { return localStorage.getItem('pivnik_session') || ''; }
    catch (_) { return ''; }
  }

  function saveToken(token) {
    try { localStorage.setItem('pivnik_session', token); }
    catch (_) {}
  }

  function requestPath(input) {
    const requestUrl = typeof input === 'string' ? input : input?.url || '';
    try { return new URL(requestUrl, window.location.href).pathname; }
    catch { return requestUrl; }
  }

  async function inspectResponse(response) {
    try {
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return;
      const data = await response.clone().json();
      if (data?.profile) {
        lastProfile = data.profile;
        consentRequired = data.profile.termsAccepted !== true;
        updateLinkCardFromProfile(data.profile);
        if (consentRequired) scheduleConsentGate();
        else stopConsentGate();
      }
    } catch (_) {}
  }

  window.fetch = async (input, init = {}) => {
    const pathname = requestPath(input);
    const headers = new Headers(init.headers || {});
    headers.set('x-pivnik-platform', platform);

    if (pathname === '/api/me/consent') {
      if (!explicitConsent) {
        return Promise.reject(new Error('Согласие можно подтвердить только кнопкой пользователя.'));
      }
      headers.set('x-pivnik-explicit-consent', '1');
    }

    const response = await previousFetch(input, { ...init, headers });
    if (
      pathname === '/api/auth'
      || pathname === '/api/me'
      || pathname === '/api/me/consent'
      || pathname === '/api/account-link/status'
      || pathname === '/api/account-link/consume'
    ) {
      void inspectResponse(response);
    }

    if (pathname === '/api/me/consent') {
      const accepted = explicitConsent && response.ok;
      explicitConsent = false;
      if (accepted) {
        window.setTimeout(() => window.location.reload(), 650);
      }
    }
    return response;
  };

  async function api(path, options = {}) {
    const token = getToken();
    const headers = new Headers(options.headers || {});
    headers.set('content-type', 'application/json');
    headers.set('x-pivnik-platform', platform);
    if (token) headers.set('authorization', `Bearer ${token}`);

    const response = await previousFetch(path, {
      ...options,
      headers,
      body: options.body === undefined ? undefined : options.body
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Ошибка ${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (data?.profile) {
      lastProfile = data.profile;
      updateLinkCardFromProfile(data.profile);
    }
    return data;
  }

  function toast(message) {
    const element = document.getElementById('toast');
    if (!element) return;
    element.textContent = String(message || '');
    element.classList.add('show');
    window.setTimeout(() => element.classList.remove('show'), 2600);
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.modal.open')) document.body.classList.remove('modal-open');
  }

  function openConsentGate() {
    if (!consentRequired) return;
    const shell = document.getElementById('appShell');
    const modal = document.getElementById('consentModal');
    if (!modal || shell?.classList.contains('hidden')) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function scheduleConsentGate() {
    window.setTimeout(openConsentGate, 80);
    window.setTimeout(openConsentGate, 500);
    window.setTimeout(openConsentGate, 1200);
    if (consentObserver || !document.body) return;
    consentObserver = new MutationObserver(openConsentGate);
    consentObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'aria-hidden']
    });
  }

  function stopConsentGate() {
    consentRequired = false;
    consentObserver?.disconnect();
    consentObserver = null;
  }

  function platformTitle(value) {
    return value === 'vk' ? 'VK' : 'Telegram';
  }

  function identityTitle(identity) {
    if (!identity) return '';
    const username = identity.username ? ` @${identity.username}` : '';
    return `${platformTitle(identity.provider)}${username}`;
  }

  function updateLinkCardFromProfile(profile) {
    const cardValue = document.getElementById('accountLinkCardValue');
    if (!cardValue || !profile) return;
    const platforms = Array.isArray(profile.linkedPlatforms) ? profile.linkedPlatforms : [];
    cardValue.textContent = platforms.includes('telegram') && platforms.includes('vk')
      ? 'Telegram и VK связаны'
      : `Подключён ${platformTitle(platform)}`;
  }

  function renderStatus(status) {
    linkStatus = status;
    const statusText = document.getElementById('accountLinkStatusText');
    const identities = document.getElementById('accountLinkIdentities');
    const generate = document.getElementById('generateLinkCode');
    const consumeBlock = document.getElementById('accountLinkConsumeBlock');
    const sourceHint = document.getElementById('accountLinkSourceHint');

    if (!statusText || !identities || !generate || !consumeBlock) return;

    const rows = Array.isArray(status.identities) ? status.identities : [];
    identities.innerHTML = rows.length
      ? rows.map((identity) => `<div class="account-link-identity"><b>${escapeHtml(platformTitle(identity.provider))}</b><span>${escapeHtml(identityTitle(identity))}</span><i>подключён</i></div>`).join('')
      : '<div class="account-link-empty">Платформы пока не определены.</div>';

    if (status.accountLinked) {
      statusText.textContent = 'Это один профиль: общий баланс, история, литры и один QR-код.';
      generate.classList.add('hidden');
      consumeBlock.classList.add('hidden');
      if (sourceHint) sourceHint.textContent = `QR: ${status.profile?.qrShortCode || 'единый'}`;
    } else {
      const other = platform === 'vk' ? 'Telegram' : 'VK';
      statusText.textContent = `Сейчас открыт ${platformTitle(platform)}. Создайте код здесь и введите его в ${other}, либо сделайте наоборот.`;
      generate.classList.remove('hidden');
      consumeBlock.classList.remove('hidden');
      if (sourceHint) {
        sourceHint.textContent = 'Код одноразовый, действует 10 минут и не передаёт пароль.';
      }
    }

    updateLinkCardFromProfile(status.profile);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function loadStatus() {
    const statusText = document.getElementById('accountLinkStatusText');
    if (statusText) statusText.textContent = 'Проверяем привязку…';
    try {
      renderStatus(await api('/api/account-link/status', { method: 'GET' }));
    } catch (error) {
      if (statusText) statusText.textContent = error.message;
    }
  }

  function formatRemaining(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function showGeneratedCode(data) {
    activeCode = data;
    const block = document.getElementById('accountLinkGenerated');
    const code = document.getElementById('accountLinkCodeValue');
    const expiry = document.getElementById('accountLinkCodeExpiry');
    if (!block || !code || !expiry) return;

    block.classList.remove('hidden');
    code.textContent = data.code;
    const expiresAt = new Date(data.expiresAt).getTime();

    window.clearInterval(countdownTimer);
    const update = () => {
      const remaining = expiresAt - Date.now();
      expiry.textContent = remaining > 0
        ? `Действует ещё ${formatRemaining(remaining)}`
        : 'Срок действия истёк';
      if (remaining <= 0) window.clearInterval(countdownTimer);
    };
    update();
    countdownTimer = window.setInterval(update, 1000);
  }

  async function generateCode() {
    const button = document.getElementById('generateLinkCode');
    if (button) button.disabled = true;
    try {
      const data = await api('/api/account-link/code', {
        method: 'POST',
        body: '{}'
      });
      if (data.alreadyLinked) {
        renderStatus(data);
        toast('Telegram и VK уже связаны');
        return;
      }
      showGeneratedCode(data);
      toast('Код создан');
    } catch (error) {
      toast(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function copyCode() {
    const code = activeCode?.code || document.getElementById('accountLinkCodeValue')?.textContent || '';
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast('Код скопирован');
    } catch (_) {
      const input = document.createElement('textarea');
      input.value = code;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      toast('Код скопирован');
    }
  }

  function normalizeCodeInput(value) {
    const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const body = compact.startsWith('PIV') ? compact.slice(3) : compact;
    const trimmed = body.slice(0, 8);
    if (trimmed.length <= 4) return `PIV-${trimmed}`;
    return `PIV-${trimmed.slice(0, 4)}-${trimmed.slice(4)}`;
  }

  async function consumeCode() {
    const input = document.getElementById('accountLinkCodeInput');
    const button = document.getElementById('consumeLinkCode');
    const code = normalizeCodeInput(input?.value || '');
    if (code.replace(/[^A-Z0-9]/g, '').length !== 11) {
      toast('Введите полный код PIV-XXXX-XXXX');
      return;
    }

    if (button) button.disabled = true;
    try {
      const data = await api('/api/account-link/consume', {
        method: 'POST',
        body: JSON.stringify({ code })
      });
      if (data.token) saveToken(data.token);
      toast('Аккаунты объединены. Открываем единый профиль…');
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      toast(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function injectStyles() {
    if (document.getElementById('account-link-styles')) return;
    const style = document.createElement('style');
    style.id = 'account-link-styles';
    style.textContent = `
      .account-link-entry-block{margin-top:14px}
      .account-link-entry{width:100%;display:flex;align-items:center;gap:12px;text-align:left}
      .account-link-entry-copy{display:flex;flex-direction:column;gap:3px;flex:1}
      .account-link-entry-copy small{opacity:.7}
      .account-link-mark{display:grid;place-items:center;width:42px;height:42px;border-radius:14px;background:rgba(255,255,255,.08);font-weight:900}
      .account-link-sheet{display:flex;flex-direction:column;gap:14px}
      .account-link-identities{display:grid;gap:8px}
      .account-link-identity{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:14px}
      .account-link-identity span{opacity:.75;overflow:hidden;text-overflow:ellipsis}
      .account-link-identity i{font-style:normal;font-size:12px;opacity:.65}
      .account-link-generated{padding:16px;border:1px solid rgba(255,255,255,.12);border-radius:16px;text-align:center}
      .account-link-code{font-size:25px;font-weight:900;letter-spacing:2px;margin:7px 0}
      .account-link-generated-actions{display:flex;gap:8px;margin-top:12px}
      .account-link-generated-actions button{flex:1}
      .account-link-consume{display:grid;gap:10px}
      .account-link-consume input{text-transform:uppercase;letter-spacing:1px}
      .account-link-warning{font-size:12px;line-height:1.45;opacity:.65}
      .account-link-empty{padding:12px;opacity:.65}
    `;
    document.head.appendChild(style);
  }

  function injectInterface() {
    if (document.getElementById('accountLinkModal')) return;
    injectStyles();

    const helpBlock = document.querySelector('.help-entry-block');
    if (helpBlock) {
      const entry = document.createElement('div');
      entry.className = 'section-block account-link-entry-block';
      entry.innerHTML = `
        <button class="help-entry account-link-entry" id="openAccountLink" type="button">
          <span class="account-link-mark">↔</span>
          <span class="account-link-entry-copy">
            <b>Telegram и VK</b>
            <small id="accountLinkCardValue">Проверяем привязку…</small>
          </span>
          <span class="help-entry-arrow">›</span>
        </button>
      `;
      helpBlock.parentNode.insertBefore(entry, helpBlock);
    }

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'accountLinkModal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="modal-sheet tall-sheet account-link-sheet">
        <button class="close" id="closeAccountLink" type="button">×</button>
        <span class="muted">Единая учётная запись</span>
        <h2>Связать Telegram и VK</h2>
        <p class="help-intro" id="accountLinkStatusText">Проверяем привязку…</p>
        <div class="account-link-identities" id="accountLinkIdentities"></div>
        <small id="accountLinkSourceHint"></small>

        <button class="primary full" id="generateLinkCode" type="button">Создать одноразовый код</button>

        <div class="account-link-generated hidden" id="accountLinkGenerated">
          <small>Код привязки</small>
          <div class="account-link-code" id="accountLinkCodeValue">PIV-0000-0000</div>
          <small id="accountLinkCodeExpiry">Действует 10 минут</small>
          <div class="account-link-generated-actions">
            <button class="secondary" id="copyAccountLinkCode" type="button">Скопировать</button>
          </div>
        </div>

        <div class="account-link-consume" id="accountLinkConsumeBlock">
          <label>Код с другой платформы
            <input class="text-input" id="accountLinkCodeInput" inputmode="text" maxlength="13" placeholder="PIV-XXXX-XXXX" autocomplete="one-time-code" />
          </label>
          <button class="primary full" id="consumeLinkCode" type="button">Объединить аккаунты</button>
        </div>

        <p class="account-link-warning">
          После объединения будет один баланс, один QR-код, одна история и один прогресс по литрам.
          Честно заработанные бонусы сохранятся. Повторные регистрационные награды второй раз не учитываются.
        </p>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('openAccountLink')?.addEventListener('click', () => {
      openModal('accountLinkModal');
      void loadStatus();
    });
    document.getElementById('closeAccountLink')?.addEventListener('click', () => closeModal('accountLinkModal'));
    document.getElementById('generateLinkCode')?.addEventListener('click', () => void generateCode());
    document.getElementById('copyAccountLinkCode')?.addEventListener('click', () => void copyCode());
    document.getElementById('consumeLinkCode')?.addEventListener('click', () => void consumeCode());
    document.getElementById('accountLinkCodeInput')?.addEventListener('input', (event) => {
      event.target.value = normalizeCodeInput(event.target.value);
    });
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal('accountLinkModal');
    });
  }

  function updateConsentCopy() {
    const consent = document.getElementById('consentModal');
    if (!consent) return;
    const paragraph = consent.querySelector('.consent-sheet > p');
    if (paragraph) {
      paragraph.textContent = 'Для работы бонусной программы используются идентификаторы привязанных аккаунтов VK и Telegram, имя, бонусный баланс и история операций.';
    }
    const firstListItem = consent.querySelector('li');
    if (firstListItem) {
      firstListItem.textContent = 'После привязки в VK и Telegram отображается один и тот же постоянный QR-код.';
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('#acceptTerms');
    if (button) explicitConsent = true;
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    injectInterface();
    updateConsentCopy();

    const mutationObserver = new MutationObserver(() => {
      updateConsentCopy();
      if (consentRequired) openConsentGate();
    });
    mutationObserver.observe(document.body, { subtree: true, childList: true });

    window.setTimeout(() => void loadStatus(), 1500);
  });
})();
