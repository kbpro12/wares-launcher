# GitHub updates

Wares Launcher updates itself from **https://github.com/kbpro12/wares-launcher** (Releases tab).
The repository is already configured in `package.json` and in `src/main/updater.js`.

## How users see updates
1. The launcher checks GitHub at startup and every 2 hours (or press the version number at the bottom of the sidebar, or Settings > Updates > Check now).
2. When a newer **published** release exists, a dialog shows the release notes: **Update now / Later / Skip this version**.
3. After the download finishes, a second dialog offers **Restart and update**. The install is silent and the launcher reopens by itself.
4. Settings > Updates has "Download updates in the background" if you want step 2 to happen without the question.

Updates work in the **installed** app (the `.exe`), not when running `npm start`.

## Publishing a new version
1. Change `"version"` in `package.json` (for example `1.0.1` to `1.0.2`). It must be higher than the installed one.
2. Write what changed. Whatever you put in the GitHub release description is what users read in the dialog.
3. Commit, tag and push:
   ```bash
   git add .
   git commit -m "Release 1.0.2"
   git tag v1.0.2
   git push origin main --tags
   ```
4. Open the **Actions** tab. The `Release` workflow builds the Windows installer and Linux AppImage and attaches them, plus `latest.yml`, to a release named after the tag.
5. Open **Releases**, edit the new release, write the notes, and make sure it is **published** (not a draft).

The tag and the version must match: tag `v1.0.2` for version `1.0.2`.

## First update after this change
Builds older than 1.0.1 could not read the repository setting, so they cannot update themselves.
Install `Wares-Launcher-Setup-1.0.1.exe` from the Releases page **once by hand**. From then on updates arrive inside the launcher.

## Beta channel
Mark a release as **Pre-release** (version like `1.1.0-beta.1`). Only users who choose Beta in Settings > Updates receive it.

## If an update does not show up
- The release is published, not a draft.
- It contains `latest.yml` next to the installer (the workflow adds it).
- The version number is higher than the installed one.
- The repository is public.
- You are testing the installed app.
- You did not press **Skip this version** earlier (use Settings > Updates > Check now to override).

## Notes
- Unsigned Windows installers show a SmartScreen warning the first time. Updating still works.
- The installer is mostly Electron itself (about 70 MB compressed). Wallpaper videos and GIFs are not bundled. Add your own under Settings > Background > Wallpapers.
