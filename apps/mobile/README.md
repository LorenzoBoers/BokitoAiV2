# Bokito Mobile

Native Expo app on the Bokito gateway protocol: assistant chat, unified inbox (Signals), inline decision approve/reject, and push notifications.

## Development

1. Start the FastAPI backend (`apps/api`) so `http://<your-machine>:8000` is reachable.
2. Set the API URL via environment when starting Expo:

```bash
BOKITO_API_URL=http://192.168.1.10:8000 npm run start -w bokito-mobile
```

Use your machine's LAN IP for physical devices (not `127.0.0.1`).

3. From the repo root:

```bash
npm install
npm run start -w bokito-mobile
```

Open in Expo Go or a dev build on iOS/Android.

### Android emulator hot reload (Windows, recommended)

No phone, QR code, or tunnel required. Uses the local AVD `Medium_Phone_API_36.1`, a **dev-client debug APK**, and Metro over `adb reverse`.

```powershell
cd apps/mobile
.\scripts\dev-emulator.ps1
```

This boots the emulator (if needed), installs the debug dev-client APK, starts Metro with `--dev-client --lan` (bound to all interfaces for `adb reverse`), and opens the dev client at `http://127.0.0.1:8081`.

- **API:** production `https://app.bokito.ai` (default)
- **Login:** `trader@bokito.ai` with your production password
- **Hot reload:** edit files under `app/` or `src/`; Metro Fast Refresh applies automatically

The **production preview APK** (`dist/bokito-mobile.apk`) does not hot reload — it looks for Expo OTA updates, not Metro. Use the dev client from this script instead.

For a **local mock API** instead of production:

```powershell
.\scripts\dev-android.ps1 -ApiUrl "http://127.0.0.1:8000" -StartMetro
```

Login with `admin@bokito.ai` / `bokito-test-password`.

If stuck on `unauthorized` when the emulator boots, cold-boot once:

```powershell
adb emu kill
emulator -avd Medium_Phone_API_36.1 -port 5556 -wipe-data -skip-adb-auth -no-snapshot-load
```

After first successful setup, save an AVD snapshot for faster boots:

```text
auth <token from %USERPROFILE%\.emulator_console_auth_token>
avd snapshot save bokito-dev
```

Gradle wrapper must stay on **8.13** (9.0 fails on Windows with `JvmVendorSpec IBM_SEMERU`). Re-pin after `expo prebuild`.

Rebuild the debug APK after native dependency changes:

```powershell
.\scripts\dev-android.ps1 -ForceRebuild -ApiUrl "https://app.bokito.ai"
```

## Production APK

The app targets production at `https://app.bokito.ai` when built with the EAS `preview` profile.

### One-time setup

1. Create an [Expo](https://expo.dev) account.
2. Register the project: `cd apps/mobile && npx eas login && npx eas init`
3. Configure Firebase for Android push — see [FIREBASE_SETUP.md](./FIREBASE_SETUP.md).
4. Add GitHub secrets:
   - `EXPO_TOKEN` — Expo access token
   - `GOOGLE_SERVICES_JSON` — contents of `google-services.json`

### Build via GitHub Actions

1. Open **Actions** > **Mobile APK** > **Run workflow**.
2. When the job completes, download the `bokito-android-apk` artifact.
3. Transfer the APK to your Android phone, enable install from unknown sources, and install.
4. Log in with your Bokito account and allow notifications.

CI uses EAS **managed** builds (`.easignore` excludes the committed `android/` tree used for local Windows dev). Do not upload `android/` to EAS; cloud prebuild generates native code with `google-services.json` from secrets.

### Build locally (optional)

```bash
cd apps/mobile
BOKITO_API_URL=https://app.bokito.ai eas build -p android --profile preview
```

Download the APK from the Expo build page when complete.

## Architecture

- `src/lib/api.ts` — REST client (auth, signals, chat, decisions, push)
- `src/lib/gateway.ts` — gateway WebSocket client (`/api/ws`), same typed protocol as the dashboard; auto-reconnect and re-subscribe
- `src/lib/push.ts` — Expo push registration; tokens stored via `POST /api/push/subscribe` with an `expo:` endpoint prefix
- `src/lib/notification-routing.ts` — deep-link from push taps to thread or Decisions tab
- `src/context/AuthContext.tsx` — token persistence in SecureStore, session bootstrap
- `app/` — expo-router routes: login, tabs (Assistant, Messages, Decisions, Settings), thread detail

Live updates arrive on gateway topics `threads`, `signal:<id>`, and `decisions`.

Push notifications are sent by the backend when:
- A new **inbound** message arrives on a thread (assignee/owner, or tenant owners/admins)
- A **decision** is created with status `awaiting_human`

Tapping a notification opens the thread (`signal_id`) or the Decisions tab (`decision_id`).

## Configuration

| Variable | Where | Purpose |
|----------|-------|---------|
| `BOKITO_API_URL` | EAS build env / local shell | Backend base URL (default dev: `http://127.0.0.1:8000`) |
| `EAS_PROJECT_ID` | EAS / `app.config.ts` extra | Expo project ID for push tokens in standalone builds |
| `EXPO_TOKEN` | GitHub secret | CI authentication for EAS Build |
| `GOOGLE_SERVICES_JSON` | GitHub secret | Firebase config for Android FCM |
