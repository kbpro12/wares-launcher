# Performance and the native helper (v1.2)

**Languages:** JavaScript (UI, Electron), Rust (`native/`, parallel downloads with streaming SHA-1), Java (the game, started with tuned JVM flags + AppCDS), NSIS (installer).

## Build the Rust helper
    npm run native          # cargo build --release --manifest-path native/Cargo.toml
    npm start               # the launcher finds native/target/release/wares-native(.exe) by itself
If the helper is missing or fails, downloads fall back to the built-in JS downloader automatically.
`npm run dist` / the GitHub release workflow bundle it as `resources/native/wares-native(.exe)`.

## What changed for speed
- Blur (`backdrop-filter`), grain textures and CSS blur on video wallpapers removed: the main cause of UI lag.
- GPU rasterization, zero-copy, off-thread image decode, lazy images, `content-visibility` on long lists.
- Frame-time guard: if the UI runs under ~35 fps it switches to Lite visuals once (Settings > Low resource mode to undo).
- Game: AppCDS archive per profile (Java 19+) for faster starts; Rust downloader for libraries/assets.

## Installer
`python build/make-installer-art.py` regenerates all artwork (sidebar, header, splash, options page). Custom pages live in `build/installer.nsh`.

## UI (v1.3) - Prism skin
- Settings > Appearance: skin (Prism / Classic), sidebar (floating dock / always open / icons only), sidebar side, corners, spacing, accent glow, calm animations, accent presets, dancing player (on/off, dance, size).
- Backgrounds (brushed metal, animated scenes, wallpapers) are unchanged.
- The Home player is pure CSS 3D (`renderer/js/player3d.js`, `renderer/css/prism.css`); every animation is a compositor transform.

## v1.4 - Rust player renderer, fixes
- `native/render/` (Rust, `no_std`, ~13 KB WebAssembly) draws the Home player with a z-buffered software rasteriser. It replaced the CSS-3D player, whose face sorting flickered. Rebuild: `npm run render` (needs `rustup target add wasm32-unknown-unknown`; the built file `renderer/js/wares-render.wasm.js` is committed).
- `native/` helper gained `boost` (game priority, no EcoQoS, trims the launcher's idle memory on Windows) and `prefetch` (warms the file cache for the classpath and mods before Java starts).
- Removed: the zero-copy/GPU-raster switches, full-document resize rule, infinite decorative loops. The sidebar no longer expands over the page.
- The game itself still runs on the JVM, which is what keeps Java mods working.
