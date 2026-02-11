import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import RecoveryScreen from './recovery/RecoveryScreen'
import { isRecoveryUrl } from './recovery/recoveryRouting'
import { kvStorage } from './storage/kvStorage'
import {
  BOOT_ATTEMPTS_KEY,
  FORCE_RECOVERY_PROMPT_KEY,
  LAST_BOOT_OK_TS_KEY,
  LAST_BOOT_TS_KEY,
} from './storage/recoveryKeys'
import { MIGRATION_STATE_KEY } from './storage/storageWriteLock'

const root = createRoot(document.getElementById('root')!);
const CRASH_WINDOW_MS = 2 * 60 * 1000;

async function bootstrapApp(): Promise<boolean> {
  const [{ default: process }, { Buffer }] = await Promise.all([
    import('process'),
    import('buffer'),
  ]);

  // Provide minimal Node polyfills for browser-only dependencies (bc-ur -> bitcoinjs-lib).
  if (!(globalThis as any).process) {
    (globalThis as any).process = process;
  }
  if (!(globalThis as any).Buffer) {
    (globalThis as any).Buffer = Buffer;
  }
  if (!(globalThis as any).global) {
    (globalThis as any).global = globalThis;
  }

  await import('./storage/localStorageGuardrails');
  const [{ initializeStorageBoundaries }, { resumeMigrationSafely }] = await Promise.all([
    import('./storage/storageBootstrap'),
    import('./recovery/recoveryMigration'),
  ]);

  try {
    await initializeStorageBoundaries();
  } catch {
    // ignore; app can still run with in-memory fallbacks
  }

  const recoveryNeeded = await resumeMigrationSafely();
  if (recoveryNeeded) {
    root.render(<RecoveryScreen />);
    return false;
  }

  const [
    { default: App },
    { CashuProvider },
    { NwcProvider },
    { ToastProvider },
    { P2PKProvider },
  ] = await Promise.all([
    import('./App.tsx'),
    import('./context/CashuContext'),
    import('./context/NwcContext.tsx'),
    import('./context/ToastContext.tsx'),
    import('./context/P2PKContext.tsx'),
  ]);

  root.render(
    <StrictMode>
      <ToastProvider>
        <NwcProvider>
          <P2PKProvider>
            <CashuProvider>
              <App />
            </CashuProvider>
          </P2PKProvider>
        </NwcProvider>
      </ToastProvider>
    </StrictMode>,
  );

  setupServiceWorkers();
  return true;
}

const manualRecovery = isRecoveryUrl();
if (manualRecovery) {
  root.render(<RecoveryScreen />);
} else {
  const now = Date.now();
  const bootAttempts = kvStorage.getNumber(BOOT_ATTEMPTS_KEY, 0);
  const lastBootTs = kvStorage.getNumber(LAST_BOOT_TS_KEY, 0);
  kvStorage.getNumber(LAST_BOOT_OK_TS_KEY, 0);
  kvStorage.getItem(MIGRATION_STATE_KEY);

  const forceRecoveryPrompt = kvStorage.getBoolean(FORCE_RECOVERY_PROMPT_KEY, false);
  const withinWindow = lastBootTs > 0 && now - lastBootTs <= CRASH_WINDOW_MS;
  let nextAttempts = withinWindow ? bootAttempts : 0;
  nextAttempts += 1;
  kvStorage.setNumber(BOOT_ATTEMPTS_KEY, nextAttempts);
  kvStorage.setNumber(LAST_BOOT_TS_KEY, now);

  const crashLoopDetected = withinWindow && nextAttempts >= 3;
  if (crashLoopDetected) {
    kvStorage.setBoolean(FORCE_RECOVERY_PROMPT_KEY, true);
  }

  const shouldShowRecovery = forceRecoveryPrompt || crashLoopDetected;
  if (shouldShowRecovery) {
    root.render(<RecoveryScreen />);
  } else {
    void bootstrapApp().catch(() => undefined);
  }
}

async function cleanupDevServiceWorkers() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister()));
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('taskify-cache-')).map((k) => caches.delete(k)));
    }
  } catch (err) {
    console.warn('Failed to clean dev service workers', err);
  }
}

function setupServiceWorkers() {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.PROD) {
    const emitUpdateAvailable = () => {
      window.dispatchEvent(new CustomEvent('taskify:update-available'));
    };

    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data;
      if (data && typeof data === 'object' && data.type === 'UPDATE_AVAILABLE') {
        emitUpdateAvailable();
      }
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          if (registration.waiting) {
            emitUpdateAvailable();
          }
        })
        .catch((err) => {
          console.warn('Service worker registration failed', err);
        });
    });
  } else {
    // Avoid SW caching during Vite dev which can break module reloads.
    cleanupDevServiceWorkers();
  }
}
