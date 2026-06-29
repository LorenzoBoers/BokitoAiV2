# Firebase setup for Android push (FCM)

Background push on standalone Android APKs requires Firebase Cloud Messaging (FCM). Follow these steps once per environment.

## 1. Create a Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/).
2. Create a project (or reuse an existing one).
3. Add an **Android app** with package name: `ai.bokito.mobile`.

## 2. Download `google-services.json`

1. Download `google-services.json` from the Firebase Android app settings.
2. Place it at `apps/mobile/google-services.json` (git-ignored).
3. When using the committed `android/` native project (EAS bare workflow), also keep a copy at `apps/mobile/android/app/google-services.json` for Gradle. CI does this automatically from the `GOOGLE_SERVICES_JSON` secret.
4. For CI, store the file contents as a GitHub secret `GOOGLE_SERVICES_JSON`.

`app.config.ts` automatically includes `android.googleServicesFile` when this file exists.

## 3. Upload FCM credentials to EAS

Expo's push service needs an FCM v1 service account to deliver to your APK:

```bash
cd apps/mobile
npx eas login
npx eas credentials
```

Choose **Android** > **production** (or preview) > **Google Service Account** > upload the Firebase service-account JSON key.

Alternatively, in [expo.dev](https://expo.dev) open your project > Credentials > Android > FCM V1 service account key.

## 4. Register the Expo project (one-time)

```bash
cd apps/mobile
npx eas init
```

This writes `extra.eas.projectId` into your Expo project. Set the same value as `EAS_PROJECT_ID` in GitHub secrets if needed.

## 5. GitHub secrets for CI APK builds

| Secret | Purpose |
|--------|---------|
| `EXPO_TOKEN` | Expo access token from expo.dev account settings |
| `GOOGLE_SERVICES_JSON` | Full contents of `google-services.json` |

## Verify push

1. Install the APK on a physical Android device.
2. Log in and allow notifications when prompted.
3. Trigger an inbound message or decision on production.
4. Confirm a push arrives and tapping it opens the thread or Decisions tab.
