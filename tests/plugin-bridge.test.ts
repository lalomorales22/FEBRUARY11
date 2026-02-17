import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { AppError } from "../backend/src/errors.js";
import { PluginBridge } from "../backend/src/plugin-bridge.js";
import { SafetyManager } from "../backend/src/safety-manager.js";
import { MockObsManager, createTestLogger } from "./helpers/test-doubles.js";

async function createPermissionsFile(contents: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "february11-plugin-"));
  const file = path.join(dir, "plugin-permissions.json");
  await writeFile(file, JSON.stringify(contents, null, 2), "utf8");
  return file;
}

function createSafety(): SafetyManager {
  return new SafetyManager({
    fallbackScene: "EmergencyScene",
    maxActionsPerWindow: 100,
    windowMs: 60_000,
    logger: createTestLogger()
  });
}

test("PluginBridge enforces vendor request and role permissions", async () => {
  const permissionsPath = await createPermissionsFile({
    defaultPolicy: "deny",
    vendors: [
      {
        vendorName: "obs-browser",
        enabled: true,
        allowedRequests: ["refresh"],
        allowedRoles: ["operator"]
      }
    ]
  });
  const permissionsDir = path.dirname(permissionsPath);
  const obs = new MockObsManager();
  obs.setResponse("CallVendorRequest", { ok: true, accepted: true });

  const bridge = new PluginBridge({
    permissionsPath,
    defaultPolicy: "deny",
    recentEventLimit: 5,
    obsManager: obs as never,
    safetyManager: createSafety(),
    logger: createTestLogger()
  });

  try {
    await bridge.init();

    const allowed = await bridge.callVendor({
      vendorName: "obs-browser",
      requestType: "refresh",
      role: "operator",
      requestData: { force: true }
    });
    assert.equal(allowed.ok, true);

    await assert.rejects(
      () =>
        bridge.callVendor({
          vendorName: "obs-browser",
          requestType: "refresh",
          role: "viewer"
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "PLUGIN_PERMISSION_DENIED" &&
        error.statusCode === 403
    );

    await assert.rejects(
      () =>
        bridge.callVendor({
          vendorName: "missing-vendor",
          requestType: "anything",
          role: "operator"
        }),
      (error: unknown) => error instanceof AppError && error.code === "PLUGIN_PERMISSION_DENIED"
    );
  } finally {
    bridge.stop();
    await rm(permissionsDir, { recursive: true, force: true });
  }
});

test("PluginBridge supports default allow policy and caps recent vendor events", async () => {
  const permissionsPath = await createPermissionsFile({
    defaultPolicy: "allow",
    vendors: []
  });
  const permissionsDir = path.dirname(permissionsPath);
  const obs = new MockObsManager();
  obs.setResponse("CallVendorRequest", { ok: true });

  const bridge = new PluginBridge({
    permissionsPath,
    defaultPolicy: "deny",
    recentEventLimit: 2,
    obsManager: obs as never,
    safetyManager: createSafety(),
    logger: createTestLogger()
  });

  try {
    await bridge.init();

    const result = await bridge.callVendor({
      vendorName: "any-vendor",
      requestType: "ping",
      role: "moderator"
    });
    assert.equal(result.ok, true);

    obs.emit("VendorEvent", { vendorName: "A", eventType: "one" });
    obs.emit("VendorEvent", { vendorName: "B", eventType: "two" });
    obs.emit("VendorEvent", { vendorName: "C", eventType: "three" });

    const status = bridge.getStatus();
    assert.equal(status.recentVendorEvents.length, 2);
    assert.equal(status.recentVendorEvents[0].vendorName, "C");
    assert.equal(status.recentVendorEvents[1].vendorName, "B");
  } finally {
    bridge.stop();
    await rm(permissionsDir, { recursive: true, force: true });
  }
});
