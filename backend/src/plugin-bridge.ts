import { promises as fs } from "node:fs";

import type { PluginBridgeStatus, PluginPermission } from "../../shared/src/types.js";
import { AppError } from "./errors.js";
import type { ObsConnectionManager } from "./obs-manager.js";
import type { SafetyManager } from "./safety-manager.js";

interface LoggerLike {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface PluginBridgeConfig {
  permissionsPath: string;
  defaultPolicy: "allow" | "deny";
  recentEventLimit: number;
  obsManager: ObsConnectionManager;
  safetyManager: SafetyManager;
  logger: LoggerLike;
}

interface PluginPermissionFile {
  defaultPolicy?: "allow" | "deny";
  vendors?: unknown;
}

interface CallVendorOptions {
  vendorName: string;
  requestType: string;
  requestData?: Record<string, unknown>;
  role?: string;
}

type PluginListener = (status: PluginBridgeStatus) => void;

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toPermission(raw: Record<string, unknown>): PluginPermission | null {
  const vendorName = typeof raw.vendorName === "string" ? raw.vendorName.trim() : "";
  if (!vendorName) {
    return null;
  }

  return {
    vendorName,
    enabled: raw.enabled !== false,
    allowedRequests: normalizeStringArray(raw.allowedRequests),
    allowedRoles: normalizeStringArray(raw.allowedRoles),
    notes: typeof raw.notes === "string" && raw.notes.trim().length > 0 ? raw.notes.trim() : null
  };
}

export class PluginBridge {
  private readonly config: PluginBridgeConfig;
  private readonly listeners = new Set<PluginListener>();

  private permissions = new Map<string, PluginPermission>();
  private recentVendorEvents: Array<{ vendorName: string; eventType: string; receivedAt: string }> =
    [];
  private unsubscribeVendorEvent: (() => void) | null = null;

  private status: PluginBridgeStatus = {
    loadedAt: null,
    defaultPolicy: "deny",
    vendorCount: 0,
    vendors: [],
    lastCallAt: null,
    lastCallVendor: null,
    lastError: null,
    recentVendorEvents: [],
    updatedAt: nowIso()
  };

  constructor(config: PluginBridgeConfig) {
    this.config = config;
    this.status.defaultPolicy = config.defaultPolicy;
  }

  async init(): Promise<void> {
    await this.reloadPermissions();

    if (!this.unsubscribeVendorEvent) {
      this.unsubscribeVendorEvent = this.config.obsManager.onEvent("VendorEvent", (event) => {
        this.onVendorEvent(event);
      });
    }
  }

  stop(): void {
    if (this.unsubscribeVendorEvent) {
      this.unsubscribeVendorEvent();
      this.unsubscribeVendorEvent = null;
    }
  }

  getStatus(): PluginBridgeStatus {
    return {
      ...this.status,
      vendors: this.status.vendors.map((vendor) => ({
        ...vendor,
        allowedRequests: [...vendor.allowedRequests],
        allowedRoles: [...vendor.allowedRoles]
      })),
      recentVendorEvents: this.status.recentVendorEvents.map((event) => ({ ...event }))
    };
  }

  listVendors(): PluginPermission[] {
    return this.getStatus().vendors;
  }

  subscribe(listener: PluginListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async reloadPermissions(): Promise<PluginBridgeStatus> {
    let rawFile: PluginPermissionFile = {};
    try {
      const fileContent = await fs.readFile(this.config.permissionsPath, "utf8");
      rawFile = JSON.parse(fileContent) as PluginPermissionFile;
    } catch (error) {
      this.config.logger.warn("Plugin permission file load failed; using defaults", {
        path: this.config.permissionsPath,
        error: error instanceof Error ? error.message : String(error)
      });
      rawFile = {};
    }

    const defaultPolicy =
      rawFile.defaultPolicy === "allow" || rawFile.defaultPolicy === "deny"
        ? rawFile.defaultPolicy
        : this.config.defaultPolicy;

    const vendorsRaw = Array.isArray(rawFile.vendors) ? rawFile.vendors : [];
    const permissions = new Map<string, PluginPermission>();
    for (const raw of vendorsRaw) {
      const parsed = toPermission(asRecord(raw));
      if (!parsed) {
        continue;
      }
      permissions.set(parsed.vendorName, parsed);
    }

    this.permissions = permissions;
    this.status = {
      ...this.status,
      loadedAt: nowIso(),
      defaultPolicy,
      vendorCount: permissions.size,
      vendors: [...permissions.values()].sort((a, b) => a.vendorName.localeCompare(b.vendorName)),
      updatedAt: nowIso()
    };
    this.emit();
    return this.getStatus();
  }

  async callVendor(options: CallVendorOptions): Promise<Record<string, unknown>> {
    const vendorName = options.vendorName.trim();
    const requestType = options.requestType.trim();
    const role = (options.role ?? "operator").trim().toLowerCase();

    if (!vendorName || !requestType) {
      throw new AppError("vendorName and requestType are required", {
        statusCode: 400,
        code: "PLUGIN_REQUEST_INVALID"
      });
    }

    this.config.safetyManager.assertAction(`plugin:${vendorName}:${requestType}`);

    const permissionResult = this.checkPermission(vendorName, requestType, role);
    if (!permissionResult.allowed) {
      this.status = {
        ...this.status,
        lastError: permissionResult.reason ?? "Plugin request denied",
        updatedAt: nowIso()
      };
      this.emit();
      throw new AppError(permissionResult.reason ?? "Plugin request denied", {
        statusCode: 403,
        code: "PLUGIN_PERMISSION_DENIED"
      });
    }

    try {
      const response = await this.config.obsManager.call("CallVendorRequest", {
        vendorName,
        requestType,
        requestData: options.requestData ?? {}
      });

      this.status = {
        ...this.status,
        lastCallAt: nowIso(),
        lastCallVendor: vendorName,
        lastError: null,
        updatedAt: nowIso()
      };
      this.emit();
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = {
        ...this.status,
        lastCallAt: nowIso(),
        lastCallVendor: vendorName,
        lastError: message,
        updatedAt: nowIso()
      };
      this.emit();
      throw new AppError(`Vendor request failed: ${message}`, {
        statusCode: 500,
        code: "PLUGIN_VENDOR_CALL_FAILED"
      });
    }
  }

  private checkPermission(vendorName: string, requestType: string, role: string): {
    allowed: boolean;
    reason: string | null;
  } {
    const permission = this.permissions.get(vendorName);
    if (!permission) {
      if (this.status.defaultPolicy === "allow") {
        return { allowed: true, reason: null };
      }
      return {
        allowed: false,
        reason: `No permission entry for vendor "${vendorName}" (default deny)`
      };
    }

    if (!permission.enabled) {
      return {
        allowed: false,
        reason: `Vendor "${vendorName}" is disabled in permission registry`
      };
    }

    if (permission.allowedRoles.length > 0 && !permission.allowedRoles.includes(role)) {
      return {
        allowed: false,
        reason: `Role "${role}" is not allowed for vendor "${vendorName}"`
      };
    }

    if (
      permission.allowedRequests.length > 0 &&
      !permission.allowedRequests.includes("*") &&
      !permission.allowedRequests.includes(requestType)
    ) {
      return {
        allowed: false,
        reason: `Request "${requestType}" is not allowed for vendor "${vendorName}"`
      };
    }

    return { allowed: true, reason: null };
  }

  private onVendorEvent(event: unknown): void {
    const payload = asRecord(event);
    const vendorName =
      typeof payload.vendorName === "string" && payload.vendorName.trim().length > 0
        ? payload.vendorName.trim()
        : "unknown";
    const eventType =
      typeof payload.eventType === "string" && payload.eventType.trim().length > 0
        ? payload.eventType.trim()
        : "unknown";

    this.recentVendorEvents.unshift({
      vendorName,
      eventType,
      receivedAt: nowIso()
    });

    this.recentVendorEvents = this.recentVendorEvents.slice(0, this.config.recentEventLimit);
    this.status = {
      ...this.status,
      recentVendorEvents: [...this.recentVendorEvents],
      updatedAt: nowIso()
    };
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.config.logger.error("PluginBridge listener failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}
