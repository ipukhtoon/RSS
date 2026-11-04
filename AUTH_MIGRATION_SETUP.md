# RSS secure account and device authorization setup

This backend is designed to preserve the existing database path:
`/stores/{existingStoreId}/ronyal_pos`.

## Important migration behavior

- Do not delete, rename, or recreate the existing `ronyal_pos` document or any of its data collections.
- On the original owner installation, link the current Firebase anonymous user to the owner's email/password account using Firebase Authentication `linkWithCredential`. Linking preserves that Firebase UID.
- Verify the owner email, refresh the ID token, then call `claimExistingStore` with the already-saved Store Sync ID and installation ID.
- The function writes owner/device metadata at `/stores/{storeId}`, outside the existing POS data path.
- The function returns a short-lived Firebase custom-auth sign-in token carrying the store ID and installation ID as claims. Firestore rules require these claims and an active device record, so an owner password alone does not reuse an old device session.
- New employee devices use a one-time owner invitation, register as pending, and receive no data access until approved. Once approved, the device polls its status and exchanges it for its own device-bound Firebase session.
- Owner replacement-device recovery requires the original verified owner email/password and a recent sign-in. The function locates the store by the authenticated owner UID, registers the new installation, and issues a device-bound session. The owner can then revoke the lost installation.
- Never copy the owner's email/password into a cashier APK or share the owner password with employees.

## Firebase project preparation

- Keep the existing Firebase project and Firestore database in Mumbai (`asia-south1`).
- Enable Email/Password Authentication in addition to the existing Anonymous provider. The original installation links its anonymous user to the owner email/password account where possible.
- The client needs the existing Firebase Web app values (`apiKey`, `authDomain`, `projectId`, `appId`) embedded in `index.html`; these are Firebase web configuration values, not service-account credentials.
- Cloud Functions deployment requires the Firebase project to be on the Blaze billing plan and the Cloud Functions / Cloud Build APIs to be enabled. The Functions are configured for `asia-south1`.

## Firebase project deployment

The backend is deliberately deployed in two stages so existing devices are not locked out prematurely.

1. Run `.github/workflows/deploy-firebase.yml` first. It deploys **Cloud Functions only** and leaves the current Firestore rules unchanged. This enables owner claim, device invitations, approvals and recovery while old devices can still sync.
2. On the original owner device, link/verify the owner account and claim the existing store. Create one-time invitations for every other existing POS installation. Each device must register, be approved, sign in with its device-bound session, and complete a successful sync.
3. Only after every existing device is confirmed active, run `.github/workflows/deploy-firestore-rules.yml` and confirm that all devices are authorized. This deploys the restrictive rules. Any unregistered device will lose cloud access.

Both workflows require these repository Actions secrets:

1. `FIREBASE_PROJECT_ID`: the existing Firebase project's project ID.
2. `FIREBASE_SERVICE_ACCOUNT`: the JSON contents of a service account with permission to deploy Cloud Functions and Firestore rules. Keep this private; never put it in `index.html` or commit it to the repository.

Run **Actions → Deploy RSS Firebase Functions (Stage 1) → Run workflow** first. Do not run the Firestore rules workflow until the device migration checklist above is complete. Deployment is not complete until the corresponding workflow succeeds.

## Current implementation boundary

The frontend still uses the legacy anonymous-auth and local PIN flow. Do not remove that flow or enable the new rules until the client-side migration UI is implemented, tested against the existing project, and the original owner device has successfully claimed the store. The rules intentionally deny unregistered users; deploying them prematurely would interrupt existing device synchronization. The account migration must link the existing anonymous user to email/password before claiming so its Firebase UID and access to the existing data path remain unchanged.
