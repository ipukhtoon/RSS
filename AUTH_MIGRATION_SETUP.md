# RSS secure account and device authorization setup

This backend is designed to preserve the existing database path:
`/stores/{existingStoreId}/ronyal_pos`.

## Important migration behavior

- Do not delete, rename, or recreate the existing `ronyal_pos` document or any of its data collections.
- On the original owner installation, link the current Firebase anonymous user to the owner's email/password account using Firebase Authentication `linkWithCredential`. Linking preserves that Firebase UID.
- Verify the owner email, refresh the ID token, then call `claimExistingStore` with the already-saved Store Sync ID and installation ID.
- The function writes owner/device metadata at `/stores/{storeId}`, outside the existing POS data path.
- New devices use a one-time owner invitation, register as pending, and receive no data access until approved.
- Never copy the owner's email/password into a cashier APK or share the owner password with employees.

## Firebase project deployment

The repository workflow `.github/workflows/deploy-firebase.yml` deploys Cloud Functions and Firestore rules. Before running it, add these repository Actions secrets:

1. `FIREBASE_PROJECT_ID`: the existing Firebase project's project ID.
2. `FIREBASE_SERVICE_ACCOUNT`: the JSON contents of a service account with permission to deploy Cloud Functions and Firestore rules.

Then run **Actions → Deploy RSS Firebase backend → Run workflow**. Deployment is not complete until that workflow succeeds.

## Current implementation boundary

The frontend still uses the legacy anonymous-auth and local PIN flow. Do not remove that flow or enable the new rules until the client-side migration UI is implemented, tested against the existing project, and the original owner device has successfully claimed the store. The rules intentionally deny unregistered users; deploying them prematurely would interrupt existing device synchronization.
