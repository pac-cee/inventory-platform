# Reaching the dev API from the mobile app

The mobile app talks to the shared **inventory-api**. Set `mobile/.env`'s
`API_URL` to wherever that API is running for your environment.

The dev API points at the **dev Neon branch** (via Doppler `dev` config):

```bash
cd supabase/api
doppler run --config dev -- bash -c 'PORT=4000 npm run dev'   # http://localhost:4000
```

It listens on all interfaces (`0.0.0.0`), so it's reachable on the host's IP —
you just have to route to it per platform.

## Android emulator (same machine)
```
API_URL=http://10.0.2.2:4000     # 10.0.2.2 = the host's localhost from the emulator
```

## iOS simulator / desktop (same machine, macOS)
Run the API on that Mac (simplest) and use:
```
API_URL=http://localhost:4000
```

## Physical device or a Mac reaching a Windows/WSL host — option (c)

The API runs inside **WSL2** on the Windows box. WSL2 has its own IP
(e.g. `172.17.147.7`), which other machines can't reach directly — Windows must
forward its LAN port into WSL. Do this **once on Windows** (PowerShell as admin):

```powershell
# 1. Forward Windows :4000 -> WSL :4000. Replace the WSL IP with `wsl hostname -I`.
netsh interface portproxy add v4tov4 listenport=4000 listenaddress=0.0.0.0 `
  connectport=4000 connectaddress=172.17.147.7

# 2. Allow it through the firewall.
netsh advfirewall firewall add rule name="inventory-api 4000" dir=in action=allow `
  protocol=TCP localport=4000
```

Then on the Mac / device, point at the **Windows machine's LAN IP** (`ipconfig`):
```
API_URL=http://<windows-lan-ip>:4000
```

> The WSL IP changes on reboot — re-run step 1 with the new `wsl hostname -I`
> value, or script it. Remove the proxy later with:
> `netsh interface portproxy delete v4tov4 listenport=4000 listenaddress=0.0.0.0`

### Alternative: a tunnel
If you'd rather not touch Windows networking, run a tunnel from WSL and use the
public URL it prints (no LAN/firewall setup, works from anywhere):
```bash
cloudflared tunnel --url http://localhost:4000     # or: ngrok http 4000
API_URL=https://<generated-host>.trycloudflare.com
```

## After changing `API_URL`
Rebuild/relaunch the app: `cd mobile && flutter run` (or pass it at launch:
`flutter run --dart-define=API_URL=http://<host>:4000`).
