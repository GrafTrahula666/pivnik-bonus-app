# Смены барного телефона (kiosk shifts)

Модуль `kiosk-shifts/` в шлюзе `universal-server.js` (маршрут `/api/kiosk/`), таблицы
`kiosk_shift_*` (миграция `012_kiosk_shifts.sql`). Бонусная система, пользователи и
`server.js` не затрагиваются. Выключен, пока нет `PIVNIK_KIOSK_SHIFTS=true`.

## Включение (по порядку)

1. Миграция (аддитивная, не автоматическая):
   `DATABASE_URL=… node scripts/apply-kiosk-shifts-migration.mjs --confirm APPLY_KIOSK_SHIFTS_012`
2. Railway variables (только сервер, в APK их нет):

| Переменная | Что это | Без неё |
|---|---|---|
| `PIVNIK_KIOSK_SHIFTS=true` | включает `/api/kiosk/v1` | 404 `disabled` |
| `KIOSK_SHIFT_ENROLL_CODE` | код ≥ 12 символов для «Подключить смены»; после подключения удалить | подключить телефон нельзя |
| `OPENAI_API_KEY`, `OPENAI_VISION_MODEL` (по умолчанию `gpt-5`) | проверка фото | документы не принимаются (503, смену не закрыть) |
| `KIOSK_SHIFT_TELEGRAM_CHAT_ID` (+ `KIOSK_SHIFT_TELEGRAM_BOT_TOKEN`, иначе `TELEGRAM_BOT_TOKEN`) | чат владельцев; бот должен быть в нём | уведомления ждут в очереди до 3 суток |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_SHIFT_SHEET` (`Смены`) | таблица; открыть доступ «Редактор» для `client_email` сервисного аккаунта, лист `Смены` создать | строки ждут в очереди до 3 суток |

3. На телефоне: долгое нажатие «ПИВНИК» → PIN → ввести код в «Код подключения смен» →
   «Подключить смены». В строке статуса появится `СМЕНЫ: OK`.
4. Удалить `KIOSK_SHIFT_ENROLL_CODE` (или сменить) — выданный ключ телефона продолжит работать.
   Отзыв телефона: `UPDATE kiosk_shift_devices SET revoked_at = NOW() WHERE public_id = '…'`.

## API (`Authorization: KioskShift <ключ телефона>`)

| Метод | Путь | Идемпотентность |
|---|---|---|
| POST | `/api/kiosk/v1/enroll` `{code,label}` | — (лимит 10 / 10 мин / IP) |
| GET | `/api/kiosk/v1/status` | — |
| POST | `/api/kiosk/v1/shifts` `{shiftId(uuid), employeeName, openedAt, previousUnclosed?}` | по `shiftId` |
| GET | `/api/kiosk/v1/shifts`, `/api/kiosk/v1/shifts/:id` | — |
| PUT | `/api/kiosk/v1/shifts/:id/documents/(report\|receipt\|invoice)/photos/:photoId` (JPEG/PNG/WebP, 1 КБ–8 МБ) | по `photoId` + SHA-256 |
| POST | `/api/kiosk/v1/shifts/:id/documents/:kind/submit` `{photoIds}` | принятый документ не перепроверяется |
| POST | `/api/kiosk/v1/shifts/:id/close` `{closedAt}` | повтор возвращает закрытую смену |

## Правила

- Время — Europe/Moscow. Открытие в 11:00:00 и позже = ОПОЗДАНИЕ.
- Табель: 1–3 фото одного листа; чек: 1–3 фото отдельно. Смешивать нельзя (разные `kind`).
- AI только переписывает значения; сервер принимает табель, только если: это бланк «ТАБЕЛЬ СМЕНЫ»,
  фото резкое и не обрезано, пять жирных прямоугольников заполнены и прочитаны с `confidence=high`
  (есть цифры, нет «?»), подпись есть. Никакой арифметики и сверки с чеком.
- Закрыть смену можно только после приёма табеля и чека сервером. Накладные не влияют.
- Новая смена при незакрытой предыдущей: старая получает статус `left_unclosed` (данные не
  удаляются), пишется `kiosk_shift_incidents`, владельцам — «Предыдущая смена не была закрыта.»
  Штраф не применяется. Решение владельца: `owner_decision = 'confirmed' | 'dismissed'`;
  подсказка суммы для n-го подтверждённого нарушения — `suggestedPenaltyRub(n)`: 3000 / 4000 / 5000 ₽.
- Telegram и Google Sheets идут через `kiosk_shift_outbox` (повторы с backoff). Google Sheets:
  одна смена = одна строка, ключ — столбец A (ID смены); значения пишутся как текст (RAW).
- Фото хранятся в `kiosk_shift_photos` (bytea). Имена — только UUID из запроса, путей на диске нет.
