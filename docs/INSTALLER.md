# Installer and first-run setup

## The Windows installer (`npm run dist`)
Branded NSIS wizard, built by electron-builder:

0. A **fading intro splash** with the Wares artwork (skipped for silent updates).
1. **Welcome** page with the Wares artwork, on a dark metal background.
2. **Install location**: choose any folder (default `%LOCALAPPDATA%\Programs\Wares Launcher`, no admin rights needed).
3. Install, with a dark terminal-style log, Desktop and Start menu shortcuts.
4. **Finish** page: "Launch Wares Launcher" and a GitHub link.

Updates reuse the same install folder and run silently.

Files: `build/installer.nsh` (texts and defines), `build/*.bmp` and `build/*.ico` (artwork; regenerate with
`python build/make-installer-art.py`), and the `build.nsis` block in `package.json`.

## First-run setup (inside the launcher)
The first time the launcher opens it shows a setup wizard:

1. **Look**: Modern or Brushed metal, accent colour, translucent interface.
2. **Game files**: choose the drive/folder for Minecraft versions, libraries, Java and profiles.
3. **Preset profiles**: tick any of Performance, Max FPS, Shaders, Quality of life, Low-end PC, Forge optimized, NeoForge optimized, PvP 1.8.9, Clean vanilla.
4. **Account**: Microsoft (default browser) or offline.
5. **Review**, then Start playing.

Re-run it any time from Settings > Data > Run setup again. Changing the game files folder later affects new downloads only; existing files stay where they are.

## Size
The installer is about 110 MB: nearly all of it is the Electron/Chromium runtime (`Wares Launcher.exe` alone is 240 MB
unpacked). Updates are much smaller because `differentialPackage` is on: the launcher downloads only the changed blocks.
