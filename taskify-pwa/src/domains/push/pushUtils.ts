export type PushPlatform = "ios" | "android";

export type PushPreferences = {
  enabled: boolean;
  platform: PushPlatform;
  deviceId?: string;
  subscriptionId?: string;
  permission?: NotificationPermission;
};

const RAW_WORKER_BASE = (import.meta as any)?.env?.VITE_WORKER_BASE_URL || "";
export const FALLBACK_WORKER_BASE_URL = RAW_WORKER_BASE ? String(RAW_WORKER_BASE).replace(/\/$/, "") : "";
export const FALLBACK_VAPID_PUBLIC_KEY = (import.meta as any)?.env?.VITE_VAPID_PUBLIC_KEY || "";
export const PUSH_OPERATION_TIMEOUT_MS = 15000;

export function detectPushPlatformFromNavigator(): PushPlatform {
  if (typeof navigator === 'undefined') return 'ios';
  const ua = typeof navigator.userAgent === 'string' ? navigator.userAgent.toLowerCase() : '';
  const vendor = typeof navigator.vendor === 'string' ? navigator.vendor.toLowerCase() : '';
  const platform = typeof navigator.platform === 'string' ? navigator.platform.toLowerCase() : '';
  const isIosDevice = /\b(iphone|ipad|ipod)\b/.test(ua);
  const isStandalonePwa = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches;
  const isSafariBrowser = /safari/.test(ua)
    && !/chrome|crios|fxios|edge|edg\//.test(ua)
    && !/android/.test(ua);
  const isAppleWebkit = vendor.includes('apple');
  if (isIosDevice || (isSafariBrowser && (platform.startsWith('mac') || isAppleWebkit)) || (isAppleWebkit && isStandalonePwa)) {
    return 'ios';
  }
  return 'android';
}

export const INFERRED_PUSH_PLATFORM: PushPlatform = detectPushPlatformFromNavigator();

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  if (!base64String || typeof base64String !== 'string') {
    throw new Error('VAPID public key is missing.');
  }
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const decode = typeof atob === 'function'
    ? atob
    : (() => { throw new Error('No base64 decoder available in this environment'); });
  try {
    const rawData = decode(base64);
    if (!rawData) throw new Error('Decoded key was empty');
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i += 1) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    if (outputArray.length < 32) {
      throw new Error('Decoded key is too short');
    }
    return outputArray;
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Invalid VAPID public key: ${err.message}`);
    }
    throw new Error('Invalid VAPID public key.');
  }
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
