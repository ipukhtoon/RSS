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
const requireOwner = async (storeId, uid, token, request) => {
  const deviceId = cleanText(token && token.rssDeviceId, 100);
  if (!token || token.rssStoreId !== storeId || !deviceId) throw new HttpsError('permission-denied', 'This device has no active owner session.');
  await verifyDeviceProof(request, storeId, deviceId, "owner", false);
  const ref = stores().doc(storeId), deviceRef = ref.collection('devices').doc(deviceId);
  const results = await Promise.all([ref.get(), deviceRef.get()]);
  const snap = results[0], deviceSnap = results[1];
  const employeeId = deviceSnap.exists ? deviceSnap.data().employeeId : null;
  const employeeSnap = employeeId ? await ref.collection('employees').doc(employeeId).get() : null;
  if (!snap.exists || snap.data().ownerUid !== uid || !deviceSnap.exists || deviceSnap.data().authUid !== uid || deviceSnap.data().status !== 'active' || deviceSnap.data().role !== 'owner' || !employeeSnap || !employeeSnap.exists || employeeSnap.data().status !== 'active' || employeeSnap.data().role !== 'owner') throw new HttpsError('permission-denied', 'Only an approved owner device can perform this action.');
  return { ref, data: snap.data(), deviceId };
};
const validStoreId = (value) => {
  const id = cleanText(value, 100);
  if (!/^[a-f0-9]{32,64}$/i.test(id)) throw new HttpsError("invalid-argument", "The store database ID is invalid.");
  return id;
};
const hashCode = (code) => crypto.createHash("sha256").update(code).digest("hex");

const b64url = (value) => Buffer.from(value).toString("base64url");
const fromB64url = (value) => Buffer.from(String(value || ""), "base64url");
const deviceChallengeRef = (storeId, challengeId) => stores().doc(storeId).collection("deviceChallenges").doc(challengeId);

/**
 * Issues a short-lived, single-use proof-of-possession challenge.
 * Enrollment purposes may supply a new public key; existing devices must use
 * the public key already registered to their device record.
 */
exports.beginDeviceChallenge = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const purpose = cleanText(request.data?.purpose, 24);
  let storeId = cleanText(request.data?.storeId, 100);
  if (purpose === "recovery" && !storeId) {
    const owned = await stores().where("ownerUid", "==", uid).limit(2).get();
    if (owned.size !== 1) throw new HttpsError("failed-precondition", "The original owner store could not be uniquely identified.");
    storeId = owned.docs[0].id;
  }
  storeId = validStoreId(storeId);
  const deviceId = cleanText(request.data?.deviceId, 100);
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(deviceId) ||
      !["claim","register","recovery","enroll","status","owner"].includes(purpose)) {
    throw new HttpsError("invalid-argument", "Invalid device challenge request.");
  }
  let publicKey = "";
  const storeRef = stores().doc(storeId);
  if (["claim","register","recovery","enroll"].includes(purpose)) {
    publicKey = cleanText(request.data?.publicKey, 1000);
    if (!publicKey) throw new HttpsError("invalid-argument", "The device public key is missing.");
    try {
      const key = crypto.createPublicKey({ key: fromB64url(publicKey), format: "der", type: "spki" });
      if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("wrong key type");
    } catch {
      throw new HttpsError("invalid-argument", "The device public key is not a valid P-256 key.");
    }
  } else {
    const deviceSnap = await storeRef.collection("devices").doc(deviceId).get();
    if (!deviceSnap.exists || deviceSnap.data().authUid !== uid || !deviceSnap.data().publicKey) {
      throw new HttpsError("permission-denied", "This device has no registered secure identity.");
    }
    publicKey = deviceSnap.data().publicKey;
  }
  if (purpose === "enroll") {
    const existing = await storeRef.collection("devices").doc(deviceId).get();
    if (!existing.exists || existing.data().authUid !== uid ||
        !["active","pending"].includes(existing.data().status)) {
      throw new HttpsError("permission-denied", "Only your already-registered device can complete secure identity migration.");
    }
    const registeredKey = cleanText(existing.data().publicKey, 1000);
    if (registeredKey && registeredKey !== publicKey) {
      throw new HttpsError("already-exists", "This installation is already bound to a different secure identity.");
    }
    if (registeredKey === publicKey) return { alreadyEnrolled: true, storeId };
  }
  const challenge = b64url(crypto.randomBytes(32));
  const challengeId = b64url(crypto.randomBytes(18));
  const expiresAt = Date.now() + 2 * 60 * 1000;
  await deviceChallengeRef(storeId, challengeId).create({
    uid, storeId, deviceId, purpose, publicKey,
    challengeHash: hashCode(challenge), expiresAt,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { challengeId, challenge, publicKey, storeId, expiresAt };
});

const verifyDeviceProof = async (request, storeId, deviceId, purpose, allowEnrollment = false, allowPending = false) => {
  const uid = requireAuth(request);
  const proof = request.data?.deviceProof || {};
  const challengeId = cleanText(proof.challengeId, 100);
  const challenge = cleanText(proof.challenge, 200);
  const signature = fromB64url(proof.signature);
  if (!challengeId || !challenge || !signature.length) throw new HttpsError("permission-denied", "Secure device proof is required.");
  const ref = deviceChallengeRef(storeId, challengeId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("permission-denied", "The device challenge is invalid or already used.");
    const data = snap.data();
    if (data.uid !== uid || data.storeId !== storeId || data.deviceId !== deviceId ||
        data.purpose !== purpose || data.expiresAt < Date.now() ||
        data.challengeHash !== hashCode(challenge)) {
      throw new HttpsError("permission-denied", "The device challenge expired or does not match this request.");
    }
    let keyBytes;
    if (allowEnrollment) {
      const supplied = cleanText(proof.publicKey, 1000);
      if (!supplied || supplied !== data.publicKey) throw new HttpsError("permission-denied", "The enrollment public key does not match the challenge.");
      keyBytes = fromB64url(supplied);
    } else {
      const deviceSnap = await tx.get(stores().doc(storeId).collection("devices").doc(deviceId));
      if (!deviceSnap.exists || deviceSnap.data().authUid !== uid ||
          deviceSnap.data().publicKey !== data.publicKey || (deviceSnap.data().status !== "active" && !(allowPending && deviceSnap.data().status === "pending"))) {
        throw new HttpsError("permission-denied", "This device is not actively registered.");
      }
      keyBytes = fromB64url(data.publicKey);
    }
    let valid = false;
    try {
      const publicKey = crypto.createPublicKey({ key: keyBytes, format: "der", type: "spki" });
      valid = crypto.verify("sha256", Buffer.from(challenge, "utf8"),
        { key: publicKey, dsaEncoding: signature.length === 64 ? "ieee-p1363" : "der" }, signature);
    } catch { valid = false; }
    if (!valid) throw new HttpsError("permission-denied", "Secure device signature verification failed.");
    tx.delete(ref);
  });
  return { uid, publicKey: cleanText(proof.publicKey, 1000) };
};


exports.enrollDeviceIdentity = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const storeId = validStoreId(request.data?.storeId);
  const deviceId = cleanText(request.data?.deviceId, 100);
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(deviceId)) throw new HttpsError("invalid-argument", "The installation ID is invalid.");
  const proof = await verifyDeviceProof(request, storeId, deviceId, "enroll", true);
  const ref = stores().doc(storeId).collection("devices").doc(deviceId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().authUid !== uid || !["active","pending"].includes(snap.data().status)) {
    throw new HttpsError("permission-denied", "This device is not eligible for secure identity migration.");
  }
  const existingKey = cleanText(snap.data().publicKey, 1000);
  if (existingKey && existingKey !== proof.publicKey) throw new HttpsError("already-exists", "This device is already bound to a different secure identity.");
  if (!existingKey) await ref.update({ publicKey: proof.publicKey, identityEnrolledAt: admin.firestore.FieldValue.serverTimestamp() });
  return { ok: true, alreadyEnrolled: !!existingKey };
});

exports.claimExistingStore = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const email = cleanText(request.auth.token.email, 254).toLowerCase();
  if (!email || request.auth.token.email_verified !== true || request.auth.token.firebase?.sign_in_provider !== "password") {
    throw new HttpsError("failed-precondition", "Sign in with the verified owner email and password before claiming this existing store.");
  }
  const storeId = validStoreId(request.data?.storeId);
  const deviceId = cleanText(request.data?.deviceId, 100);
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(deviceId)) {
    throw new HttpsError("invalid-argument", "The installation ID is invalid.");
  }
  const proofResult = await verifyDeviceProof(request, storeId, deviceId, "claim", true);
  const storeName = cleanText(request.data?.storeName, 100) || "Ronyal Super Store";
  const storeRef = stores().doc(storeId);
  const legacyCollections = ["products","sales","expenses","customers","suppliers","purchases","creditPayments","returns"];
  const legacyChecks = await Promise.all(legacyCollections.map(name => storeRef.collection("ronyal_pos").doc("root").collection(name).limit(1).get()));
  if (!legacyChecks.some(snapshot => !snapshot.empty)) {
    throw new HttpsError("failed-precondition", "No existing POS cloud records were found under this Store ID. Reconnect and sync the original owner installation first. The function will not claim an empty or newly invented Store ID.");
  }
  const employeeId = "owner-" + uid;
  const deviceRef = storeRef.collection("devices").doc(deviceId);
  const employeeRef = storeRef.collection("employees").doc(employeeId);
  await db.runTransaction(async (tx) => {
    const [storeSnap, deviceSnap] = await Promise.all([tx.get(storeRef), tx.get(deviceRef)]);
    if (storeSnap.exists && storeSnap.data().ownerUid && storeSnap.data().ownerUid !== uid) {
      throw new HttpsError("already-exists", "This database has already been claimed by a different owner account. Contact support; do not reset or replace the database.");
    }
    if (storeSnap.exists && storeSnap.data().ownerUid === uid && (!deviceSnap.exists || deviceSnap.data().authUid !== uid || deviceSnap.data().status !== "active")) {
      throw new HttpsError("permission-denied", "This owner account is already linked to the store. Use verified owner recovery to authorize a replacement installation.");
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
      deviceId,
      installationId: deviceId,
      publicKey: proofResult.publicKey,
      authUid: uid,
      employeeId,
      role: "owner",
      deviceName: cleanText(request.data?.deviceName, 80) || "Owner device",
      status: "active",
      registeredAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeen: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
  return { ok: true, storeId, employeeId, role: "owner", customToken: await issueSessionToken(uid, storeId, deviceId) };
});

exports.createDeviceInvite = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const storeId = validStoreId(request.data?.storeId);
  await requireOwner(storeId, uid, request.auth.token, request);
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
  const installationId = cleanText(request.data?.deviceId, 100);
  const deviceRef = stores().doc(storeId).collection("devices").doc(installationId);
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(installationId)) throw new HttpsError("invalid-argument", "The installation ID is invalid.");
  const proofResult = await verifyDeviceProof(request, storeId, installationId, "register", true);
  await db.runTransaction(async (tx) => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists || inviteSnap.data().used || inviteSnap.data().expiresAt.toMillis() < Date.now()) {
      throw new HttpsError("failed-precondition", "This activation code has expired or has already been used. Ask the owner for a new code.");
    }
    const existing = await tx.get(deviceRef);
    if (existing.exists && existing.data().authUid !== uid) throw new HttpsError("already-exists", "This device record belongs to another sign-in.");
    if (existing.exists && existing.data().status === "active") throw new HttpsError("failed-precondition", "This installation is already authorized. No new registration is needed.");
    tx.update(inviteRef, { used: true, usedAt: admin.firestore.FieldValue.serverTimestamp(), usedBy: uid });
    tx.set(deviceRef, {
      deviceId: installationId, installationId, publicKey: proofResult.publicKey, authUid: uid,
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
  const deviceId = cleanText(request.data?.deviceId, 100);
  const employeeId = cleanText(request.data?.employeeId, 128);
  if (!deviceId || !employeeId) throw new HttpsError("invalid-argument", "Choose a pending device and an employee.");
  await requireOwner(storeId, uid, request.auth.token, request);
  const storeRef = stores().doc(storeId);
  const deviceRef = storeRef.collection("devices").doc(deviceId);
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
  const deviceId = cleanText(request.data?.deviceId, 100);
  if (!deviceId || deviceId === request.auth.token.rssDeviceId) throw new HttpsError("invalid-argument", "Choose another device. The current owner device cannot revoke itself.");
  await requireOwner(storeId, uid, request.auth.token, request);
  const ref = stores().doc(storeId).collection("devices").doc(deviceId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Device not found.");
  await ref.update({ status: "revoked", revokedAt: admin.firestore.FieldValue.serverTimestamp(), revokedBy: uid });
  return { ok: true };
});

exports.getDeviceStatus = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const storeId = validStoreId(request.data?.storeId);
  const deviceId = cleanText(request.data?.deviceId, 100);
  if (!deviceId) throw new HttpsError("invalid-argument", "The installation ID is missing.");
  await verifyDeviceProof(request, storeId, deviceId, "status", false, true);
  const ref = stores().doc(storeId).collection("devices").doc(deviceId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().authUid !== uid) throw new HttpsError("not-found", "This installation has not been registered for this store.");
  const data = snap.data();
  if (data.status !== "active") return { status: data.status || "pending" };
  const employeeSnap = await stores().doc(storeId).collection("employees").doc(data.employeeId).get();
  if (!employeeSnap.exists || employeeSnap.data().status !== "active") return { status: "suspended" };
  await ref.update({ lastSeen: admin.firestore.FieldValue.serverTimestamp() });
  const employee = employeeSnap.data();
  return { status: "active", employeeId: data.employeeId, employee: { name: employee.name, role: employee.role, permissions: employee.permissions || {} }, customToken: await issueSessionToken(uid, storeId, deviceId) };
});

exports.registerOwnerRecoveryDevice = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  if (!request.auth.token.email || request.auth.token.email_verified !== true) throw new HttpsError("failed-precondition", "Sign in with the original verified owner email account.");
  const deviceId = cleanText(request.data?.deviceId, 100);
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(deviceId)) throw new HttpsError("invalid-argument", "The installation ID is invalid.");
  const owned = await stores().where("ownerUid", "==", uid).limit(2).get();
  if (owned.empty) throw new HttpsError("not-found", "No existing Ronyal store is linked to this owner account.");
  if (owned.size > 1) throw new HttpsError("failed-precondition", "More than one store is linked to this account. Contact support to select the correct store.");
  const storeDoc = owned.docs[0], storeId = storeDoc.id, employeeId = "owner-" + uid;
  const proofResult = await verifyDeviceProof(request, storeId, deviceId, "recovery", true);
  const deviceRef = storeDoc.ref.collection("devices").doc(deviceId);
  const existingDevice = await deviceRef.get();
  if (existingDevice.exists && existingDevice.data().authUid !== uid) throw new HttpsError("already-exists", "This installation ID is already assigned to another account.");
  if (request.auth.token.firebase?.sign_in_provider !== "password" || Date.now() - Number(request.auth.token.auth_time || 0) * 1000 > 10 * 60 * 1000) throw new HttpsError("requires-recent-login", "Sign in again with the owner email and password to approve this replacement device.");
  const priorOwnerDevices = await storeDoc.ref.collection("devices").where("role", "==", "owner").where("status", "==", "active").get();
  const recoveryBatch = db.batch();
  priorOwnerDevices.docs.forEach(doc => {
    if (doc.id !== deviceId) recoveryBatch.update(doc.ref, {
      status: "revoked",
      revokedAt: admin.firestore.FieldValue.serverTimestamp(),
      revokedReason: "replaced-by-owner-recovery"
    });
  });
  recoveryBatch.set(deviceRef, { deviceId, installationId: deviceId, publicKey: proofResult.publicKey, authUid: uid, employeeId, role: "owner", deviceName: cleanText(request.data?.deviceName, 80) || "Owner recovery device", status: "active", recoveryActivatedAt: admin.firestore.FieldValue.serverTimestamp(), registeredAt: admin.firestore.FieldValue.serverTimestamp(), lastSeen: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await recoveryBatch.commit();
  return { ok: true, storeId, employeeId, customToken: await issueSessionToken(uid, storeId, deviceId) };
});

exports.assignDevice = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const storeId = validStoreId(request.data?.storeId);
  const deviceId = cleanText(request.data?.deviceId, 100);
  const employeeId = cleanText(request.data?.employeeId, 128);
  if (!deviceId || !employeeId) throw new HttpsError("invalid-argument", "Choose a device and employee.");
  await requireOwner(storeId, uid, request.auth.token, request);
  const storeRef = stores().doc(storeId), deviceRef = storeRef.collection("devices").doc(deviceId), employeeRef = storeRef.collection("employees").doc(employeeId);
  const results = await Promise.all([deviceRef.get(), employeeRef.get()]);
  const device = results[0], employee = results[1];
  if (!device.exists || device.data().status !== "active" || device.data().role === "owner") throw new HttpsError("failed-precondition", "Only an active employee device can be reassigned.");
  if (!employee.exists || employee.data().status !== "active" || employee.data().role === "owner") throw new HttpsError("failed-precondition", "Choose an active non-owner employee.");
  await deviceRef.update({ employeeId, reassignedAt: admin.firestore.FieldValue.serverTimestamp(), reassignedBy: uid });
  return { ok: true };
});

exports.renameDevice = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const storeId = validStoreId(request.data?.storeId);
  const deviceId = cleanText(request.data?.deviceId, 100);
  const deviceName = cleanText(request.data?.deviceName, 80);
  if (!deviceId || !deviceName) throw new HttpsError("invalid-argument", "Enter a device name.");
  await requireOwner(storeId, uid, request.auth.token, request);
  const ref = stores().doc(storeId).collection("devices").doc(deviceId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Device not found.");
  await ref.update({ deviceName, renamedAt: admin.firestore.FieldValue.serverTimestamp(), renamedBy: uid });
  return { ok: true };
});
