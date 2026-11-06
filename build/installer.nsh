; Wares Launcher - custom installer text and pages (electron-builder NSIS include)

!macro customHeader
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Wares Launcher"
  !define MUI_WELCOMEPAGE_TEXT "A fast, clean Minecraft launcher with profiles, Modrinth mods, skins and one-click FPS tuning.$\r$\n$\r$\nThis wizard installs Wares Launcher. You can choose where it goes on the next page.$\r$\n$\r$\nYour preset profiles and your game data folder are chosen in the launcher's own setup the first time it opens."
  !define MUI_DIRECTORYPAGE_TEXT_TOP "Wares Launcher will be installed in the folder below. To install in a different folder, click Browse and pick one. Game files are stored separately and can be placed on any drive from the launcher's first-run setup."
  !define MUI_FINISHPAGE_TITLE "Wares Launcher is ready"
  !define MUI_FINISHPAGE_TEXT "Setup has finished installing Wares Launcher.$\r$\n$\r$\nOn first start the launcher walks you through choosing a look, a game data folder and optional preset profiles."
  !define MUI_FINISHPAGE_LINK "Release notes and source on GitHub"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/kbpro12/wares-launcher"
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnInstall
  ; Profiles, worlds and settings live in the user's data folder and are kept on uninstall.
!macroend
