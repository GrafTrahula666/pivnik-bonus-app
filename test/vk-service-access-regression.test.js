import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { isConfiguredOwnerIdentity } from '../platform-core.js';

const read = (name) => fs.readFile(new URL(`../${name}`, import.meta.url), 'utf8');

class FakeClassList {
  constructor(initial = []) {
    this.values = new Set(initial);
  }
  toggle(name, force) {
    if (force === undefined) {
      if (this.values.has(name)) this.values.delete(name);
      else this.values.add(name);
      return this.values.has(name);
    }
    if (force) this.values.add(name);
    else this.values.delete(name);
    return Boolean(force);
  }
  contains(name) {
    return this.values.has(name);
  }
}

function extractRoleDefinitions(app) {
  const staff = app.match(/const roleCanStaff = \(role\) => [^\n]+;/)?.[0];
  const admin = app.match(/const roleCanAdmin = \(role\) => [^\n]+;/)?.[0];
  assert.ok(staff && admin, 'service role helpers must remain extractable');
  return `${staff}\n${admin}`;
}

function serviceVisibilityHarness(app, role) {
  const accessBlock = app.match(
    /  const hasStaffAccess = roleCanStaff\(profile\.role\);[\s\S]*?\$\('\.profile-shortcuts'\)\?\.insertAdjacentElement\('afterend', serviceAccess\);\n  \}/
  )?.[0];
  assert.ok(accessBlock, 'profile service visibility block must remain extractable');

  const elements = new Map([
    ['#profileStaffNav', { classList: new FakeClassList(['hidden']) }],
    ['#profileAdminNav', { classList: new FakeClassList(['hidden']) }],
    ['#profileServiceAccess', { classList: new FakeClassList(['hidden']) }],
    ['.profile-shortcuts', { insertAdjacentElement() {} }]
  ]);
  const context = {
    IS_VK: true,
    profile: { role },
    $: (selector) => elements.get(selector) || null
  };
  vm.runInNewContext(
    `${extractRoleDefinitions(app)}
function applyServiceVisibility(profile) {
${accessBlock}
}
applyServiceVisibility(profile);`,
    context
  );

  return {
    serviceHidden: elements.get('#profileServiceAccess').classList.contains('hidden'),
    staffHidden: elements.get('#profileStaffNav').classList.contains('hidden'),
    adminHidden: elements.get('#profileAdminNav').classList.contains('hidden')
  };
}

test('admin VK profile shows service section, bartender panel and admin panel', async () => {
  const app = await read('app.js');
  assert.deepEqual(serviceVisibilityHarness(app, 'admin'), {
    serviceHidden: false,
    staffHidden: false,
    adminHidden: false
  });
});

test('staff VK profile shows bartender panel but hides full admin panel', async () => {
  const app = await read('app.js');
  assert.deepEqual(serviceVisibilityHarness(app, 'staff'), {
    serviceHidden: false,
    staffHidden: false,
    adminHidden: true
  });
});

test('normal VK client hides both service panels', async () => {
  const app = await read('app.js');
  assert.deepEqual(serviceVisibilityHarness(app, 'client'), {
    serviceHidden: true,
    staffHidden: true,
    adminHidden: true
  });
});

test('configured VK owner mapping uses only the authenticated provider id and is safe when absent', () => {
  assert.equal(
    isConfiguredOwnerIdentity('vk', '424242', { vk: '424242', telegram: '999' }),
    true
  );
  assert.equal(
    isConfiguredOwnerIdentity('vk', '424243', { vk: '424242', telegram: '424243' }),
    false,
    'Telegram owner id must not authorize a VK identity'
  );
  assert.equal(isConfiguredOwnerIdentity('vk', '424242', { vk: '' }), false);
  assert.equal(isConfiguredOwnerIdentity('vk', '', { vk: '424242' }), false);
  assert.equal(isConfiguredOwnerIdentity('other', '424242', { vk: '424242' }), false);
});

test('existing configured VK owner is promoted independently of legacy multi-identity profile refresh', async () => {
  const gateway = await read('universal-server.js');
  const mappingIndex = gateway.indexOf('const isOwner = isConfiguredOwnerIdentity(provider, externalUser.id');
  const reconcileIndex = gateway.indexOf('Authorization is independent from profile-metadata ownership');
  const identityCountIndex = gateway.indexOf('const identityCount = await client.query(', reconcileIndex);
  const refreshGateIndex = gateway.indexOf('const shouldUpdateMainProfile = identityCountValue <= 1;', reconcileIndex);
  const returnPayloadIndex = gateway.indexOf('return { token, ...(await getAppPayload(userId, provider, { startup: true })) };');

  assert.ok(mappingIndex > 0, 'provider owner mapping must exist');
  assert.ok(reconcileIndex > mappingIndex, 'owner role reconciliation must follow signed identity mapping');
  assert.ok(identityCountIndex > reconcileIndex, 'owner role reconciliation must run before identity-count gating');
  assert.ok(refreshGateIndex > identityCountIndex, 'profile metadata gate must not wrap owner role reconciliation');
  assert.ok(returnPayloadIndex > refreshGateIndex, 'auth response must be built after role reconciliation');
  assert.match(
    gateway.slice(reconcileIndex, identityCountIndex),
    /if \(isOwner\)[\s\S]*?UPDATE users[\s\S]*?SET role = 'admin'[\s\S]*?AND role <> 'admin'/
  );
  assert.match(gateway, /role:\s*row\.role,/);
});

test('background VK profile hydration keeps the admin role returned by the authenticated backend profile', async () => {
  const app = await read('app.js');
  const applyPayload = app.match(
    /function applyProfilePayload\(data\) \{[\s\S]*?\n\}/
  )?.[0];
  const applyHydration = app.match(
    /function applyVkProfileHydration\(data\) \{[\s\S]*?\n\}/
  )?.[0];
  assert.ok(applyPayload && applyHydration, 'profile hydration functions must remain extractable');

  const context = {
    IS_VK: true,
    state: {
      profile: {
        id: '77',
        role: 'admin',
        photoUrl: null
      },
      statuses: []
    },
    applyDesign() {},
    renderCoreProfile() {}
  };
  vm.runInNewContext(
    `${applyPayload}
${applyHydration}
globalThis.applyVkProfileHydrationForTest = applyVkProfileHydration;`,
    context
  );

  context.applyVkProfileHydrationForTest({
    profile: {
      id: '77',
      role: 'admin',
      photoUrl: 'https://example.test/vk-owner.jpg'
    },
    statuses: []
  });

  assert.equal(context.state.profile.role, 'admin');
  assert.equal(context.state.profile.photoUrl, 'https://example.test/vk-owner.jpg');

  const vkPlatform = await read('vk-platform.js');
  assert.match(
    vkPlatform,
    /scheduleVkProfileSync\(signedLaunchParams\)[\s\S]*?originalFetch\('\/api\/auth'[\s\S]*?user: profile/
  );
  assert.match(vkPlatform, /pivnik:vk-profile-hydrated/);
});

test('direct frontend service navigation and backend service APIs stay role-gated', async () => {
  const [app, server, gateway] = await Promise.all([
    read('app.js'),
    read('server.js'),
    read('universal-server.js')
  ]);
  const switchScreen = app.match(
    /function switchScreen\(target, navigation = \{\}\) \{[\s\S]*?\n\}/
  )?.[0];
  assert.ok(switchScreen, 'switchScreen must remain extractable');

  const calls = [];
  const context = {
    state: { profile: { role: 'client' }, screenHistory: [] },
    $: () => { calls.push('dom'); return null; },
    $$: () => { calls.push('dom-many'); return []; },
    window: { scrollTo() { calls.push('scroll'); } },
    loadAdmin: async () => { calls.push('admin-load'); },
    openStaffWorkspace: async () => { calls.push('staff-load'); },
    renderPromotions() {},
    renderLeaderboard() {},
    showHistory: async () => {},
    toast() {}
  };
  vm.runInNewContext(
    `${extractRoleDefinitions(app)}
${switchScreen}
globalThis.switchScreenForTest = switchScreen;`,
    context
  );
  context.switchScreenForTest('admin');
  context.switchScreenForTest('staff');
  assert.deepEqual(calls, [], 'client direct calls must stop before any service-screen side effect');

  assert.match(
    server,
    /app\.get\('\/api\/staff\/session', authRequired, requireRole\('staff', 'admin'\)/
  );
  assert.match(
    server,
    /app\.get\('\/api\/admin\/summary', authRequired, requireRole\('viewer', 'admin'\)/
  );
  assert.match(
    server,
    /app\.post\('\/api\/admin\/users\/:id\/role', authRequired, requireRole\('admin'\)/
  );
  assert.match(
    gateway,
    /if \(!\['staff', 'admin'\]\.includes\(\(await getProfile\(user\.id\)\)\.role\)\)/
  );
  assert.match(
    gateway,
    /if \(!profile \|\| !\['viewer', 'admin'\]\.includes\(profile\.role\)\)/
  );
});
