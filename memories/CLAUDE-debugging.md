# Debugging Order

- Playback failure: Jellyfin log (`~/Library/Application Support/jellyfin/log/`, grep the item id, newest `FFmpeg.*-<id>` log) and the item Path first, then app code.
- Continue Watching "missing": grep the app log for `CW row fetch` and `Auth credentials saved` to confirm the account.
- Whole playback suite failing: the app is signed into another server. `xcrun simctl spawn <udid> log show --last 45m --predicate 'process == "TomoTV"' | grep -o -E "url: https?://[^/]+" | sort | uniq -c`. Never pipe the run through `tail`.
- tvOS simulator has no HEVC decoder: an `encode hevc` plan failing at 0.0s on the sim is judged on a device.
- Device cannot reach Metro: check the macOS firewall for the current node binary (`scripts/check-firewall.sh`), then VPN on the phone.
- AVPlayer -1001 on every LAN URL on the Apple TV while the engine plays: reboot the TV.
- Top Shelf showing stale/static content after reinstall: fresh install and reboot before suspecting code.
- Build failure: read the `.xcactivitylog` in DerivedData, not only the pasted errors.
- `log` is aliased to `git log` in this shell: use `/usr/bin/log show`.
- Link speed ground truth is the server NIC's tx_bytes or Cloudflare `__down`, never the Mac.
- Console.app is `-0500`, the JS logger is `Z`.
- Device logs: `xcrun devicectl device process launch --console --payload-url "tomotv://player?videoId=<id>&probe=1" dev.keiver.tomotv` (only when asked).
- Sign a sim into any server: `tomotv://dev-session?...` (dev builds), then route links like `tomotv:///settings`. macOS 27 has no Simulator.app: drive the tvOS sim with `simctl openurl`, the Metro inspector and lldb `UIFocusDebugger`.
- JS thread profiling: Metro inspector at `http://localhost:8081/json` with `Origin: http://127.0.0.1:8081`, `Tracing` domain.
