#!/usr/bin/env node

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3199";
const bursts = readInt("BURSTS", 12, 1);
const concurrency = readInt("CONCURRENCY", 30, 1);
const pauseMs = readInt("PAUSE_MS", 120, 0);
const timeoutMs = readInt("REQUEST_TIMEOUT_MS", 4000, 100);
const includeWrites = readBool("INCLUDE_WRITES", false);

const readEndpoints = [
  { method: "GET", path: "/api/health" },
  { method: "GET", path: "/api/status" },
  { method: "GET", path: "/api/safety/status" },
  { method: "GET", path: "/api/chaos/status" },
  { method: "GET", path: "/api/auto-director/status" },
  { method: "GET", path: "/api/replay/status" },
  { method: "GET", path: "/api/plugins/status" }
];

const writeEndpoints = [
  { method: "POST", path: "/api/obs/reconnect", body: {} },
  { method: "POST", path: "/api/auto-director/reload", body: {} },
  { method: "POST", path: "/api/plugins/reload", body: {} }
];

const targetEndpoints = includeWrites ? [...readEndpoints, ...writeEndpoints] : readEndpoints;

const metrics = {
  totalRequests: 0,
  okResponses: 0,
  non2xxResponses: 0,
  failedRequests: 0,
  minLatencyMs: Number.POSITIVE_INFINITY,
  maxLatencyMs: 0,
  totalLatencyMs: 0
};

console.log(
  JSON.stringify(
    {
      script: "event-burst",
      baseUrl,
      bursts,
      concurrency,
      pauseMs,
      timeoutMs,
      includeWrites,
      endpointCount: targetEndpoints.length
    },
    null,
    2
  )
);

for (let burstIndex = 0; burstIndex < bursts; burstIndex += 1) {
  const requests = [];
  for (let i = 0; i < concurrency; i += 1) {
    const endpoint = targetEndpoints[(burstIndex * concurrency + i) % targetEndpoints.length];
    requests.push(request(endpoint));
  }

  const settled = await Promise.allSettled(requests);
  for (const result of settled) {
    if (result.status === "fulfilled") {
      onSuccess(result.value.status, result.value.elapsedMs);
      continue;
    }
    metrics.failedRequests += 1;
  }

  console.log(
    `[burst ${burstIndex + 1}/${bursts}] total=${metrics.totalRequests} ok=${metrics.okResponses} ` +
      `non2xx=${metrics.non2xxResponses} failed=${metrics.failedRequests}`
  );

  if (pauseMs > 0 && burstIndex < bursts - 1) {
    await sleep(pauseMs);
  }
}

const avgLatencyMs =
  metrics.totalRequests > 0 ? Number((metrics.totalLatencyMs / metrics.totalRequests).toFixed(2)) : 0;

console.log("\nEvent burst summary");
console.log(
  JSON.stringify(
    {
      totalRequests: metrics.totalRequests,
      okResponses: metrics.okResponses,
      non2xxResponses: metrics.non2xxResponses,
      failedRequests: metrics.failedRequests,
      avgLatencyMs,
      minLatencyMs: Number.isFinite(metrics.minLatencyMs) ? metrics.minLatencyMs : null,
      maxLatencyMs: metrics.maxLatencyMs
    },
    null,
    2
  )
);

async function request(endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const response = await fetch(`${baseUrl}${endpoint.path}`, {
      method: endpoint.method,
      headers: endpoint.body ? { "content-type": "application/json" } : undefined,
      body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
      signal: controller.signal
    });
    return {
      status: response.status,
      elapsedMs: Date.now() - started
    };
  } finally {
    clearTimeout(timer);
  }
}

function onSuccess(status, elapsedMs) {
  metrics.totalRequests += 1;
  metrics.totalLatencyMs += elapsedMs;
  metrics.minLatencyMs = Math.min(metrics.minLatencyMs, elapsedMs);
  metrics.maxLatencyMs = Math.max(metrics.maxLatencyMs, elapsedMs);

  if (status >= 200 && status < 300) {
    metrics.okResponses += 1;
  } else {
    metrics.non2xxResponses += 1;
  }
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

function readBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

async function sleep(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
