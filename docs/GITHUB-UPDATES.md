# GitHub update system: step by step

Wares Launcher updates itself from **GitHub Releases** using `electron-updater`.
You publish a release once; every installed launcher finds it, downloads it and offers "Restart to update".

Updates work in **installed** builds (the `.exe` installer from `npm run dist`). `npm start` shows
"running from source" and never updates.

---

## One-time setup

### 1. Create the repository
1. Sign in at github.com and click **New repository**.
2. Name it `wares-launcher`. Choose **Public** (private repos need a token inside every user's launcher, so keep it public).
3. Do not add a README. Click **Create repository**.

### 2. Point the launcher at it
Open `package.json` and replace `YOUR_GITHUB_USERNAME` in three places:

```json
"repository": { "type": "git", "url": "https://github.com/YOUR_GITHUB_USERNAME/wares-launcher.git" },
"homepage": "https://github.com/YOUR_GITHUB_USERNAME/wares-launcher",
...
"build": {
  "publish": [{ "provider": "github", "owner": "YOUR_GITHUB_USERNAME", "repo": "wares-launcher", "releaseType": "release" }]
}
```

### 3. Push the code
```bash
git init
git add .
git commit -m "Wares Launcher 1.0.0"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/wares-launcher.git
git push -u origin main
```

---

## Publishing a release (every update)

### Option A: automatic with GitHub Actions (recommended)
The file `.github/workflows/release.yml` is already in the project. No token setup is needed.

1. Raise the version in `package.json`, for example `1.0.0` to `1.0.1`.
2. Commit and tag:
   ```bash
   git add .
   git commit -m "Release 1.0.1"
   git tag v1.0.1
   git push origin main --tags
   ```
3. Open the **Actions** tab on GitHub. Wait for the build (about 5 minutes).
4. Open **Releases**. The new release contains `Wares Launcher Setup 1.0.1.exe` and `latest.yml`.
   (The tag must match the version: tag `v1.0.1` for version `1.0.1`.)

### Option B: build and publish from your PC
1. On GitHub: **Settings > Developer settings > Personal access tokens > Tokens (classic) > Generate new token**.
   Tick the **repo** scope and copy the token.
2. Set it for the terminal session:
   - Windows PowerShell: `$env:GH_TOKEN="ghp_yourtoken"`
   - macOS/Linux: `export GH_TOKEN=ghp_yourtoken`
3. Raise the version in `package.json`, then run:
   ```bash
   npm run release
   ```
   electron-builder builds the installer and uploads it to a **draft** release. Open the release on GitHub and click **Publish release**.

> Drafts are invisible to the updater. A release only counts once it is **published**.

---

## How users get it
1. Users install `Wares Launcher Setup x.y.z.exe` once.
2. On every start (and every 6 hours) the launcher checks GitHub.
3. When a newer version exists it downloads silently and shows **Restart to update** in the title bar.
4. Settings > Updates shows the status, release notes, a "Check now" button and a Stable/Beta channel switch.

Release notes shown in the launcher come from the body text of the GitHub release.

### Beta channel
Publish a release marked **Pre-release** (version like `1.1.0-beta.1`). Only users who pick **Beta** in
Settings > Updates will receive it.

---

## Checklist when something does not update
- The release is **published**, not a draft.
- The release has `latest.yml` next to the `.exe` (electron-builder adds it).
- The new version number is **higher** than the installed one.
- The repository is public and `owner`/`repo` in `package.json` are correct (Settings > Updates links to the releases page when they are).
- You tested with an installed build, not `npm start`.

## Notes
- Windows installers should be code-signed to avoid SmartScreen warnings. Updates still work unsigned.
- macOS auto-update requires an Apple Developer signature. Linux AppImage updates work without signing.
