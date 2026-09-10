/*
  Browser deployment settings for STB PLAY.

  The provider API function is intentionally separate from the static site.
  The default path works with the included Netlify Function. Firebase web
  configuration is public client configuration, but customer data is still
  protected by Firebase Authentication and Firestore rules.
*/
window.STB_PLAY_CONFIG = Object.freeze({
  apiBase: "/.netlify/functions/provider-api",
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: "",
  },
  customer: {
    profilePath: "customers/{uid}",
  },
  customerLoginEnabled: false,
});
