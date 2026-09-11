import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const server = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');

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
