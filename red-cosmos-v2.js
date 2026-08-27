(() => {
  'use strict';

  const EXPECTED_PRIMARY = '#c41e3a';

  function normalizeColor(value) {
    const probe = document.createElement('span');
    probe.style.color = String(value || '').trim();
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }

  function verifyTheme() {
    const configured = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary-red')
      .trim()
      .toLowerCase();
    console.assert(
      configured === EXPECTED_PRIMARY,
      `RED COSMOS palette mismatch: expected ${EXPECTED_PRIMARY}, got ${configured || '(empty)'}`
    );

    document.documentElement.classList.add('red-cosmos-v2');
    document.documentElement.dataset.redCosmosPrimary = configured;
    document.documentElement.dataset.redCosmosPrimaryComputed = normalizeColor(configured);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', verifyTheme, { once: true });
  } else {
    verifyTheme();
  }
})();
