# Bokito Mobile

Native Expo app on the Bokito gateway protocol: assistant chat, unified inbox (Signals), inline decision approve/reject, and push notifications.

## Run

1. Start the FastAPI backend (`apps/api`) so `http://<your-machine>:8000` is reachable.
2. Set the API URL for your environment in `app.json` under `expo.extra.apiUrl`. For a physical device use your machine's LAN IP, e.g. `http://192.168.1.10:8000`.
3. From the repo root:

```bash
npm install
npm run start -w bokito-mobile
```

Then open the project in Expo Go (or a dev build) on iOS/Android.

## Architecture

- `src/lib/api.ts` — REST client (auth, signals, chat, decisions, push)
- `src/lib/gateway.ts` — gateway WebSocket client (`/api/ws`), same typed protocol as the dashboard; auto-reconnect and re-subscribe
- `src/lib/push.ts` — Expo push registration; tokens are stored via `POST /api/push/subscribe` with an `expo:` endpoint prefix
- `src/context/AuthContext.tsx` — token persistence in SecureStore, session bootstrap
- `app/` — expo-router routes: login, tabs (Assistant, Messages, Decisions, Settings), thread detail

Live updates arrive on gateway topics `threads`, `signal:<id>`, and `decisions`.
