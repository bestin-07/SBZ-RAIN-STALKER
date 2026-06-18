# Support / Donate

The **About → Support** section shows a "Buy me a coffee" button that opens a
donation link. There is **no QR code** anymore — it's a single configurable URL.

## Set your donation link (pick ONE)

1. **PayPal.me (recommended, easiest):** create your link at https://paypal.me
   → you get `https://paypal.me/yourhandle`.
2. **Stripe Payment Link:** Stripe Dashboard → Payment Links → create one (no code).
3. **Ko-fi:** https://ko-fi.com/yourhandle (0% platform fee, bundles PayPal+Stripe).

## Where to put it

Either:
- **Env var (no code change):** set `VITE_DONATE_URL=https://paypal.me/yourhandle`
  in Railway, redeploy. This is read at build time by Vite.
- **Or hardcode:** edit `DONATE_URL` near the top of
  `frontend/src/components/InfoPanel.jsx`.

If no URL is set, the button is hidden and a "coming soon" line shows instead —
so it's safe to ship before you've picked a provider.
