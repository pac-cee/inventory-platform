# Inventory — Mobile (Flutter)

Native Android + iOS app for the inventory system. Like the web app, it talks
only to the shared **inventory-api** (`../supabase/api`), never to Supabase
directly.

## Prerequisites

- [Flutter SDK](https://docs.flutter.dev/get-started/install) (3.24+)
- For iOS: Xcode + CocoaPods on macOS
- For Android: Android Studio + SDK (or just `sdkmanager`)
- The inventory-api running (see `../supabase/api`)

## First-time setup

Flutter expects the platform folders (`android/`, `ios/`, etc.) to live alongside
`pubspec.yaml`. They aren't checked in — generate them once with:

```bash
cd mobile

flutter create --project-name inventory_mobile \
               --org co.verlet \
               --platforms=android,ios \
               .

flutter pub get
```

Then copy `.env.example` to `.env` and set `API_URL` to where the API runs:

- Android emulator → `http://10.0.2.2:4000`
- iOS simulator / desktop / web → `http://localhost:4000`
- Physical device → `http://<your-computer-LAN-ip>:4000`

`.env` is gitignored, so it is absent on a fresh clone and in CI. Two separate
things follow, and they are easy to confuse:

- **At runtime** a missing `.env` is harmless. `main()` catches the load failure
  and `ApiClient` falls back to `--dart-define`, then to the emulator default.
  (It used to throw here, before the first frame, which looked exactly like the
  app crashing on launch.)
- **At build time** it is not optional. `pubspec.yaml` declares `.env` as an
  asset, and Flutter fails a build whose declared assets are missing. On a fresh
  clone or in CI, create it first — `cp .env.example .env`, or `touch .env` if
  the value comes from `--dart-define` anyway.

## Running

```bash
flutter run                 # picks any attached device
flutter run -d chrome       # web preview
flutter run -d <device-id>  # specific emulator/device
```

## Release builds

`API_URL` resolves in this order: `--dart-define` → bundled `.env` → the
emulator-to-host default. Only the first is present in a release artifact, so
**always pass it** — otherwise the shipped app points at `10.0.2.2`, which
resolves to nothing on a real device.

```bash
API=https://api-production-4a46.up.railway.app

flutter build apk    --release --dart-define=API_URL=$API   # sideload / direct install
flutter build appbundle --release --dart-define=API_URL=$API # Play Store
flutter build ipa    --release --dart-define=API_URL=$API   # App Store (macOS only)
```

### Android signing

`flutter build` falls back to **debug keys** when `android/key.properties` is
missing, so `flutter run --release` works out of the box. Play rejects a
debug-signed artifact — which is the intended failure, rather than silently
shipping one. For a real upload, create the keystore once:

```bash
keytool -genkey -v -keystore ~/verlet-upload.jks -keyalg RSA \
        -keysize 2048 -validity 10000 -alias upload
```

Then write `mobile/android/key.properties` (gitignored — **never commit it, and
keep a backup of the .jks; losing it means you can never update the listing**):

```properties
storePassword=<password>
keyPassword=<password>
keyAlias=upload
storeFile=/absolute/path/to/verlet-upload.jks
```

### iOS

iOS builds need macOS with Xcode; they cannot be produced on Linux or WSL. The
project config (bundle identifier `co.verlet.inventory`, camera usage string,
deployment target 15.5) is already correct, so on a Mac:

```bash
cd mobile && flutter pub get
cd ios && pod install && cd ..
flutter build ipa --release --dart-define=API_URL=$API
```

Signing team and provisioning profile are set in Xcode
(`ios/Runner.xcworkspace` → Runner → Signing & Capabilities).

## Features

Mirrors the web app:

- Email/password auth through the API (secure-storage session, auto-refresh),
  plus signup and forgot-password
- Bottom-nav shell with role-based tabs
- **Home** dashboard — stat cards, low-stock + storage-location sections, searchable inventory
- **Locations** — list + detail (items stored in each)
- **Item detail** — where it is, activity log (who took what, when), take/return
  stock, category, admin delete. Marking stock damaged or lost **requires a
  reason**, with an optional recommendation; a repair names the fault it clears
- **Items** (admin) — add (location required) + remove
- **Scan** — QR scanning to jump straight to an item
- **Reports** — Activity, and **Condition**: room → category → item with
  quantity, condition, % operational and recommendation, shareable as CSV
- **Payments** — corporate expense requests, cart, budget, MoMo disbursement
- **Users** (admin) — list, change roles, add/delete accounts, per-user report
- **Settings** — profile, light/dark/system theme, sign out

## Project layout

```
mobile/lib/
├── main.dart                 Entrypoint — theme + auth gate
├── models.dart               Item, Location, StockLevel, Movement, Profile
├── repository.dart           InventoryRepository + UsersRepository
├── widgets.dart              StatusChip, StatCard, SectionCard
├── config/
│   ├── api_client.dart       API client (auth, tokens, role)
│   ├── theme.dart            Light/dark themes (pink accent)
│   └── theme_controller.dart Persisted ThemeMode
└── features/
    ├── auth/                 login_screen, signup_screen
    ├── shell/                main_shell (bottom nav)
    ├── dashboard/            dashboard_screen
    ├── locations/            locations_screen, location_detail_screen
    ├── items/                items_admin_screen, item_detail_screen
    ├── users/                users_screen
    └── settings/             settings_screen
```
