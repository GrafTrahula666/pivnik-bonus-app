# Validation report

## Passed

### Syntax transpile
18 `.ts` / `.tsx` files were transpiled with the installed TypeScript compiler in syntax-diagnostic mode.

Result:

```text
checked=18 files_with_errors=0
```

### Offline domain security/editor checks

Executed directly against transpiled `src/domain.ts`.

Result:

```text
offline-domain-checks: 7/7 passed
```

Validated:
- Venue Admin A can access Venue A.
- Venue Admin A cannot access Venue B.
- forged / changed venue selection cannot return Venue B customer rows.
- Venue Admin A cannot mutate Venue B settings.
- SUPER ADMIN can cross tenants.
- enabled wheel prize probability totals calculate correctly.
- invalid loyalty level ordering is rejected.

## Blocked by sandbox environment

The current environment cannot reach the npm registry, so dependency installation timed out.

Chromium is present, but administrator policy blocks navigation to local files and localhost, so screenshots of the rendered React runtime could not be captured here.

Therefore the following are **not claimed as passed**:
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- zero-console-error browser smoke test
- production screenshot capture

Run those commands on a normal development machine before release.
