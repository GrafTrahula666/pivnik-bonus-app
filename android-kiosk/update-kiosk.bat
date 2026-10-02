@echo off
chcp 65001 >nul
setlocal
rem Обновление киоска ПОВЕРХ старого: Device Owner, PIN и настройки сохраняются.
rem Рядом положите app-debug.apk (или kiosk.apk) и, если есть, папку platform-tools.
rem Телефон подключён по USB, включена отладка по USB, на телефоне нажато "Разрешить".

set "DIR=%~dp0"
set "ADB=adb"
if exist "%DIR%platform-tools\adb.exe" set "ADB=%DIR%platform-tools\adb.exe"
if not exist "%DIR%kiosk.apk" if exist "%DIR%app-debug.apk" copy /y "%DIR%app-debug.apk" "%DIR%kiosk.apk" >nul

if not exist "%DIR%kiosk.apk" (
  echo НЕТ ФАЙЛА: kiosk.apk
  exit /b 1
)

"%ADB%" start-server
"%ADB%" devices
echo Телефон должен быть в списке выше со статусом "device". Нажмите любую клавишу...
pause >nul

echo [1/2] Обновляю киоск поверх старого
"%ADB%" install -r -t "%DIR%kiosk.apk"
if errorlevel 1 goto :fail

echo [2/2] Запуск
"%ADB%" shell am start -n ru.pivnik.kiosk/.MainActivity

echo.
echo ГОТОВО. Device Owner, PIN и настройки сохранены. Если кнопки "Включить Kiosk" нет - напишите.
exit /b 0

:fail
echo.
echo ОШИБКА установки поверх. Покажите этот текст, ничего не удаляйте.
exit /b 1
