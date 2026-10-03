# План подписи Android kiosk

## Актуальное состояние

Реальное kiosk-устройство уже было успешно обновлено новой версией поверх ранее установленной без удаления приложения и без factory reset. Поэтому прежнее предположение «ключ из CI-кэша утерян и обновление поверх невозможно» больше не считается подтверждённым и не должно блокировать PR #165.

Критичный факт для следующих релизов: Android принимает обновление только с совместимой подписью. Текущий механизм подписи, которым было выполнено успешное обновление, нужно сохранить до любых изменений signing config.

## P0 — зафиксировать и резервировать текущий рабочий ключ

До смены ключа или перевода сборки на новый release-key:

1. Снять SHA-256 сертификата с **установленного** APK и с APK, которым успешно обновили устройство.
2. Убедиться, что отпечатки совпадают.
3. Найти фактически использованный keystore и сделать минимум 2 независимые резервные копии вне CI-кэша.
4. Записать источник ключа и SHA-256 сюда. Секретный файл и пароли в репозиторий не коммитить.
5. Только после этого менять workflow/signing config.

Пока эти пункты не выполнены, **не генерировать новый ключ и не делать factory reset**: это может разорвать уже работающую цепочку обновлений.

Проверка установленного пакета (только чтение):

```
adb shell dumpsys package ru.pivnik.kiosk
```

Проверка APK:

```
apksigner verify --print-certs app-debug.apk
```

Если доступен keystore:

```
keytool -list -v -keystore <path-to-keystore> -alias <alias>
```

## Резервирование

Минимум 3 независимых места:

1. менеджер паролей владельца: keystore + пароли/alias;
2. зашифрованный офлайн-носитель;
3. GitHub Actions secrets для CI.

CI-кэш не считается резервной копией.

## Целевая схема CI

Когда рабочий keystore идентифицирован и сохранён, workflow должен получать его только из secrets и проверять ожидаемый сертификат:

| Secret | Значение |
|---|---|
| `KIOSK_RELEASE_KEYSTORE_B64` | base64 рабочего keystore |
| `KIOSK_RELEASE_STORE_PASSWORD` | пароль хранилища |
| `KIOSK_RELEASE_KEY_ALIAS` | alias |
| `KIOSK_RELEASE_KEY_PASSWORD` | пароль ключа |
| `KIOSK_RELEASE_CERT_SHA256` | подтверждённый SHA-256 сертификата |

`app/build.gradle` уже поддерживает `KIOSK_RELEASE_STORE_FILE`, `KIOSK_RELEASE_STORE_PASSWORD`, `KIOSK_RELEASE_KEY_ALIAS`, `KIOSK_RELEASE_KEY_PASSWORD`.

Пример release-gate после сохранения secrets:

```
echo "$KIOSK_RELEASE_KEYSTORE_B64" | base64 -d > "$RUNNER_TEMP/release.jks"
KIOSK_RELEASE_STORE_FILE="$RUNNER_TEMP/release.jks" gradle :app:testDebugUnitTest :app:assembleRelease
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk | grep "$KIOSK_RELEASE_CERT_SHA256" || exit 1
rm -f "$RUNNER_TEMP/release.jks"
```

## Инварианты

- Не менять signing key, пока не подтверждён сертификат текущей рабочей цепочки обновлений.
- Ключ не генерируется автоматически в CI.
- Ключ не хранится только в CI-кэше.
- CI падает при несовпадении ожидаемого сертификата.
- `versionCode` только растёт.
- Раз в квартал проверять, что минимум две внешние резервные копии открываются и дают тот же SHA-256.
