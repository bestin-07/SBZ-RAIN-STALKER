# Support / Buy-me-a-coffee QR

Drop your payment QR code image in this folder so it shows up in the app's
**About → Support** section.

- **Required filename:** `coffee-qr.png`  (exact name, lowercase)
- **Recommended:** a square PNG, at least 400×400 px, on a white/light background
  so it scans well in both light and dark app themes.

Path the app loads: `/support/coffee-qr.png`

Until you add the file, the Support section shows a "QR code coming soon"
placeholder instead of a broken image — so it's safe to ship before the QR exists.

Anything else placed in `frontend/public/` is copied verbatim into the build,
so no code changes are needed after you add the image — just commit and push.
