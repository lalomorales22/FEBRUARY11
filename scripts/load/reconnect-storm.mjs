#!/usr/bin/env node

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3199";
const cycles = readInt("CYCLES", 25, 1);
const pauseMs = readInt("PAUSE_MS", 300, 0);
const timeoutMs = readInt("REQUEST_TIMEOUT_MS", 4000, 100);
const mode = (process.env.MODE ?? "reconnect").trim().toLowerCase();
const verifyEvery = readInt("VERIFY_EVERY", 5, 1);

const stats = {
  operations: 0,
  okResponses: 0,
  non2xxResponses: 0,
  failedRequests: 0
};

console.log(
  JSON.stringify(
    {
      script: "reconnect-storm",
      baseUrl,
      cycles,
      pauseMs,
      timeoutMs,
      mode,
      verifyEvery
    },
    null,
    2
  )
);

for (let cycle = 1; cycle <= cycles; cycle += 1) {
  if (mode === "disconnect-connect") {
    await request("POST", "/api/obs/disconnect");
    await sleep(Math.max(50, Math.floor(pauseMs / 2)));
    await request("POST", "/api/obs/connect");
  } else {
    await request("POST", "/api/obs/reconnect");
  }

  if (cycle % verifyEvery === 0 || cycle === cycles) {
    const status = await request("GET", "/api/status");
    const phase = readConnectionPhase(status.payload);
    console.log(
      `[cycle ${cycle}/${cycles}] operations=${stats.operations} ok=${stats.okResponses} ` +
        `non2xx=${stats.non2xxResponses} failed=${stats.failedRequests} phase=${phase}`
    );
  }

  if (pauseMs > 0 && cycle < cycles) {
    await sleep(pauseMs);
  }
}

console.log("\nReconnect storm summary");
console.log(JSON.stringify(stats, null, 2));

async function request(method, apiPath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  stats.operations += 1;

  try {
    const response = await fetch(`${baseUrl}${apiPath}`, {
      method,
      headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      body: method === "POST" ? "{}" : undefined,
      signal: controller.signal
    });

    if (response.status >= 200 && response.status < 300) {
      stats.okResponses += 1;
    } else {
      stats.non2xxResponses += 1;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return { status: response.status, payload };
  } catch {
    stats.failedRequests += 1;
    return { status: null, payload: null };
  } finally {
    clearTimeout(timer);
  }
}

function readConnectionPhase(payload) {
  if (!payload || typeof payload !== "object") {
    return "unknown";
  }

  const connection =
    payload.connection && typeof payload.connection === "object" ? payload.connection : null;
  if (!connection) {
    return "unknown";
  }

  return typeof connection.phase === "string" ? connection.phase : "unknown";
}

function readInt(name, fallback, min) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return parsed;
}

async function sleep(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
