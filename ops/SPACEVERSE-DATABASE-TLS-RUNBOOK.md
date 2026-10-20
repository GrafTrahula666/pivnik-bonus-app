# SPACEVERSE CRM: PostgreSQL TLS

Эта итерация закрывает кодовую причину R05 из SaaS-аудита. Она не переключает
production DSN, CA, Railway variables или роли БД и не подтверждает фактическую
доступность production-сервера. Публикация требует отдельного разрешения владельца.

## Политика существующих подключений

`admin-platform/server/database-transport.ts` используется всеми тремя Admin
pools (metadata, read-only reader, optional writer) и существующим защищённым
реестром отдельных tenant DB. Изоляция, SQL, лимиты pools, read-only options и
production write flags сохраняются. Новая tenant-модель и миграции не нужны.

- Внешний hostname требует TLS с проверкой цепочки сертификатов и имени сервера.
  Для IP явно проверяется выбранный IP, поскольку pg не передаёт IP в SNI.
- Исключение без TLS остаётся только для parsed host `localhost`, `127.0.0.1`
  или имени, заканчивающегося на `.railway.internal`. Строки в пароле, имени
  базы или поддельном суффиксе не расширяют это исключение. Это совместимость
  с прежним локальным/private транспортом, а не утверждение, что private сеть
  шифруется. Если внутренний сервер поддерживает доверенный TLS, можно явно
  выбрать `sslmode=verify-full`.
- `sslmode=require`, `prefer`, `verify-ca` и `verify-full` означают строгую
  проверку цепочки **и имени**, без plaintext fallback. `uselibpqcompat` не
  ослабляет этот контракт. `ssl=true`/`1` также требует строгий TLS.
- Внешние `disable`, `no-verify`, `allow`, `ssl=false`/`0`, повторные или
  противоречивые TLS-параметры отклоняются до открытия pool. Допускаются только
  канонические lowercase имена TLS-параметров. `sslnegotiation=direct` сохраняет
  строгую проверку; это не обещание поддержки direct negotiation самим сервером.
- URL не может заменить hostname/port/user/password/database через query или
  загрузить локальные файлы `sslrootcert`, `sslcert`, `sslkey`. TLS-параметры
  удаляются из connectionString до передачи в pg: его URL parser иначе может
  перезаписать явный `ssl` и выключить проверку. Percent-encoded hostname также
  отклоняется: pg дополнительно декодирует его, что может изменить тип адреса.
- Дополнительные CA предоставляются стандартным Node `NODE_EXTRA_CA_CERTS`
  при запуске процесса через защищённую конфигурацию среды. Файл содержит
  публичные сертификаты CA; серверные private keys сюда не загружаются.
  `PGSSLMODE` не заменяет явную политику приложения.

Пустой optional writer URL остаётся отсутствующим writer. Обязательные URL
проверяются существующим runtime config. Ошибки валидации содержат фиксированные
коды `ADMIN_DATABASE_TRANSPORT_INVALID` / `ONBOARDING_DATABASE_REGISTRY_INVALID`,
не URL, пароли или сертификаты. UI не получает новый доступ к настройкам БД.
Это исправление существующего транспорта; новые CRM-возможности по-прежнему
default-off. Ключей устройства и Telegram/VK эта итерация не касается.

## Локальная воспроизводимость

Из `admin-platform/`:

```sh
npx vitest run server/tests/database-transport.spec.ts server/tests/database-pools.spec.ts server/tests/onboarding-database-registry.spec.ts --maxWorkers=1
npm run build:api
node scripts/verify-database-tls.mjs
```

Unit tests проверяют конечную TLS-конфигурацию настоящего установленного pg
parser без сетевых подключений. Второй скрипт требует OpenSSL и loopback sockets:
создаёт собственный CA и однодневные синтетические сертификаты в уникальном
0700 каталоге `/tmp/spaceverse-synthetic-tls-*`. Private test keys имеют 0600;
они не коммитятся, не используются в production и не выводятся в лог.

Скрипт выполняет настоящий TLS handshake pg Client на 127.0.0.1. Доверенный
сертификат с правильным IP достигает синтетического PostgreSQL startup response;
недоверенный CA и неверное имя/IP не должны отправить ни одного startup message.
Также проверяются `ssl=true` и direct negotiation с ALPN `postgresql`.
Это проверка транспортной границы, не полноценный PostgreSQL SQL/login тест.
Отдельные native PostgreSQL HTTP/Business/E2E тесты проверяют реальные запросы.

Дополнительно 18 октября 2026 проверен отдельный собственный PostgreSQL 16
с TLS и синтетическим CA: настоящий login и SELECT из `pg_stat_ssl` подтвердили
TLS 1.3; без CA и с неверным именем клиент получил отказ. Контейнер после smoke
остановлен, тестовые данные сохранены. Команда и артефакты этого одноразового
стенда записаны в журнале прогресса. Это не проверка production DSN/CA.

## Перед разрешённым выпуском

Оператору необходимо проверить фактические hostname и транспорт каждой Admin
и tenant DB, наличие доверенного CA и срок сертификатов, включая rotation.
При custom CA файл передаётся через защищённый runtime mount и Node trust;
нельзя обходить ошибку через `rejectUnauthorized=false`, `no-verify` или общий
запрет TLS-проверок. Не переносить тестовый CA из локального smoke в production.

Сначала провести разрешённую staging-проверку metadata/auth/audit, read-only
reader и разрешённых write-сценариев с реальным CA. Ошибка сертификата должна
давать отказ, а не попытку без TLS. Нужен проверенный rollback на заранее
утверждённую версию; автоматический insecure fallback не предусмотрен.
Фактические production DSN/CA и такой staging/rollback здесь не проверялись.
