; Wares Launcher - custom installer text and pages (electron-builder NSIS include)

!macro customHeader
  !ifdef MUI_BGCOLOR
    !undef MUI_BGCOLOR
  !endif
  !define MUI_BGCOLOR "0d1016"
  !ifdef MUI_TEXTCOLOR
    !undef MUI_TEXTCOLOR
  !endif
  !define MUI_TEXTCOLOR "e6eaf0"
  !ifdef MUI_INSTFILESPAGE_COLORS
    !undef MUI_INSTFILESPAGE_COLORS
  !endif
  !define MUI_INSTFILESPAGE_COLORS "aeb8c8 0a0d12"
  !ifdef MUI_INSTFILESPAGE_PROGRESSBAR
    !undef MUI_INSTFILESPAGE_PROGRESSBAR
  !endif
  !define MUI_INSTFILESPAGE_PROGRESSBAR "colored"
  !ifdef MUI_WELCOMEPAGE_TITLE
    !undef MUI_WELCOMEPAGE_TITLE
  !endif
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Wares Launcher"
  !ifdef MUI_WELCOMEPAGE_TEXT
    !undef MUI_WELCOMEPAGE_TEXT
  !endif
  !define MUI_WELCOMEPAGE_TEXT "A fast, clean Minecraft launcher with profiles, Modrinth mods, skins and one-click FPS tuning. Downloads run through a native Rust helper, and the game starts with tuned Java flags.$\r$\n$\r$\nThis wizard installs Wares Launcher. You can choose where it goes on the next page.$\r$\n$\r$\nYour preset profiles and your game data folder are chosen in the launcher's own setup the first time it opens."
  !ifdef MUI_DIRECTORYPAGE_TEXT_TOP
    !undef MUI_DIRECTORYPAGE_TEXT_TOP
  !endif
  !define MUI_DIRECTORYPAGE_TEXT_TOP "Wares Launcher will be installed in the folder below. To install in a different folder, click Browse and pick one. Game files are stored separately and can be placed on any drive from the launcher's first-run setup."
  !ifdef MUI_FINISHPAGE_TITLE
    !undef MUI_FINISHPAGE_TITLE
  !endif
  !define MUI_FINISHPAGE_TITLE "Wares Launcher is ready"
  !ifdef MUI_FINISHPAGE_TEXT
    !undef MUI_FINISHPAGE_TEXT
  !endif
  !define MUI_FINISHPAGE_TEXT "Setup has finished installing Wares Launcher.$\r$\n$\r$\nOn first start the launcher walks you through choosing a look, a game data folder and optional preset profiles."
  !ifdef MUI_FINISHPAGE_LINK
    !undef MUI_FINISHPAGE_LINK
  !endif
  !define MUI_FINISHPAGE_LINK "Release notes and source on GitHub"
  !ifdef MUI_FINISHPAGE_LINK_LOCATION
    !undef MUI_FINISHPAGE_LINK_LOCATION
  !endif
  !define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/kbpro12/wares-launcher"
!macroend


; ---- extra wizard page: install choices, drawn in the launcher's own colours.
; Everything lives inside this macro because electron-builder includes this file before MUI2 is loaded.
!macro customPageAfterChangeDir
  !include "nsDialogs.nsh"
  !include "LogicLib.nsh"
  !define WARES_OPTIONS
  Var waresDlg
  Var waresDesktop
  Var waresStart
  Var waresLow
  Var waresHDesktop
  Var waresHStart
  Var waresHLow
  Var waresFontBig
  Var waresFontSmall
  Var waresImg
  Var waresImgH

  Function WaresOptionsCreate
    !insertmacro MUI_HEADER_TEXT "Make it yours" "Choose how Wares Launcher is set up on this PC."
    nsDialogs::Create 1018
    Pop $waresDlg
    ${If} $waresDlg == error
      Abort
    ${EndIf}
    SetCtlColors $waresDlg 0xE6EAF0 0x0D1016
    ${If} $waresDesktop == ""
      StrCpy $waresDesktop 1
    ${EndIf}
    ${If} $waresStart == ""
      StrCpy $waresStart 1
    ${EndIf}
    ${If} $waresLow == ""
      StrCpy $waresLow 0
    ${EndIf}
    InitPluginsDir
    File "/oname=$PLUGINSDIR\wares-options.bmp" "${BUILD_RESOURCES_DIR}\installerOptions.bmp"
    CreateFont $waresFontBig "Segoe UI Semibold" 13 600
    CreateFont $waresFontSmall "Segoe UI" 8 400

    ${NSD_CreateBitmap} 0 0 78u 100% ""
    Pop $waresImg
    ${NSD_SetStretchedImage} $waresImg "$PLUGINSDIR\wares-options.bmp" $waresImgH

    ${NSD_CreateLabel} 86u 4u 176u 16u "Make it yours"
    Pop $0
    SetCtlColors $0 0xFFFFFF 0x0D1016
    SendMessage $0 ${WM_SETFONT} $waresFontBig 0
    ${NSD_CreateLabel} 86u 22u 176u 18u "Every choice here can be changed later in the launcher."
    Pop $0
    SetCtlColors $0 0x8E98AA 0x0D1016

    ${NSD_CreateCheckbox} 86u 48u 176u 11u "Desktop shortcut"
    Pop $waresHDesktop
    SetCtlColors $waresHDesktop 0xE6EAF0 0x0D1016
    ${If} $waresDesktop == 1
      ${NSD_Check} $waresHDesktop
    ${EndIf}

    ${NSD_CreateCheckbox} 86u 66u 176u 11u "Start menu shortcut"
    Pop $waresHStart
    SetCtlColors $waresHStart 0xE6EAF0 0x0D1016
    ${If} $waresStart == 1
      ${NSD_Check} $waresHStart
    ${EndIf}

    ${NSD_CreateCheckbox} 86u 84u 176u 11u "Low-end PC mode"
    Pop $waresHLow
    SetCtlColors $waresHLow 0xE6EAF0 0x0D1016
    ${If} $waresLow == 1
      ${NSD_Check} $waresHLow
    ${EndIf}
    ${NSD_CreateLabel} 98u 96u 164u 24u "Still frames instead of animated backgrounds and a smaller memory footprint. PCs with under 4 GB of RAM switch this on by themselves."
    Pop $0
    SetCtlColors $0 0x8E98AA 0x0D1016
    SendMessage $0 ${WM_SETFONT} $waresFontSmall 0
    nsDialogs::Show
    ${NSD_FreeImage} $waresImgH
  FunctionEnd

  Function WaresOptionsLeave
    ${NSD_GetState} $waresHDesktop $waresDesktop
    ${NSD_GetState} $waresHStart $waresStart
    ${NSD_GetState} $waresHLow $waresLow
  FunctionEnd

  ; Install-progress page: flat accent bar on a dark track instead of the stock green Windows bar.
  Function WaresInstShow
    FindWindow $0 "#32770" "" $HWNDPARENT
    GetDlgItem $1 $0 1004
    System::Call 'uxtheme::SetWindowTheme(p r1, w " ", w " ")'
    SendMessage $1 0x2001 0 0x2E221C
    SendMessage $1 0x409 0 0xE0A36F
  FunctionEnd

  Page custom WaresOptionsCreate WaresOptionsLeave
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW WaresInstShow
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnInstall
  ; Profiles, worlds and settings live in the user's data folder and are kept on uninstall.
!macroend

; ---- intro splash (skipped for silent updates)
!macro customInit
  ${IfNot} ${Silent}
    InitPluginsDir
    File "/oname=$PLUGINSDIR\splash.bmp" "${BUILD_RESOURCES_DIR}\installerSplash.bmp"
    advsplash::show 2300 500 450 -1 "$PLUGINSDIR\splash"
    Pop $0
  ${EndIf}
!macroend

!macro customInstall
  DetailPrint "Wares Launcher files are in place."
  DetailPrint "Creating shortcuts and registering the uninstaller..."
  !ifdef WARES_OPTIONS
    ; empty = silent update: leave the user's existing shortcuts alone
    ${If} $waresDesktop == 0
      Delete "$DESKTOP\Wares Launcher.lnk"
    ${EndIf}
    ${If} $waresStart == 0
      Delete "$SMPROGRAMS\Wares Launcher.lnk"
    ${EndIf}
    ${If} $waresLow == 1
      DetailPrint "Applying low-end PC mode..."
      CreateDirectory "$APPDATA\Wares Launcher\config"
      FileOpen $0 "$APPDATA\Wares Launcher\config\installer-prefs.json" w
      FileWrite $0 '{"lowEnd":true}'
      FileClose $0
    ${EndIf}
  !endif
!macroend
