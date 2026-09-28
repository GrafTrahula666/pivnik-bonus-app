# Базовое состояние Android kiosk до системы смен

Зафиксировано 2026-09-28 перед изменениями. Источник: commit `68fe9157c8e5bab45a9ee33f8be37096aa57841c`
(ветка `feature/android-bar-kiosk`, PR #98). Проверено: установленный на телефоне
`Pivnik-Kiosk-FINAL-V2.apk` (SHA256 `86BB18A8…1638`) собран именно из этого commit
(все 154 строковых литерала исходников присутствуют в dex, набор методов совпадает).

| Что | Значение в 68fe915 |
|---|---|
| package / applicationId | `ru.pivnik.kiosk` |
| versionCode / versionName | `1` / `0.1.0` |
| SDK | minSdk 28, targetSdk 35, compileSdk 35, AGP 8.7.3, Java, без AndroidX |
| Сборка | GitHub Actions `android-kiosk.yml`, `:app:assembleDebug`, debug + `testOnly=true` (`src/debug/AndroidManifest.xml`) |
| Подпись | debug keystore из кэша CI `pivnik-kiosk-debug-keystore-v2`, сертификат SHA256 `28EBAE22…F40E` (ключ в репозитории отсутствует) |
| Permissions | `INTERNET`, `RECEIVE_BOOT_COMPLETED`, `QUERY_ALL_PACKAGES` |
| Activities | `MainActivity` — LAUNCHER + HOME/DEFAULT, `singleTask`, portrait, `excludeFromRecents` |
| Receivers | `PivnikDeviceAdminReceiver` (Device Owner, policy `force-lock`); `BootReceiver` (`BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`) — запускает `MainActivity`, только если kiosk включён |
| Device Owner / Lock Task | `KioskController.apply`: lock-task packages = kiosk, `com.vkontakte.android`, `org.telegram.messenger.web`, VPN-пакет; `LOCK_TASK_FEATURE_NONE`; persistent HOME; `startLockTask` при `kiosk_enabled` |
| VK | `ACTION_VIEW https://vk.ru/app54694987` в пакете VK, иначе launch intent пакета |
| Telegram | `pivnik://open-telegram` в пакете `org.telegram.messenger.web` → нет обработчика → launch intent Telegram |
| VPN | Always-on VPN `su.happ.proxyutility` через `DevicePolicyManager.setAlwaysOnVpnPackage` |
| PIN/admin | долгое нажатие «ПИВНИК»; PIN ≥ 4 цифр, SHA-256 + соль в `pivnik_kiosk` prefs |
| Pairing/bootstrap | `/api/device/pair` (код `BAR-XXXX-XXXX` → `pvkdev_…` в Android Keystore), `/api/device/bootstrap` (`pvkboot_…` → `startapp`/`#fragment`); без привязки VK/TG открываются напрямую |
| Сервер | `https://pivnik-bonus-app-production-df60.up.railway.app` (только HTTPS) |

Всё перечисленное сохраняется. Изменения для системы смен — только добавления, плюс
расширение списка lock-task пакетов системными приложениями камеры/выбора фото
(иначе Android не даст открыть камеру в режиме kiosk).
