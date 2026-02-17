import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../backend/src/errors.js";
import { OverlayBridge } from "../backend/src/overlay-bridge.js";
import { createTestLogger } from "./helpers/test-doubles.js";

interface MockCall {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

type MockFetch = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

function toBodyRecord(init?: RequestInit): Record<string, unknown> {
  if (!init?.body || typeof init.body !== "string") {
    return {};
  }
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function withMockFetch<T>(
  mockFetch: MockFetch,
  run: () => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof globalThis.fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("OverlayBridge probes and forwards overlay API calls", async () => {
  const calls: MockCall[] = [];
  const baseUrl = "http://127.0.0.1:5555";

  await withMockFetch(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const body = toBodyRecord(init);
    calls.push({ url, method, body });

    if (url.endsWith("/api/stats")) {
      return new Response(JSON.stringify({ viewers: 10 }), { status: 200 });
    }
    if (url.endsWith("/api/test-alert")) {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    if (url.endsWith("/api/test-chat")) {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    if (url.endsWith("/api/scenes")) {
      return new Response(JSON.stringify({ scenes: ["Gameplay", "Camera"] }), { status: 200 });
    }
    if (url.endsWith("/api/scene")) {
      return new Response(JSON.stringify({ status: "ok", scene: body.scene }), { status: 200 });
    }
    if (url.endsWith("/api/start-stream")) {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    if (url.endsWith("/api/subtitles/settings")) {
      return new Response(JSON.stringify({ status: "ok", settings: body }), { status: 200 });
    }
    if (url.endsWith("/api/subtitles/push")) {
      return new Response(JSON.stringify({ status: "ok", subtitle: body }), { status: 200 });
    }
    if (url.endsWith("/api/subtitles/clear")) {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }

    return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
  }, async () => {
    const bridge = new OverlayBridge({
      enabled: true,
      baseUrl,
      requestTimeoutMs: 800,
      logger: createTestLogger()
    });

    const status = await bridge.probe();
    assert.equal(status.reachable, true);
    assert.equal(status.baseUrl, baseUrl);
    assert.equal(bridge.getLinks().dashboard, `${baseUrl}/dashboard`);
    assert.equal(bridge.getLinks().keyboard, `${baseUrl}/overlay/keyboard`);
    assert.equal(bridge.getLinks().subtitles, `${baseUrl}/overlay/subtitles`);

    const alert = await bridge.testAlert({ type: "follow", username: "Tester" });
    assert.equal(alert.status, "ok");

    const chat = await bridge.testChat({ username: "Tester", message: "hello" });
    assert.equal(chat.status, "ok");

    const scenes = await bridge.getScenes();
    assert.equal(Array.isArray(scenes.scenes), true);

    const switched = await bridge.switchScene("Camera");
    assert.equal(switched.status, "ok");

    const stream = await bridge.startStream();
    assert.equal(stream.status, "ok");

    const subtitleSettings = await bridge.updateSubtitleSettings({
      fontFamily: "Inter, sans-serif",
      fontSizePx: 54,
      textColor: "#ffffff",
      backgroundColor: "#000000",
      backgroundOpacity: 0.4
    });
    assert.equal(subtitleSettings.status, "ok");

    const subtitle = await bridge.pushSubtitle({ text: "hello world", final: true });
    assert.equal(subtitle.status, "ok");

    const subtitleClear = await bridge.clearSubtitle();
    assert.equal(subtitleClear.status, "ok");
  });

  assert.equal(calls.some((call) => call.url.endsWith("/api/test-alert")), true);
  assert.equal(calls.some((call) => call.url.endsWith("/api/test-chat")), true);
  assert.equal(calls.some((call) => call.url.endsWith("/api/scene")), true);
  assert.equal(calls.some((call) => call.url.endsWith("/api/subtitles/settings")), true);
  assert.equal(calls.some((call) => call.url.endsWith("/api/subtitles/push")), true);
  assert.equal(calls.some((call) => call.url.endsWith("/api/subtitles/clear")), true);
});

test("OverlayBridge marks status unreachable when upstream throws", async () => {
  await withMockFetch(async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/stats")) {
      throw new Error("connection refused");
    }
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  }, async () => {
    const bridge = new OverlayBridge({
      enabled: true,
      baseUrl: "http://127.0.0.1:5555",
      requestTimeoutMs: 400,
      logger: createTestLogger()
    });

    const status = await bridge.probe();
    assert.equal(status.reachable, false);
    assert.equal(typeof status.lastError === "string" && status.lastError.length > 0, true);
  });
});

test("OverlayBridge blocks calls when disabled", async () => {
  const bridge = new OverlayBridge({
    enabled: false,
    baseUrl: "http://127.0.0.1:5555",
    requestTimeoutMs: 300,
    logger: createTestLogger()
  });

  await assert.rejects(
    () => bridge.testAlert({ type: "follow", username: "x" }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "OVERLAYS_DISABLED" &&
      error.statusCode === 503
  );
});
