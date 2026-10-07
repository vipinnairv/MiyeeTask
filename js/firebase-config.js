// ── Hardcoded Firebase config ──────────────────────────────────────────────
const FB_CONFIG = {
  apiKey:            "AIzaSyBqYtixweqfrdeWx5Im6IhPDYin5a5ASCk",
  authDomain:        "miyeetask.firebaseapp.com",
  projectId:         "miyeetask",
  storageBucket:     "miyeetask.firebasestorage.app",
  messagingSenderId: "145539237762",
  appId:             "1:145539237762:web:85c434e104bf1ebe3f719b"
};

// ── Email whitelist ────────────────────────────────────────────────────────
// Add authorised email addresses below. Only these users can sign in.
// Leave the array EMPTY [] to allow ANY registered account (open access).
const FB_ALLOWED_EMAILS = [
  // "vipin@example.com",
  // "colleague@yourcompany.com",
];
// Load Firebase SDKs (always — config is baked in)
(function(){
  const sdks = [
    'https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js'
  ];
  sdks.forEach(src => {
    const s = document.createElement('script');
    s.src = src; s.async = false;
    document.head.appendChild(s);
  });
})();
