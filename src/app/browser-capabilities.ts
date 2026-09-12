export type BrowserCapability =
  | "Web Workers"
  | "streaming files"
  | "typed arrays"
  | "BigInt"
  | "canvas"
  | "pointer or touch input";

export function missingBrowserCapabilities(): BrowserCapability[] {
  const missing: BrowserCapability[] = [];
  if (typeof Worker === "undefined") missing.push("Web Workers");
  if (typeof Blob === "undefined" || typeof Blob.prototype.stream !== "function")
    missing.push("streaming files");
  if (typeof Float64Array === "undefined") missing.push("typed arrays");
  if (typeof BigInt === "undefined") missing.push("BigInt");
  const canvas = typeof document === "undefined" ? null : document.createElement("canvas");
  if (!canvas?.getContext) missing.push("canvas");
  if (typeof window === "undefined" || (!("PointerEvent" in window) && !("ontouchstart" in window)))
    missing.push("pointer or touch input");
  return missing;
}

export interface StorageCapabilities {
  readonly indexedDbAvailable: boolean;
  readonly persistence: "granted" | "denied" | "unsupported";
  readonly usageBytes?: number;
  readonly quotaBytes?: number;
  readonly evictionRisk: "low" | "unknown" | "unsupported";
}

export async function detectStorageCapabilities(): Promise<StorageCapabilities> {
  let indexedDbAvailable = false;
  try {
    indexedDbAvailable = typeof indexedDB !== "undefined";
  } catch {
    indexedDbAvailable = false;
  }
  const estimate =
    typeof navigator === "undefined" || typeof navigator.storage?.estimate !== "function"
      ? undefined
      : await navigator.storage.estimate().catch(() => undefined);
  if (typeof navigator === "undefined" || typeof navigator.storage?.persist !== "function") {
    return {
      indexedDbAvailable,
      persistence: "unsupported",
      usageBytes: estimate?.usage,
      quotaBytes: estimate?.quota,
      evictionRisk: "unsupported",
    };
  }
  try {
    const persistence = (await navigator.storage.persist()) ? "granted" : "denied";
    return {
      indexedDbAvailable,
      persistence,
      usageBytes: estimate?.usage,
      quotaBytes: estimate?.quota,
      evictionRisk: persistence === "granted" ? "low" : "unknown",
    };
  } catch {
    return {
      indexedDbAvailable,
      persistence: "denied",
      usageBytes: estimate?.usage,
      quotaBytes: estimate?.quota,
      evictionRisk: "unknown",
    };
  }
}
