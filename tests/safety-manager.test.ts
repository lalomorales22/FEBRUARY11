import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../backend/src/errors.js";
import { SafetyManager } from "../backend/src/safety-manager.js";
import { createTestLogger } from "./helpers/test-doubles.js";

test("SafetyManager rate limits actions inside the configured window", () => {
  const manager = new SafetyManager({
    fallbackScene: "EmergencyScene",
    maxActionsPerWindow: 2,
    windowMs: 60_000,
    logger: createTestLogger()
  });

  assert.equal(manager.guardAction("a").ok, true);
  assert.equal(manager.guardAction("b").ok, true);

  const blocked = manager.guardAction("c");
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason ?? "", /rate limited/);

  const status = manager.getStatus();
  assert.equal(status.actionsInWindow, 2);
  assert.equal(status.remainingInWindow, 0);
  assert.match(status.lastBlockedReason ?? "", /rate limited/);
});

test("SafetyManager kill switch blocks actions unless bypassed", () => {
  const manager = new SafetyManager({
    fallbackScene: "EmergencyScene",
    maxActionsPerWindow: 5,
    windowMs: 60_000,
    logger: createTestLogger()
  });

  manager.setKillSwitch(true, "operator-triggered");
  const blocked = manager.guardAction("chaos:demo");
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason ?? "", /kill switch/);

  assert.throws(
    () => manager.assertAction("chaos:demo"),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "SAFETY_BLOCKED" &&
      error.statusCode === 423
  );

  assert.doesNotThrow(() => {
    manager.assertAction("safety:fallback", { bypassKillSwitch: true });
  });
});

test("SafetyManager subscribers receive current and updated snapshots", () => {
  const manager = new SafetyManager({
    fallbackScene: null,
    maxActionsPerWindow: 10,
    windowMs: 60_000,
    logger: createTestLogger()
  });

  const events: Array<{ killSwitch: boolean; actionsInWindow: number }> = [];
  const unsubscribe = manager.subscribe((status) => {
    events.push({
      killSwitch: status.killSwitch,
      actionsInWindow: status.actionsInWindow
    });
  });

  manager.guardAction("test");
  manager.setKillSwitch(true);
  unsubscribe();
  manager.setKillSwitch(false);

  assert.equal(events.length >= 3, true);
  assert.equal(events[0].killSwitch, false);
  assert.equal(events[1].actionsInWindow, 1);
  assert.equal(events[2].killSwitch, true);
});
