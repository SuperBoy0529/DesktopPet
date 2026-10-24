; Worldline Divergence Meter - per-user installer
; Compiled with the NSIS 3.04 from npmmirror (electron-builder-binaries).
; Classic pages only (no MUI2 include) so a trimmed NSIS distribution still works.
;
; Passed in from the build script:
;   /DSRCDIR=<staging dir with the app files>
;   /DOUTDIR=<full path of the produced Setup.exe>
;
; IMPORTANT: this file must stay ASCII-only. makensis reads scripts as ANSI
; unless they carry a BOM, and non-ASCII bytes abort the compile.

Unicode true
SetCompressor /SOLID lzma
Name "Worldline Divergence Meter"
BrandingText "Worldline Divergence Meter"
OutFile "${OUTDIR}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\WorldlineDivergenceMeter"
InstallDirRegKey HKCU "Software\WorldlineDivergenceMeter" "InstallDir"
ShowInstDetails show
ShowUninstDetails show
XPStyle on

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Var LaunchApp

Section "Install"
  SetOutPath "$INSTDIR"
  ; App payload. config.json / texts.json are left out on purpose so that
  ; upgrading never overwrites the user's own settings.
  File /r "${SRCDIR}\*.*"

  ; README ships with the app and gets a Start Menu entry.
  File "${SRCDIR}\..\..\README.md"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Step log so a failed install is diagnosable instead of a silent no-op.
  FileOpen $9 "$INSTDIR\install-log.txt" w
  FileWrite $9 "installdir=$INSTDIR$\r$\n"

  ClearErrors
  CreateDirectory "$SMPROGRAMS\Worldline Divergence Meter"
  IfErrors 0 +3
    FileWrite $9 "startmenu=mkdir failed$\r$\n"
    Goto +2
  FileWrite $9 "startmenu=mkdir ok$\r$\n"

  ClearErrors
  CreateShortCut "$SMPROGRAMS\Worldline Divergence Meter\Worldline Divergence Meter.lnk" "$INSTDIR\WorldlineDivergenceMeter.exe" "" "$INSTDIR\WorldlineDivergenceMeter.exe" 0
  IfErrors 0 +3
    FileWrite $9 "shortcut-app=failed$\r$\n"
    Goto +2
  FileWrite $9 "shortcut-app=ok$\r$\n"

  ClearErrors
  CreateShortCut "$SMPROGRAMS\Worldline Divergence Meter\README.lnk" "$INSTDIR\README.md"
  IfErrors 0 +3
    FileWrite $9 "shortcut-readme=failed$\r$\n"
    Goto +2
  FileWrite $9 "shortcut-readme=ok$\r$\n"

  ClearErrors
  CreateShortCut "$DESKTOP\Worldline Divergence Meter.lnk" "$INSTDIR\WorldlineDivergenceMeter.exe" "" "$INSTDIR\WorldlineDivergenceMeter.exe" 0
  IfErrors 0 +3
    FileWrite $9 "shortcut-desktop=failed$\r$\n"
    Goto +2
  FileWrite $9 "shortcut-desktop=ok$\r$\n"

  ClearErrors
  WriteRegStr HKCU "Software\WorldlineDivergenceMeter" "InstallDir" "$INSTDIR"
  IfErrors 0 +3
    FileWrite $9 "registry=denied$\r$\n"
    Goto +2
  FileWrite $9 "registry=ok$\r$\n"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorldlineDivergenceMeter" "DisplayName" "Worldline Divergence Meter"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorldlineDivergenceMeter" "DisplayVersion" "1.0.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorldlineDivergenceMeter" "Publisher" "Local Build"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorldlineDivergenceMeter" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorldlineDivergenceMeter" "DisplayIcon" "$INSTDIR\WorldlineDivergenceMeter.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorldlineDivergenceMeter" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorldlineDivergenceMeter" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorldlineDivergenceMeter" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorldlineDivergenceMeter" "NoRepair" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorldlineDivergenceMeter" "EstimatedSize" 380000

  FileWrite $9 "done=1$\r$\n"
  FileClose $9

  ; If shortcuts could not be created (restricted context), say so instead of
  ; silently pretending the install was complete. Silent installs stay quiet.
  IfFileExists "$SMPROGRAMS\Worldline Divergence Meter\Worldline Divergence Meter.lnk" shortcuts_ok
    IfSilent shortcuts_ok
    MessageBox MB_ICONEXCLAMATION "Installed to $INSTDIR.$\r$\n$\r$\nCreating the Start Menu / desktop shortcuts was denied by this system. The program itself works: run WorldlineDivergenceMeter.exe from the folder above. See install-log.txt for details."
  shortcuts_ok:

  StrCpy $LaunchApp "1"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\Worldline Divergence Meter.lnk"
  Delete "$SMPROGRAMS\Worldline Divergence Meter\Worldline Divergence Meter.lnk"
  Delete "$SMPROGRAMS\Worldline Divergence Meter\README.lnk"
  RMDir "$SMPROGRAMS\Worldline Divergence Meter"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorldlineDivergenceMeter"
  DeleteRegKey HKCU "Software\WorldlineDivergenceMeter"

  ; NOTE: user data (config.json / texts.json / state / logs) is intentionally
  ; kept, so an uninstall never destroys hand-edited lines of dialogue.
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\*.*"
  RMDir "$INSTDIR"
SectionEnd

Function .onInstSuccess
  StrCmp $LaunchApp "1" 0 +2
  ExecShell "open" "$INSTDIR\WorldlineDivergenceMeter.exe"
FunctionEnd
