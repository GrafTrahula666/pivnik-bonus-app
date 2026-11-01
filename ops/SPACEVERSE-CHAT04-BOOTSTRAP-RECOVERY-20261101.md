# SPACEVERSE CHAT_04 — checkpoint 38: bootstrap retry and rollback

- **Дата:** 2026-11-01. **Область:** задача 38/40; не затрагивать другие направления.
- **База:** `main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`.
- **Ветка:** `spaceverse/chat04-bootstrap-recovery-38-20261101`; точный HEAD и CI проверять по GitHub перед приёмкой.
- **Связанный пункт 37:** Draft PR #373 (другой набор тестов), не изменён.

## Фактическое изменение

Добавлен один целевой test-only regression в `admin-platform/server/tests/onboarding-tenant-bootstrap.spec.ts`. На втором из трёх изолированных fixture targets проверяется следующая цепочка:
1. Ошибка INSERT binding после подготовки DDL вызывает целиком откат target-транзакции; metadata step фиксирует только безопасный retryable error, attempt 1.
2. Повтор сохраняет target, но теряет ответ после commit; metadata step сохраняет retryable error / uncertain, attempt 2, без ложного успеха.
3. Третий запрос сверяет уже сохранённый target, возвращает `verified_existing`, attempt 3, не выполняя DDL снова; тест специально включает DDL fault-injection перед reconciliation. Повтор после успеха идемпотентен.
4. Проверяются одна scoped ledger row, ожидаемые error/succeed audit counts, неизменность двух соседних баз и `venues.active=false`.

Ранее существующие тесты каждого отдельного сбоя, прав доступа и конкурирующих claims не переписаны. Ни runtime, ни schema/migrations/API/флаги/секреты/клиентские данные не изменены.

## Статус / необходимые gates

**Статус на момент записи:** `IMPLEMENTED_IN_DRAFT` — код теста написан, но ещё не подтверждён CI на точном HEAD. Прогон release gate с двумя materialize, root `node --test`, `npm run check`, Business Vitest, аудитами; отдельно relevant PostgreSQL и браузерный CI необходимо прочитать по конечному коммиту. Локального checkout нет, локальные npm-команды не запускались. Fixture не заменяет native PostgreSQL contention и живой customer onboarding E2E.

**Merged:** нет. **Deployed:** нет. **Enabled:** не подтверждено. **Live E2E:** нет. Bootstrap/ready/tenant activation в production не выполнялись.

## Следующий шаг

Если CI упадёт из-за теста — починить только этот регрессионный сценарий в этом же Draft PR; если все релевантные gates на HEAD пройдены — передать `READY_FOR_COORDINATOR` для review Chat 01. Не мержить и не деплоить. Задачу 39 не начинать до приёмки этого шага.
