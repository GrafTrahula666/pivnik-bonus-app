; Standard NSIS wizard, single-pass WriteUninstaller. No Wine execution or
; unsigned bootstrap executable is needed during the Linux build.
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "${PROJECT_DIR}/.data/installer-path.nsh"

Name "${PRODUCT_NAME}"
InstallDir "$LOCALAPPDATA\Programs\PIVNIK Halloween Live"
InstallDirRegKey HKCU "Software\PIVNIK\HalloweenLive" "InstallDir"
RequestExecutionLevel user
ShowInstDetails show
ShowUninstDetails show
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\PIVNIK Halloween Live.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить PIVNIK Halloween Live"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Требуется 64-разрядная Windows 11."
    Abort
  ${EndIf}
  SetShellVarContext current
FunctionEnd

Section "PIVNIK Halloween Live"
  SetOutPath "$INSTDIR"
  File /r "${PIVNIK_APP_OUT_DIR}/*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\PIVNIK Halloween Live"
  CreateShortcut "$DESKTOP\PIVNIK Halloween Live.lnk" "$INSTDIR\PIVNIK Halloween Live.exe"
  CreateShortcut "$SMPROGRAMS\PIVNIK Halloween Live\PIVNIK Halloween Live.lnk" "$INSTDIR\PIVNIK Halloween Live.exe"
  CreateShortcut "$SMPROGRAMS\PIVNIK Halloween Live\Удалить.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\PIVNIK\HalloweenLive" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PIVNIKHalloweenLive" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PIVNIKHalloweenLive" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PIVNIKHalloweenLive" "Publisher" "PIVNIK"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PIVNIKHalloweenLive" "DisplayIcon" "$INSTDIR\PIVNIK Halloween Live.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PIVNIKHalloweenLive" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PIVNIKHalloweenLive" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PIVNIKHalloweenLive" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  !include "${PROJECT_DIR}/.data/uninstall-files.nsh"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$DESKTOP\PIVNIK Halloween Live.lnk"
  Delete "$SMPROGRAMS\PIVNIK Halloween Live\PIVNIK Halloween Live.lnk"
  Delete "$SMPROGRAMS\PIVNIK Halloween Live\Удалить.lnk"
  RMDir "$SMPROGRAMS\PIVNIK Halloween Live"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PIVNIKHalloweenLive"
  DeleteRegKey HKCU "Software\PIVNIK\HalloweenLive"
SectionEnd
