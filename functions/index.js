const crypto = require("node:crypto");
const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();
const db = admin.firestore();
const REGION = "asia-south1";
const stores = () => db.collection("stores");
const cleanText = (value, max = 80) => String(value || "").trim().slice(0, max);
const requireAuth = (request) => {
  if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Sign in before continuing.");
  return request.auth.uid;
};
const issueSessionToken = (uid, storeId, deviceId) => admin.auth().createCustomToken(uid, { rssStoreId: storeId, rssDeviceId: deviceId });
const requireOwner = async (storeId, uid, token) => {
  const deviceId = cleanText(token && token.rssDeviceId, 100);
  if (!token || token.rssStoreId !== storeId || !deviceId) throw new HttpsError('permission-denied', 'This device has no active owner session.');
  const ref = stores().doc(storeId), deviceRef = ref.collection('devices').doc(deviceId);
  const results = await Promise.all([ref.get(), deviceRef.get()]);
  const snap = results[0], deviceSnap = results[1];
  if (!snap.exists || snap.data().ownerUid !== uid || !deviceSnap.exists || deviceSnap.data().authUid !== uid || deviceSnap.data().status !== 'active' || deviceSnap.data().role !== 'owner') throw new HttpsError('permission-denied', 'Only an approved owner device can perform this action.');
  return { ref, data: snap.data(), deviceId };
};
const validStoreId = (value) => {
  const id = cleanText(value, 100);
  if (!/^[a-f0-9]{32,64}$/i.test(id)) throw new HttpsError("invalid-argument", "The store database ID is invalid.");
  return id;
};
const hashCode = (code) => crypto.createHash("sha256").update(code).digest("hex");

exports.claimExistingStore = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const email = cleanText(request.auth.token.email, 254).toLowerCase();
  if (!email || request.auth.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify the owner email address before claiming this existing store.");
  }
  const storeId = validStoreId(request.data?.storeId);
  const deviceId = cleanText(request.data?.deviceId, 100);
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(deviceId)) {
    throw new HttpsError("invalid-argument", "The installation ID is invalid.");
  }
  const storeName = cleanText(request.data?.storeName, 100) || "Ronyal Super Store";
  const storeRef = stores().doc(storeId);
  const employeeId = "owner-" + uid;
  const deviceRef = storeRef.collection("devices").doc(uid);
  const employeeRef = storeRef.collection("employees").doc(employeeId);
  await db.runTransaction(async (tx) => {
    const [storeSnap, deviceSnap] = await Promise.all([tx.get(storeRef), tx.get(deviceRef)]);
    if (storeSnap.exists && storeSnap.data().ownerUid && storeSnap.data().ownerUid !== uid) {
      throw new HttpsError("already-exists", "This database has already been claimed by a different owner account. Contact support; do not reset or replace the database.");
    }
    if (deviceSnap.exists && deviceSnap.data().authUid !== uid) {
      throw new HttpsError("already-exists", "This installation is already registered to another account.");
    }
    tx.set(storeRef, {
      ownerUid: uid,
      ownerEmail: email,
      storeName,
      status: "active",
      schemaVersion: 1,
      claimedAt: storeSnap.exists ? (storeSnap.data().claimedAt || admin.firestore.FieldValue.serverTimestamp()) : admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(employeeRef, {
      employeeId,
      name: "Store Owner",
      role: "owner",
      permissions: { dashboard: true, newSale: true, products: true, purchases: true, sales: true, returns: true, udhaar: true, reports: true, expenses: true, backup: true, deviceManagement: true, employeeManagement: true, storeSettings: true },
      status: "active",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(deviceRef, {
      deviceId: uid,
      installationId: deviceId,
      authUid: uid,
      employeeId,
      deviceName: cleanText(request.data?.deviceName, 80) || "Owner device",
      status: "active",
      registeredAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeen: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
  return { ok: true, storeId, employeeId, role: "owner" };
});

exports.createDeviceInvite = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const storeId = validStoreId(request.data?.storeId);
  await requireOwner(storeId, uid);
  const raw = crypto.randomBytes(24).toString("base64url");
  const inviteId = hashCode(raw);
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 15 * 60 * 1000);
  await stores().doc(storeId).collection("deviceInvites").doc(inviteId).create({
    createdBy: uid, createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt, used: false
  });
  return { code: storeId + "." + raw, expiresAt: expiresAt.toDate().toISOString() };
});

exports.registerDevice = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const code = cleanText(request.data?.code, 300);
  const split = code.split(".");
  if (split.length !== 2) throw new HttpsError("invalid-argument", "Enter a valid one-time device activation code.");
  const storeId = validStoreId(split[0]);
  const raw = split[1];
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(raw)) throw new HttpsError("invalid-argument", "The activation code is invalid.");
  const inviteRef = stores().doc(storeId).collection("deviceInvites").doc(hashCode(raw));
  const deviceRef = stores().doc(storeId).collection("devices").doc(uid);
  const installationId = cleanText(request.data?.deviceId, 100);
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(installationId)) throw new HttpsError("invalid-argument", "The installation ID is invalid.");
  await db.runTransaction(async (tx) => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists || inviteSnap.data().used || inviteSnap.data().expiresAt.toMillis() < Date.now()) {
      throw new HttpsError("failed-precondition", "This activation code has expired or has already been used. Ask the owner for a new code.");
    }
    const existing = await tx.get(deviceRef);
    if (existing.exists && existing.data().authUid !== uid) throw new HttpsError("already-exists", "This device record belongs to another sign-in.");
    tx.update(inviteRef, { used: true, usedAt: admin.firestore.FieldValue.serverTimestamp(), usedBy: uid });
    tx.set(deviceRef, {
      deviceId: uid, installationId, authUid: uid,
      deviceName: cleanText(request.data?.deviceName, 80) || "New POS device",
      status: "pending", employeeId: null,
      registeredAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeen: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
  return { ok: true, storeId, status: "pending" };
});

exports.approveDevice = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const storeId = validStoreId(request.data?.storeId);
  const deviceUid = cleanText(request.data?.deviceUid, 128);
  const employeeId = cleanText(request.data?.employeeId, 128);
  if (!deviceUid || !employeeId) throw new HttpsError("invalid-argument", "Choose a pending device and an employee.");
  await requireOwner(storeId, uid);
  const storeRef = stores().doc(storeId);
  const deviceRef = storeRef.collection("devices").doc(deviceUid);
  const employeeRef = storeRef.collection("employees").doc(employeeId);
  await db.runTransaction(async (tx) => {
    const [deviceSnap, employeeSnap] = await Promise.all([tx.get(deviceRef), tx.get(employeeRef)]);
    if (!deviceSnap.exists || deviceSnap.data().status !== "pending") throw new HttpsError("failed-precondition", "This device is no longer pending approval.");
    if (!employeeSnap.exists || employeeSnap.data().status !== "active" || employeeSnap.data().role === "owner") throw new HttpsError("failed-precondition", "Choose an active non-owner employee.");
    tx.update(deviceRef, { employeeId, status: "active", approvedBy: uid, approvedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

exports.revokeDevice = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const storeId = validStoreId(request.data?.storeId);
  const deviceUid = cleanText(request.data?.deviceUid, 128);
  if (!deviceUid || deviceUid === uid) throw new HttpsError("invalid-argument", "Choose another device. The current owner device cannot revoke itself.");
  await requireOwner(storeId, uid);
  const ref = stores().doc(storeId).collection("devices").doc(deviceUid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Device not found.");
  await ref.update({ status: "revoked", revokedAt: admin.firestore.FieldValue.serverTimestamp(), revokedBy: uid });
  try { await admin.auth().revokeRefreshTokens(deviceUid); } catch (_) { /* Rules deny the device immediately even if token revocation is unavailable. */ }
  return { ok: true };
});
