/*
  Netlify Function adapter for the v1.8.15 provider runtime.

  This function handles portal metadata, catalogue requests, and create_link
  calls only. Playback responses contain the provider's direct URL; the
  function never relays video bytes.
*/
process.env.STB_PLAY_SERVERLESS = "1";
process.env.NETPLUS_CONFIG_PATH ||= "/tmp/stb-play-web-config.json";

const {
  handle,
  invalidateContentCaches,
  withWebRequest,
} = require("./provider-runtime.cjs");

function header(event, name) {
  const wanted = String(name || "").toLowerCase();
  const headers = event?.headers || {};
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
  return key ? String(headers[key] || "").trim() : "";
}

function decodeBody(event) {
  if (!event?.body) return undefined;
  const raw = event.isBase64Encoded
    ? Buffer.from(String(event.body), "base64").toString("utf8")
    : String(event.body);
  const contentType = header(event, "content-type");
  if (/application\/json/i.test(contentType)) {
    try { return JSON.parse(raw || "{}"); } catch { return raw; }
  }
  return raw;
}

function queryString(event) {
  if (event?.rawQueryString) return `?${event.rawQueryString}`;
  const params = event?.queryStringParameters || {};
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

function requestPath(event) {
  let path = String(event?.path || event?.rawPath || "/");
  const functionPrefix = "/.netlify/functions/provider-api";
  if (path.startsWith(functionPrefix)) path = path.slice(functionPrefix.length) || "/";
  if (!path.startsWith("/api/") && path !== "/api") path = `/api${path === "/" ? "" : path}`;
  return path || "/api";
}

function makeRequest(event) {
  const headers = {};
  for (const [key, value] of Object.entries(event?.headers || {})) {
    headers[String(key).toLowerCase()] = String(value || "");
  }

  return {
    method: String(event?.httpMethod || event?.requestContext?.http?.method || "GET").toUpperCase(),
    url: `${requestPath(event)}${queryString(event)}`,
    headers,
    body: decodeBody(event),
    on() {},
  };
}

function makeResponse() {
  let statusCode = 200;
  const headers = {};
  const chunks = [];

  return {
    writeHead(status, nextHeaders = {}) {
      statusCode = Number(status) || 200;
      Object.assign(headers, nextHeaders);
    },
    setHeader(name, value) {
      headers[String(name)] = value;
    },
    getHeader(name) {
      const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === String(name).toLowerCase());
      return key ? headers[key] : undefined;
    },
    write(chunk) {
      if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    },
    end(chunk) {
      if (chunk != null) this.write(chunk);
      this.finished = true;
    },
    on() {},
    destroy() { this.finished = true; },
    getResult() {
      const body = Buffer.concat(chunks);
      const contentType = Object.keys(headers).find((key) => key.toLowerCase() === "content-type");
      const isBinary = !contentType || !/^text\//i.test(String(headers[contentType])) && !/json|javascript|mpegurl|xml/i.test(String(headers[contentType]));
      return {
        statusCode,
        headers,
        body: isBinary ? body.toString("base64") : body.toString("utf8"),
        isBase64Encoded: isBinary,
      };
    },
  };
}

function isProviderPath(path) {
  return path === "/api/catalog" ||
    path === "/api/subscription" ||
    path === "/api/poster" ||
    path.startsWith("/api/vod/") ||
    path.startsWith("/api/series/") ||
    path === "/api/play";
}

exports.handler = async (event) => {
  const path = requestPath(event);
  const portalUrl = header(event, "x-stb-portal-url");
  const mac = header(event, "x-stb-mac");

  if (isProviderPath(path) && (!portalUrl || !mac)) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      body: JSON.stringify({ error: "Connect an authorized portal before requesting content." }),
    };
  }

  const request = makeRequest(event);
  const response = makeResponse();

  try {
    invalidateContentCaches();
    await withWebRequest({ portalUrl, mac }, () => handle(request, response));
    return response.getResult();
  } catch (error) {
    const statusCode = Number(error?.status) || 500;
    return {
      statusCode,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      body: JSON.stringify({ error: error?.message || "Provider request failed." }),
    };
  }
};
