import crypto from "node:crypto";

const projectId = process.env.FIREBASE_PROJECT_ID || "study-1b905";
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;

if (!serviceAccountJson) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON secret is required.");
}

if (!webhookUrl) {
  throw new Error("GOOGLE_CHAT_WEBHOOK_URL secret is required.");
}

const serviceAccount = JSON.parse(serviceAccountJson);
const accessToken = await getAccessToken(serviceAccount);
const pendingUsers = await loadPendingUsers({ projectId, accessToken });

for (const user of pendingUsers) {
  await sendGoogleChatMessage({ webhookUrl, user });
  await markNotified({ projectId, accessToken, documentName: user.documentName });
  console.log(`Notified first login: ${user.email || user.uid}`);
}

if (!pendingUsers.length) {
  console.log("No pending first-login notifications.");
}

async function loadPendingUsers({ projectId, accessToken }) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "users" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "firstLoginChatNotificationPending" },
              op: "EQUAL",
              value: { booleanValue: true },
            },
          },
          limit: 20,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Firestore query failed: ${await response.text()}`);
  }

  const rows = await response.json();
  return rows
    .map((row) => row.document)
    .filter(Boolean)
    .map((document) => ({
      documentName: document.name,
      uid: readValue(document.fields?.uid),
      displayName: readValue(document.fields?.displayName),
      email: readValue(document.fields?.email),
      role: readValue(document.fields?.role),
      grade: readValue(document.fields?.grade),
      createdAt: readValue(document.fields?.createdAt),
    }));
}

async function sendGoogleChatMessage({ webhookUrl, user }) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ text: buildMessage(user) }),
  });

  if (!response.ok) {
    throw new Error(`Google Chat notification failed: ${await response.text()}`);
  }
}

async function markNotified({ projectId, accessToken, documentName }) {
  const now = new Date();
  const response = await fetch(
    `https://firestore.googleapis.com/v1/${documentName}?updateMask.fieldPaths=firstLoginChatNotificationPending&updateMask.fieldPaths=firstLoginChatNotifiedAt&updateMask.fieldPaths=updatedAt`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          firstLoginChatNotificationPending: { booleanValue: false },
          firstLoginChatNotifiedAt: { integerValue: String(now.getTime()) },
          updatedAt: { timestampValue: now.toISOString() },
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Firestore update failed: ${await response.text()}`);
  }
}

function buildMessage({ displayName, email, role, grade, uid, createdAt }) {
  const loggedAt = formatKoreanDate(createdAt || new Date());
  return [
    "최초 로그인 알림",
    `이름: ${displayName || "이름 없음"}`,
    `이메일: ${email || "-"}`,
    `역할: ${role || "student"}`,
    `학년: ${grade || "-"}`,
    `UID: ${uid || "-"}`,
    `시간: ${loggedAt}`,
  ].join("\n");
}

function readValue(value) {
  if (!value) return "";
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("timestampValue" in value) return value.timestampValue;
  return "";
}

function formatKoreanDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const assertion = [
    base64Url(JSON.stringify(header)),
    base64Url(JSON.stringify(payload)),
  ].join(".");
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(assertion)
    .sign(serviceAccount.private_key);
  const jwt = `${assertion}.${base64Url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google auth failed: ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

function base64Url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
