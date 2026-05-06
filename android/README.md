# Claude Portfolio — Android app

Companion to the Claude Portfolio pipeline. See the
[root README](../README.md) for the system-wide setup.

A side-loaded, dark-only Kotlin/Compose app that displays:

- **Portfolio** — equity hero number, day/week stats, all positions with thesis + P/L%
- **Last run** — Claude's summary, recommendations (tap to expand), executor stats
- **Memo** — Claude's working memory: open theses, closed theses, watchlist, notes
- **History** — list of weekly runs; tap one to see its detail
- **Settings** — connection (base URL + bearer token), bot controls (active / live / force-run), briefing JSON inspector, recent activity

Push notifications fire after every pipeline run via FCM. Tap one to land
on the relevant tab with fresh data.

---

## First-time build

```
Open Android Studio (any 2024.x stable) → File → Open → pick the android/ folder.
```

The Gradle wrapper jar is **not** committed (kept out so the repo is
platform-agnostic). On first sync, Studio detects the missing jar and
regenerates it from its bundled Gradle. Then it downloads Gradle 8.10.2
and pulls dependencies (Compose BOM, Retrofit, kotlinx-serialization,
DataStore, Firebase Messaging).

**If sync fails** with "Wrapper jar not found", run from this directory:
```bash
gradle wrapper --gradle-version 8.10.2
```
(Studio's bundled Gradle is on PATH after the first sync attempt.)

---

## Firebase setup (one-time)

The app needs `google-services.json` to compile against Firebase. Without
it, the conditional `apply(plugin = "com.google.gms.google-services")` in
[`app/build.gradle.kts`](app/build.gradle.kts) is skipped and the app
builds, but FCM push never initializes.

`android/app/google-services.json` is **gitignored** so each developer
provides their own. To enable push:

1. Open https://console.firebase.google.com → your project (or create one)
2. **Add app → Android** with package name `com.claudeportfolio.app`
3. **Download `google-services.json`** → save it as
   `android/app/google-services.json`
4. **Lock the API key down** (defense-in-depth — recommended on a public
   repo since the key technically lives inside the APK):
   - https://console.cloud.google.com/apis/credentials → click your Android key
   - **Application restrictions → Android apps**
   - Package name `com.claudeportfolio.app`
   - SHA-1 fingerprint: get yours with PowerShell
     ```powershell
     & "C:\Program Files\Java\jdk-22\bin\keytool.exe" -list -v `
       -alias androiddebugkey `
       -keystore "$env:USERPROFILE\.android\debug.keystore" `
       -storepass android -keypass android
     ```
     (paste the `SHA1:` line into the field)
5. Re-sync the project in Android Studio

The Firebase **service-account key** (a separate JSON you generate in
Project Settings → Service Accounts) is the actual sensitive credential
and lives only in AWS Secrets Manager — never in the repo. The root
`.gitignore` blocks `*-firebase-adminsdk-*.json` defensively in case
one ever lands in the working tree.

---

## Connecting to your API

On first launch the app uses **mock data** seeded from the design
handoff. You'll see a red "Mock data" pill in the top-right.

To connect to your live API:

1. Get the API base URL — see the root README's "Setup → 3. HTTP API"
   section, or run from the repo root:
   ```bash
   aws lambda get-function-url-config --function-name claude-portfolio-api \
     --query FunctionUrl --output text
   ```
2. Get the bearer token:
   ```bash
   aws secretsmanager get-secret-value \
     --secret-id claude-portfolio/api-bearer-token \
     --query SecretString --output text
   ```
3. In the app, open **Settings → Connection**, paste both, tap **Connect**.

The pill flips to green "Live · paper acct". Every screen now shows real
data.

---

## Project layout

```
android/
├── settings.gradle.kts
├── build.gradle.kts                 # root — Kotlin, Compose, Serialization, Google Services plugins
├── gradle.properties
├── gradle/wrapper/gradle-wrapper.properties
└── app/
    ├── build.gradle.kts             # app module — full dep stack
    ├── proguard-rules.pro
    ├── google-services.json         # Firebase Android config (committed; not secret)
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/com/claudeportfolio/app/
        │   ├── MainActivity.kt              # FCM token registration + deep-link routing
        │   ├── PortfolioApp.kt              # Application — registers notification channel
        │   ├── data/
        │   │   ├── api/                     # PortfolioApi (interface) + MockApi + RetrofitApi
        │   │   ├── config/ConfigStore.kt    # DataStore: base URL + bearer token
        │   │   └── model/Models.kt          # @Serializable wire types
        │   ├── push/
        │   │   ├── PushService.kt           # FirebaseMessagingService
        │   │   ├── NotificationChannels.kt  # idempotent channel setup
        │   │   └── PushConstants.kt
        │   └── ui/
        │       ├── RootScreen.kt            # NavController + tab routing
        │       ├── LocalApi.kt              # API + IsLive + RefreshTick CompositionLocals
        │       ├── UiState.kt               # Loading/Ready/Error + rememberLoadable
        │       ├── theme/                   # Color, Type, Theme
        │       ├── components/              # AppBar, BottomNav, NavIcons, Skeleton
        │       ├── format/Format.kt         # USD / pct / date formatters
        │       └── screens/                 # Portfolio, LastRun, RunDetail, Memo,
        │                                    # History, Settings
        └── res/                              # icons, strings, themes, font_certs
```

---

## Stack notes

- **Compose BOM 2024.10.00**, Material 3 1.3, Kotlin 2.0.21, AGP 8.7.3
- **Retrofit 2.11** + the official `converter-kotlinx-serialization`
- **DataStore Preferences** for persisted config (no Room — refetch on
  tab change is fine for a weekly app)
- **Firebase BOM 33.6.0** + `firebase-messaging-ktx`
- **No Hilt** — `staticCompositionLocalOf` does the job at this size
- **No WorkManager** — FCM is the actual nudge for fresh data
- **Min SDK 26**, target 35

If you want to extend this app, the most likely friction points are:

- Adding a new endpoint → update `PortfolioApi`, `MockApi`,
  `PortfolioService`, `RetrofitApi` in lockstep.
- Adding a new screen → drop a file in `ui/screens/`, register the route
  in `RootScreen.kt`, add a tab to `Tab` enum if it's a top-level
  destination.
- Changing wire types → update `data/model/Models.kt` and the API code
  on the same commit. The kotlinx-serialization converter tolerates
  missing fields (default values) but not type mismatches.
