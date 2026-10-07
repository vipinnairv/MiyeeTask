# Miyee Task Manager Pro

A goal-based task manager: define **Goals**, break them into **Projects**, and track **Tasks** with time budgets, a Kanban board, a calendar, and Google Calendar / Excel / `.ics` export. Personal use or team workspaces with invite codes, admins and task assignment. Data lives in Firebase (Auth + Firestore) and syncs live across devices.

## Project layout

| Path | What it is |
| --- | --- |
| `index.html` | Page markup (login gate, wizard, pages, modals) |
| `css/app.css` | All styles |
| `js/firebase-config.js` | Firebase project config and the Firebase SDK loader |
| `js/app.js` | Application logic: data model, rendering, sync, workspaces |
| `sw.js`, `manifest.json` | Offline support / installable PWA |
| `firestore.rules`, `firebase.json` | Firestore security rules |
| `tests/` | Browser end-to-end tests and security-rules tests |

There is no build step. Any static host works (GitHub Pages, Firebase Hosting, …); serve the repository root.

## How sync works

* Every change is saved to the browser immediately and uploaded to Firestore within about a second. Only the records that changed are written.
* Changes made on other devices or by teammates appear live.
* Edits that could not be uploaded (offline, refresh mid-save) are remembered and uploaded the next time the app runs. They are never overwritten by the older cloud copy.
* If the same record was changed on two devices before either synced, the newer local edit is kept and the user is told.

## Security rules (important)

Login screens and admin-only buttons run in the browser and can be bypassed. **`firestore.rules` is what actually protects the data.** Personal data is visible only to its owner, workspace data only to members, only admins manage positions, invites and members, and joining a workspace needs a valid, unused invite code.

Deploy them once (and again after any change):

```bash
npm install
npx firebase login
npx firebase deploy --only firestore:rules --project miyeetask
```

To restrict sign-in to specific people, add a condition such as `request.auth.token.email in ['you@example.com']` to the rules. The `FB_ALLOWED_EMAILS` list in `js/firebase-config.js` only hides the UI.

## Tests

```bash
npm install
npm run test:e2e     # the real app in headless Chromium against a fake Firebase
npm run test:rules   # security rules in the Firestore emulator (needs Java 21)
```

Both run on every pull request (`.github/workflows/test.yml`).

---
Built by Vipin Nair · audit.vipin@gmail.com
