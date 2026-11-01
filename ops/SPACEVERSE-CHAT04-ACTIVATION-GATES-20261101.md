# SPACEVERSE CHAT_04 — checkpoint 39/40: activation evidence gate (BLOCKED)

Date: 2026-11-01. Scope: **task 39 only**. Base `origin/main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`. Own branch: `spaceverse/chat04-activation-gates-39-20261101`. This is an audit of the existing default-deny implementation, **not** an activation implementation or authorization to merge/deploy.

## Current verified boundaries

- `admin-platform/server/onboarding-provisioning.ts`: `runCrmActivationCheck` rechecks the actual registered target's schema/ownership via `verifyTargetSchema(..., true)` and current actor/source before finishing; the result is deliberately `action_required / CRM_MARKET_CONTRACT_REQUIRED`, never success. A saved schema result or POS report is not an activation.
- `admin-platform/server/onboarding-provisioning.ts:finish` rechecks actor/grants, frozen source and lease under metadata transaction, denies a `succeeded` CRM activation outcome and audits only the blocked result. Lost leases cannot overwrite newer results.
- `admin-platform/admin-migrations/016_crm_activation_check.sql`: database CHECK rejects `status='succeeded'` for `step='crm_activation_check'`. Migration is manual; this audit does not apply it anywhere.
- `admin-platform/server/tenant-crm-activation-state.ts` and `tenant-crm-readiness.ts`: `activationAllowed=false`, `crmStatus=not_provisioned`; saved POS `active` is not a license or a live provider probe. Owner list preserves `not_configured/pending/verifying/failed/degraded` distinctions.
- `admin-platform/server/tests/tenant-crm-activation.spec.ts` already covers foreign/unowned target data, revoked grants and disabled account mid-check, stale POS evidence, failed audit, expired lease, attempted SQL success and canonical `venues.active=false`. No duplicate test or cross-chat runtime edit added.
- `admin-platform/server/evotor-market-license-policy.ts` is **UNMOUNTED/default deny**. The current store binding migration 024 cannot produce `ready`, and no trusted license issuer/runtime authorization/approved commercial policy is connected. An incoming callback `active` is insufficient.

## Evidence from preceding task, not a live proof

- Task 38 Draft [#376](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/376), HEAD `4c9f0f07a610d6ad81018f23c458b2d61cb982d3`: native PG16 [41277876275](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41277876275) SUCCESS, release gate [41277876208](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41277876208) SUCCESS, browser [41277876225](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41277876225) SUCCESS. This verifies task 38's isolated recovery test only. Task 37 [#373](https://github.com/GrafTrahula666/pivnik-bonus-app/pull/373) touches the same test file; Chat 01 must review combined integration.
- `main` was re-read before this checkpoint; no activation or production changes were made. Railway project `pivnik-admin-staging` was inspected read-only, not treated as live activation evidence.
- Local checkout unavailable (`git ls-remote` DNS failure); **no local** `npm run materialize` (once or twice), `node --test`, `npm run check`, or `npm audit` was run for task 39. No task-39 CI claim until this docs-only branch has an exact-head run.

## BLOCKED: evidence required before any `active` transition

1. Approved official provider test account/app/store/terminal, documented OAuth state echo, independent verified owner/store binding and revocation, no cross-company or cross-venue scope substitution.
2. Approved license unit, plan/trial/grace policy, trusted server-side entitlement issuer, verified installation/subscription/sequence/reconciliation/expiry and runtime revocation on every CRM access. Existing unmounted policy cannot issue a license.
3. Explicit authorized non-production E2E on a dedicated native PostgreSQL target: exact company/venue rights, target schema and data ownership, separate POS evidence, negative/expired/revoked cases, concurrent retries and rollback; independent review of any canonical activation transaction.
4. Chat 01 integration approval and a **separate** authorized release/production change process. No live test or production writes authorized by this task.

**Disposition:** `BLOCKED_EXTERNAL_EVIDENCE` for task 39, **not complete**. `merged=false`, `deployed=false`, `live_E2E=false`, `activation_allowed=false`; actual production feature-flag state **unknown**. The correct behavior today is fail closed and leave venues inactive. Do not remove the SQL CHECK, fake `ready`, auto-activate, or start task 40 as if 39 had passed.

## Handoff

Coordinator CHAT_01: review the existing negative tests and this evidence matrix, then request official provider/owner authorization and a separately approved non-production E2E. Once those external gates exist, resume task 39 in a **new minimal isolated change**, verify exact-head CI and only then consider task 40. No other chat PRs, `server.js`/`universal-server.js`, secrets, migrations, Railway or production were changed.

## Дополнительная проверка публичного контракта Эвотора (2026-11-01)

Источники ниже **публичные**. Это не подписанный договор, не право на вызов чужого API и не live E2E. Эти сведения не меняют `BLOCKED_EXTERNAL_EVIDENCE` и не разрешают `active/ready`.

| Вопрос | Публичная документация | Что подтверждено / чего ещё нет |
| --- | --- | --- |
| OAuth authorization code | https://developer.evotor.ru/docs/rest_oauth20_authorization_guide.html | Документирует web client, `authorization_code`, зарегистрированный `redirect_uri`, `POST https://oauth.evotor.ru/oauth/token`, scope `store:read`. Пример перенаправления содержит `?code=...`, но не показывает возврат `state`. **Это не доказательство отсутствия поддержки**; нельзя считать echo проверенным без официального ответа и разрешённого тестового roundtrip. |
| Независимая принадлежность магазина | https://developer.evotor.ru/docs/rest_stores.html | `GET /stores` возвращает `items[].id`, `items[].user_id` и постраничный `paging.next_cursor`; список должен быть прочитан полностью и сопоставлен с тем же авторизованным provider user и canonical company/venue. Публичный ответ не подтверждает права владельца нашего тестового аккаунта. |
| Установка / отзыв | https://developer.evotor.ru/docs/rest_api_webhooks_post_installation_event.html | Документированы `ApplicationInstalled`/`ApplicationUninstalled`, `id`, `productId`, `userId` и входящий `Authorization`; callback сам по себе не заменяет серверную проверку текущей установки, сессии и grants. |
| Подписка / последовательность | https://developer.evotor.ru/docs/rest_api_webhooks_post_subscription_event.html | `subscriptionId`, `sequenceNumber` (в рамках одной подписки; при переустановке новая последовательность), `planId`, `SubscriptionActivated`, `Renewed`, `Terminated` и изменения условий документированы. Событие `active` не равно действующей SPACEVERSE-лицензии без доказанной компании/точки, политики тарифа и актуального server-side reconcile. |
| Повторная доставка событий | https://developer.evotor.ru/docs/doc_subscriptions.html и https://developer.evotor.ru/docs/rest_api_webhooks_post_subscription_event.html | **Несоответствие источников:** общая статья «Подписки» утверждает повторную доставку до 3 дней, справочник `POST /subscription/event` до 2 суток. Не кодировать ни один интервал как гарантию и не основывать разрешение на доступе только на предположительном retry horizon. Требуется уточнение у Эвотора и reconciliation независимо от вебхуков. |

### Конкретный запрос для закрытия внешнего gate

Проверить с официальным техническим контактом/тестовым аккаунтом: (1) сохраняется ли произвольный OAuth `state` дословно на callback и как корректно связать `code` с независимым owner/store proof; (2) какая схема API и какое доказательство гарантируют текущие installation/owner/store/terminal rights; (3) какие условия лицензирования доступны для cloud CRM, что является оплаченной единицей (company/venue/terminal), как подтверждать платный план, trial/grace, истечение и revoke; (4) какая реально гарантирована доставка subscription webhooks, существуют ли поддерживаемые API reconciliation и тестовое окружение. Запрос должен идти без токенов, client secret и персональных данных.

**Test gate после получения ответов и отдельного разрешения:** isolated provider test account + server-only OAuth exchange + exact `state` replay/expiry/foreign session negative cases + all-pages `GET /stores` + current canonical owner grant and store/terminal scope + installation/subscription/revocation/sequence tests + отдельный native DB E2E. Ни один из этих пунктов **не был выполнен на реальном провайдере** в текущей итерации. SQL-ограничение на `crm_activation_check=succeeded` и флаги по умолчанию не менять до независимого лицензирования и утверждённой активационной транзакции.
