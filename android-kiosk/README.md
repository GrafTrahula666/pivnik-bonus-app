# Пивник — Android Bar Kiosk

Изолированная Android-оболочка для выделенного Samsung S23 Ultra. Она не подключается к PostgreSQL/Railway, не меняет бонусы, пользователей, роли, чеки или транзакции и не содержит токенов основного backend.

Функции: отдельный HOME/launcher экран, VK/Telegram, локальный admin PIN, Device Owner + Lock Task, возврат в kiosk после перезагрузки, локальные deep links и Always-on VPN hook.

VPN: на тестовом S23 Ultra фактический Telegram package — `org.telegram.messenger.web`, Happ — `su.happ.proxyutility`, VK — `com.vkontakte.android`. Для split tunneling направлять через VPN только Telegram, оставляя VK напрямую.

Для полного kiosk Android требует Device Owner/корпоративное provisioning. На подготовленном dedicated device:

`adb shell dpm set-device-owner ru.pivnik.kiosk/.PivnikDeviceAdminReceiver`

На уже полностью настроенном личном телефоне Android может потребовать корпоративное provisioning или сброс — это ограничение Android.
