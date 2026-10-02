# План постоянного ключа подписи (release gate)

Ключ ещё НЕ создан. Этот шаг выполняется один раз, отдельно, после подтверждения владельца.

## Почему

Установленный kiosk (versionCode 1) подписан debug-ключом из кэша GitHub Actions
(`28EBAE22…F40E`); кэш пуст, ключ, скорее всего, утерян. Android ставит обновление поверх
только с тем же ключом. Если старый ключ не найдётся — один последний factory reset и
повторный Device Owner, после чего все будущие версии ставятся поверх с постоянным ключом.

## 1. Создать ключ (на компьютере владельца, один раз)

```
keytool -genkeypair -v -keystore pivnik-kiosk-release.jks -alias pivnik-kiosk ^
  -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Pivnik Kiosk, O=Pivnik, C=RU"
```
Пароли — длинные случайные (менеджер паролей), не `android`.

## 2. Где хранить (минимум 3 копии)

1. Менеджер паролей владельца (файл `.jks` вложением + оба пароля).
2. Зашифрованная флешка / офлайн-носитель в сейфе.
3. GitHub Actions secrets (для CI). Кэш CI для ключей не использовать никогда.

## 3. GitHub secrets

| Secret | Значение |
|---|---|
| `KIOSK_RELEASE_KEYSTORE_B64` | `base64 -w0 pivnik-kiosk-release.jks` |
| `KIOSK_RELEASE_STORE_PASSWORD` | пароль хранилища |
| `KIOSK_RELEASE_KEY_ALIAS` | `pivnik-kiosk` |
| `KIOSK_RELEASE_KEY_PASSWORD` | пароль ключа |
| `KIOSK_RELEASE_CERT_SHA256` | ожидаемый SHA-256 сертификата (для проверки) |

## 4. Подпись в CI

`app/build.gradle` уже читает `KIOSK_RELEASE_STORE_FILE`, `KIOSK_RELEASE_STORE_PASSWORD`,
`KIOSK_RELEASE_KEY_ALIAS`, `KIOSK_RELEASE_KEY_PASSWORD`; без них release остаётся неподписанным.
Шаги workflow:
```
echo "$KIOSK_RELEASE_KEYSTORE_B64" | base64 -d > "$RUNNER_TEMP/release.jks"
KIOSK_RELEASE_STORE_FILE="$RUNNER_TEMP/release.jks" gradle :app:testDebugUnitTest :app:assembleRelease
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk | grep "SHA-256 digest: $KIOSK_RELEASE_CERT_SHA256" || exit 1
rm -f "$RUNNER_TEMP/release.jks"
```

## 5. Проверка SHA-256

```
apksigner verify --print-certs app-release.apk
keytool -list -v -keystore pivnik-kiosk-release.jks -alias pivnik-kiosk
```
Отпечаток записать в этот файл и в `KIOSK_RELEASE_CERT_SHA256`. Перед каждой установкой
сверять: `adb shell dumpsys package ru.pivnik.kiosk | findstr signatures` (только чтение).

## 6. Чтобы больше не потерять

- Ключ никогда не генерируется в CI и не хранится в кэше CI.
- CI падает, если отпечаток не совпал.
- Раз в квартал — проверка, что копии 1 и 2 открываются и отпечаток совпадает.
- versionCode только растёт.
