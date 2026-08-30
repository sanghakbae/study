export function onRequest({ request }) {
  const host = new URL(request.url).host;
  return new Response(JSON.stringify({
    apiKey: "AIzaSyBo8Vkv0U9XLggRF95e-Qes4A4TSfe2VPQ",
    authDomain: host,
    projectId: "study-1b905",
    storageBucket: "study-1b905.firebasestorage.app",
    messagingSenderId: "977103150404",
    appId: "1:977103150404:web:9a6878941723397fd80b11",
    measurementId: "G-ZBTK4RP245",
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
