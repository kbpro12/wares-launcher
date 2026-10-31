# Wares Launcher

Fast, low-memory Minecraft launcher built on Electron. By VisdomXD.

## Run

```bash
npm install
npm start
```

Needs Node 20+ and a normal internet connection on first launch (version lists, Java, game files).

Build an installer: `npm run dist` (Windows NSIS, Linux AppImage, macOS dmg).

## What it does

| Area | Details |
|---|---|
| Profiles | Per-profile game folder, version, loader, memory, Java, JVM tuning, resolution, auto-join server, icon and notes. Duplicate with or without files. |
| Presets | Performance, Max FPS, Shaders, Quality of life, Low-end PC, Forge optimized, NeoForge optimized, PvP 1.8.9, Clean vanilla. Mods are installed from Modrinth. |
| Loaders | Vanilla (alpha to latest, snapshots), Fabric, Quilt, Forge, Forge + OptiFine, NeoForge. |
| Mods | Enable/disable, delete, metadata and icons, Modrinth browser with dependency install, update checker. |
| Resource packs | Enable, disable, reorder (writes options.txt), Modrinth browser. |
| Shaders | Install, choose active pack (Iris and OptiFine config), Modrinth browser. |
| Modpacks | Modrinth `.mrpack` install and import, creates a ready profile. |
| Accounts | Microsoft (in-app window or system browser) and offline accounts. Tokens encrypted with the OS keystore. |
| Skins and capes | Live front/back preview, upload to account, switch capes, look up any player, local skin library. |
| Look | Brushed-metal default, 8 themes, custom accent, 9 animated scenes, and wallpaper presets from files (images, GIF, MP4, WebM). |
| Updates | Self-update from GitHub Releases, stable and beta channels. |
| Java | Missing Java is installed automatically (Mojang runtime, Adoptium backup). |
| Console | Live game log with filters; log files kept in the data folder. |

## Updates and releases

The launcher updates itself from GitHub Releases. Setup is in `docs/GITHUB-UPDATES.md`.

## Wallpapers

Drop images, GIFs or videos into `renderer/assets/wallpapers` (or the user folder opened from Settings > Background) and they appear as wallpaper presets.

## Notes

- **OptiFine** has no public API. "Forge + OptiFine" installs Forge, and you add the OptiFine jar you downloaded from optifine.net in the profile editor.
- **CurseForge** packs are not supported. Modrinth `.mrpack` only.
- **Offline accounts** cannot show a skin to other players on online-mode servers.
- Java is detected, or downloaded automatically (Adoptium) per Minecraft version.
- Data lives in the Electron `userData` folder (Settings > Data > Open data folder).

## Speed and memory

- Fast start: game files are verified once, then trusted. A quick crash re-verifies automatically.
- Auto JVM tuning by RAM, Log4Shell mitigation for old versions, process priority tuned while a game runs.
- Cached mod metadata and icons on disk, off-screen list rows skipped by the renderer.
- Animations adapt their frame rate, pause when unfocused, on battery, or in game.
- Optional single graphics process and low-end device mode (Settings > Performance).

## Low memory

No UI framework, no bundler, no runtime dependencies besides `msmc` and `yauzl`. Animations run on one small canvas at a capped frame rate and pause when the window is unfocused or the game is running. Low resource mode and hardware acceleration toggles are in Settings > Performance.

## Layout

```
main.js, preload.js        Electron entry and secure bridge
src/main/                  launch engine, loaders, Java, accounts, Modrinth, content, IPC
renderer/                  HTML, CSS, plain-JS views
```
