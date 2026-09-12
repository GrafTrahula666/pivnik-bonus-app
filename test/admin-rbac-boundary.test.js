import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const server = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');
const gateway = await fs.readFile(new URL('../universal-server.js', import.meta.url), 'utf8');

function adminRouteDeclarations(source) {
  const routeStart = /app\.(get|post|put|patch|delete)\(\s*(['"`])(\/api\/admin[^'"`]*)\2/g;
  const matches = [...source.matchAll(routeStart)];

  return matches.map((match, index) => {
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    const declaration = source.slice(start, end).slice(0, 2500);
    const handlerBoundary = declaration.search(/\basync\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|\basync\s+function\b|\bfunction\s*\(/);
    const middleware = handlerBoundary >= 0 ? declaration.slice(0, handlerBoundary) : declaration;

    return {
      method: match[1].toUpperCase(),
      path: match[3],
      middleware
    };
  });
}

function gatewayAdminRouteDeclarations(source) {
  const routeStart = /if\s*\(\s*req\.method\s*===\s*(['"`])(GET|POST|PUT|PATCH|DELETE)\1\s*&&\s*url\.pathname\s*===\s*(['"`])(\/api\/admin[^'"`]*)\3\s*\)\s*\{/g;
  const matches = [...source.matchAll(routeStart)];

  return matches.map((match, index) => {
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    return {
      method: match[2],
      path: match[4],
      body: source.slice(start, end).slice(0, 3000)
    };
  });
}

test('every Express /api/admin route is authenticated and role-gated on the server', () => {
  const routes = adminRouteDeclarations(server);
  assert.ok(routes.length > 0, 'expected to discover at least one /api/admin route in server.js');

  for (const route of routes) {
    assert.match(
      route.middleware,
      /\bauthRequired\b/,
      `${route.method} ${route.path} must include authRequired before its handler`
    );
    assert.match(
      route.middleware,
      /\brequireRole\s*\(/,
      `${route.method} ${route.path} must include requireRole(...) before its handler`
    );
  }
});

test('admin RBAC cannot be replaced by frontend-only visibility checks', () => {
  const routes = adminRouteDeclarations(server);
  const unguarded = routes.filter((route) => !/\bauthRequired\b/.test(route.middleware) || !/\brequireRole\s*\(/.test(route.middleware));

  assert.deepEqual(
    unguarded.map(({ method, path }) => `${method} ${path}`),
    [],
    'admin API authorization belongs on the backend even when the UI hides admin controls'
  );
});

test('every gateway /api/admin route authenticates and checks a server-side role', () => {
  const routes = gatewayAdminRouteDeclarations(gateway);
  assert.ok(routes.length > 0, 'expected to discover at least one /api/admin route in universal-server.js');

  for (const route of routes) {
    assert.match(
      route.body,
      /\brequireGatewayUser\s*\(\s*req\s*\)/,
      `${route.method} ${route.path} must authenticate with requireGatewayUser(req)`
    );
    assert.match(
      route.body,
      /\bprofile\.role\b/,
      `${route.method} ${route.path} must make an explicit server-side role decision`
    );
    assert.match(
      route.body,
      /(?:\.includes\s*\(\s*profile\.role\s*\)|profile\.role\s*===)/,
      `${route.method} ${route.path} must gate access using profile.role`
    );
  }
});

test('gateway admin RBAC cannot rely on authentication alone', () => {
  const routes = gatewayAdminRouteDeclarations(gateway);
  const unguarded = routes.filter((route) => {
    const authenticated = /\brequireGatewayUser\s*\(\s*req\s*\)/.test(route.body);
    const roleGated = /\bprofile\.role\b/.test(route.body)
      && /(?:\.includes\s*\(\s*profile\.role\s*\)|profile\.role\s*===)/.test(route.body);
    return !authenticated || !roleGated;
  });

  assert.deepEqual(
    unguarded.map(({ method, path }) => `${method} ${path}`),
    [],
    'gateway admin APIs require both authentication and explicit backend authorization'
  );
});
