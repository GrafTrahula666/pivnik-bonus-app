# CHAT 08 · Dashboard владельца · пункт 72, checkpoint

Дата: 2026-11-01. Режим: **отдельная ветка / Draft PR, без merge, deploy, правок production и секретов**.

## Подтверждённый переход
- Задача 71: аудит отсутствия доказанных смысловых KPI-дублей в docs-only PR #331; GitHub Actions `41266569671` завершился **success** (включая materialize ×2, Node tests, Business Vitest, npm audits). PR остаётся **Draft**, независимое ревью/merge координатором не сделаны. Результат передан в PR #325; его нельзя считать выпущенным.
- Перед этой правкой проверены `main@c92ed7cd65f1a96d94363c2b7e212424ab078a73`, открытый PR #331, ветки Dashboard, `ops/MODULE-MAP.md` и инварианты Do not break.
- Задача 72 **в разработке**, не объявлять завершённой до проверки всех трёх источников Dashboard.

## Сделано в этой ветке
- Последняя итерация: диагностика лога провалившегося CI, точечная правка только утверждения о CSS-классе отсутствующей метрики и актуализация карты модулей. Не менялись денежные вычисления.
- `admin-platform/src/phaseC/ProductionDashboard.tsx`: в **отдельной вкладке «Операции приложения»** основной ряд теперь содержит только 4 метрики выбранного периода в порядке: сумма операций приложения (не выручка Эвотора), записей о покупках, клиенты с завершёнными операциями, средняя сумма записи. Изменение рассчитывается к предыдущему периоду лишь при известной ненулевой базе; прежняя серверная арифметика неизменна.
- Оставшиеся **8** показателей остаются доступными через нативный `details/summary`, включая текущие snapshots «Клиентов всего» и «Бонусы в обращении» и недоступные «Посещения».
- `admin-platform/src/phaseC/cash-panel.css`: 4 колонки desktop / 2 touch narrow, компактный раскрываемый блок.
- `admin-platform/src/tests/app-operations-periods.spec.ts`: синтетический Vitest fixture тестирует порядок 4 KPI, реальные проценты сравнения, 8 сохранённых вторичных метрик и открытие disclosure.

- `admin-platform/src/phaseC/CashDashboard.tsx`: в обоих POS режимах 4 первичных KPI; подтверждённый `receiptCount`, linked `activeBuyers` только по PIVNIK, средний чек, выручка за вычетом возвратов. Данные операций и повторных покупателей не удалены, а вынесены в раскрываемый блок.
- `admin-platform/src/tests/cash-dashboard.spec.ts`, `cash-sales.spec.ts`: проверки неизвестного числа клиентов, истинной связи с приложением, чеков, порядка и сохранённых подробностей.
- `admin-platform/e2e/evotor-sales.spec.ts`: браузерные проверки новых 4 главных KPI / сохранённых деталей и существующего кассового сравнения. Не изменены суммы или фикстуры финансовой логики.

## Сохранённые границы
- **POS «Все продажи кассы» и «Клиенты приложения» также изменены на уровне отображения.** Основной ряд: чистая выручка, подтверждённые чеки продажи (или «Нет данных» при неизвестном `receiptCount`), только известные связанные покупатели PIVNIK (`report.app.activeBuyers`; «Нет данных», если подмножество неизвестно), средний чек. Количество документов продажи+возврата сохранено под `details`, вместе с повторными покупками и частотой в app POS. В POS нет подтверждённого количества **всех** уникальных покупателей, поэтому анонимные чеки нельзя превращать в клиентов.
- Cash POS `netCents`, `receiptCount`, `saleDocuments + returnDocuments` и `averageCents` не синонимы, не смешивать.
- Сумму бонусного журнала не называть фискальной выручкой. Не смешивать app POS и all POS в сумме.
- Не изменены `pos/*`, `server.js`, `universal-server.js`, миграции, patch-chain, auth/RBAC, бонусные выплаты, Railway и CI.
- `ops/MODULE-MAP.md` актуализирован: зафиксирована новая UI-иерархия Cash и App Dashboard и её границы; публичные API, server и invariant contracts остались прежними.

## Проверки и незакрытое
- Локального checkout и node_modules нет; команды `npm run materialize` ×2, `node --test`, `npm run check`, Business Vitest и browser E2E **не запускались локально**. GitHub Actions на `870786cc` проверил browser `41267334883` **success** (30 + 4 + 14 passed по логам) и native PostgreSQL `41267334879` **success**; release gate `41267334889` **failure**: единственная ошибка Business Vitest `cash-dashboard.spec.ts:35` неверно считала CSS-классы карточки `kpi-unavailable`. Node tests 606/606 passed, Business 646 passed / 1 failed / 90 skipped. Тест исправлен в `7c1fd28` с раздельной проверкой обычных/unavailable KPI и общего числа. 
- Подтверждено для одного и того же HEAD **`db62909ea6edbc998102e582de7059a5eeee7584`**: release gate [#41268034575](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268034575) **SUCCESS** (materialize×2, idempotence, `node --test`, Business Vitest, `npm run check`, dependency audits); browser [#41268034724](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268034724) **SUCCESS** (desktop/mobile synthetic fixtures, POS period comparison); native PostgreSQL [#41268034566](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/41268034566) **SUCCESS**. Runtime изменения этого PR проверены CI, но production smoke не проводился.
- Техническая часть **#72 ready for independent integration review**: все три режима Dashboard, сравнение POS по явному включению и mobile/browser fixtures прошли. Отдельный `CashComparison` остаётся opt-in во избежание второго автоматического POS-скана; задача #76 может развивать сравнение без скрытого фонового чтения. Не закрывать #72 как *интегрированный* до независимого ревью/решения координатора; не делать merge/deploy. `main` по состоянию проверки остаётся `c92ed7cd`.
- Контроль: должен сохраняться существующий ручной `CashComparison` и его поведение при отсутствии базы, 0, возвратах и недоступном POS.
- Остальные пункты #73–80 не начаты.

## Следующее действие
1. Не повторять зелёные CI на `db62909` без нового коммита/ревью. После любого изменения проверять CI на новом SHA.
2. Координатор CHAT_01 должен дать **независимое ревью** PR #343: проверить доступность 8 вторичных KPI и POS operations, корректность `Unknown ≠ zero`, разделение POS и loyalty, mobile и независимость кассового сравнения. Принять либо вернуть конкретные замечания.
3. PR #331 (семантика KPI, задача 71) также остаётся отдельным docs-only Draft, CI success, review отсутствует. Не мержить его автоматически вместе с #343.
4. Не переходить к #73 до завершения интеграционной приёмки #72 по установленной последовательной очереди. Следующий функциональный пункт: календарь **любой исторической даты** без искусственного ограничения глубины истории, при сохранении серверного лимита **длительности** периода. Не путать эти разные ограничения.

## 2026-11-01 · Task 72 follow-up: comparison deltas in primary POS cards
- Exact `CHAT_08.md` requirement #72 is **four top KPI metrics plus changes against comparable period**. Earlier draft provided the four metrics but left POS delta only inside the lower `CashComparison` block. This gap was identified by comparing implementation to the task source.
- Commit `e9e4904c4fe89257867bd4da2faf1124e41747b4` adds an optional `onResult` adapter to the existing comparison response (no new API or read), keeps BigInt-safe signed percentages in shared `cash-format.ts`, and displays period-qualified deltas inside the four primary POS cards. `Нет данных` stays unavailable, 0 remains a real value, and a zero comparison base displays `Нет базы для %` without infinity.
- Disabling comparison, switching period, request failure and stale current reports remove the top-card deltas; the original detailed comparison and previous/custom period controls stay intact. No production endpoints, accounting formulas, permissions, or extra background POS reads changed.
- Added Vitest for callback disable, four KPIs, missing buyers and stale state; browser e2e verifies the top changes appear only after opt-in and disappear on failure.
- **Verification pending:** GitHub Actions on the new HEAD after this documentation/test commit must pass. Prior green run on `6771876` was before this feature and is not proof for new code. PR still Draft; independently review with CHAT 01; no merge/deploy. Do not start #73 before review/acceptance of #72.
