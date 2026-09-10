# STB PLAY Webapp / PWA

This is a separate browser migration of the working STB PLAY Windows v1.8.15
player. The Windows project is not modified.

## What is included

- Responsive STB PLAY home, Live TV, Movies & Series, Favourites, and Settings
  interface copied from the working v1.8.15 player.
- Browser portal requests through a Netlify Function adapter.
- Direct provider playback URLs. The Netlify Function does not proxy video
  bytes.
- Local browser storage for portal profiles, parental PIN hash, favourites,
  watch progress, and the IndexedDB VOD metadata index.
- PWA manifest/service worker for Safari Add to Home Screen and Android install.
- Strict search, provider-category adult locking, VOD/Series hierarchy, quality
  selection, subtitle hooks, expiry display, and anonymous analytics hooks.

## GitHub + Netlify deployment

1. Put this folder in a private GitHub repository.
2. Import the repository into Netlify.
3. Netlify will use `public` as the publish directory and `functions` for the
   provider API because those values are in `netlify.toml`.
4. Connect the custom domain to Netlify with DNS. Do not use a redirect-only
   forwarding rule for the PWA domain.
5. Open the deployed HTTPS URL on iPhone Safari and choose Share → Add to Home
   Screen.

## Firebase settings

Edit `public/web-config.js` with the Firebase web configuration after the
Firebase project is ready. Firebase is intended for customer identity,
entitlements, expiry/settings, and analytics. Do not put service-account keys in
this repository. Firestore rules must require authenticated access for private
customer documents. Set `customerLoginEnabled` to `true` only after the
optional customer profile document is ready; the default build keeps the
portal-entry flow available for testing.

When customer login is enabled, the PWA signs in with Firebase Email/Password,
reads `customers/{uid}`, validates the provider server/MAC and expiry, and only
then opens the player. The profile is expected to contain `portalUrl` (or
`server`) and `mac` (or `macAddress`).

This starter gate is a browser-side account flow. For a paid service that needs
anti-tamper entitlement enforcement, add Firebase ID-token verification and
customer-document checks inside the Netlify Function before accepting provider
headers; do not treat localStorage as a security boundary.

The current migration keeps portal profiles and playback progress on the local
device, matching the Windows behavior. It does not save stream URLs or send
portal URLs, MAC addresses, PINs, titles, or stream links in anonymous analytics.

## Playback limitation

The browser receives the provider's resolved direct URL. HLS/MP4 streams that
permit browser access can play in Safari, Chrome, and Edge. RTSP/NFS streams,
unsupported codecs, expired links, HTTP media opened from an HTTPS PWA, or
providers that reject browser media requests will show an unavailable/error
state. VLC fallback remains a Windows desktop feature and is deliberately not
called from the PWA.

The generated MAC-style ID is an authorized app identifier in the 02 series; it
is not the iPhone's physical hardware MAC address. Provider authorization is
still required.
