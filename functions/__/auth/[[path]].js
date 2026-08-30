const FIREBASE_AUTH_ORIGIN = "https://study-1b905.firebaseapp.com";

export async function onRequest({ request }) {
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(sourceUrl.pathname + sourceUrl.search, FIREBASE_AUTH_ORIGIN);
  const headers = new Headers(request.headers);
  headers.set("host", "study-1b905.firebaseapp.com");

  return fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });
}
