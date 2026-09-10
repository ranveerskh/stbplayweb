# Firebase integration notes

The webapp can use Firebase for account/customer identity and anonymous health
analytics while Netlify serves the frontend. Keep customer documents private
with authenticated Firestore rules. Do not store provider stream URLs or
provider credentials in Firestore.

The provider API itself is the included Netlify Function. It handles only
authorized portal metadata/link-resolution requests and returns direct media
URLs; it is not a video relay.

## Optional customer sign-in

Set `customerLoginEnabled: true` in `public/web-config.js`, fill in the public
Firebase web config, enable Firebase Email/Password sign-in, and create a
private Firestore document at `customers/{uid}` (or change `customer.profilePath`).
The document should contain `portalUrl` (or `server`), `mac` (or `macAddress`),
and may contain `nickname`, `plan`, `status`, and `expiryDate`. The PWA signs in
first, reads that authenticated document, then stores the active portal profile
locally for provider requests. Keep Firestore rules restrictive and never put
service-account credentials in the frontend.

`firestore.rules` contains a deny-by-default starter rule for the customer
profile path. Review it with any additional collections before deploying.
