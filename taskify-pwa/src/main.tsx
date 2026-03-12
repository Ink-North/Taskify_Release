import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const root = createRoot(document.getElementById('root')!);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

async function bootstrapApp(): Promise<void> {
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
  const [{ initializeStorageBoundaries }] = await Promise.all([
    import('./storage/storageBootstrap'),
  ]);

  const storagePromise = initializeStorageBoundaries();
  let storageTimedOut = false;
  try {
    // Guard against occasional startup hangs in storage bootstrap.
    await withTimeout(storagePromise, 1500);
  } catch (err) {
    console.warn('Storage bootstrap fallback (continuing with in-memory behavior)', err);
    storageTimedOut = true;
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

  // If IDB timed out but eventually succeeds, reload once so components pick up
  // the real data instead of showing empty state for the entire session.
  if (storageTimedOut) {
    storagePromise
      .then(() => {
        const RELOAD_KEY = 'taskify_storage_late_reload';
        try {
          const last = Number(sessionStorage.getItem(RELOAD_KEY) || '0');
          if (Date.now() - last > 10_000) {
            sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
            window.location.reload();
          }
        } catch {}
      })
      .catch(() => {});
  }
}
void bootstrapApp().catch((err) => {
  console.error('Taskify bootstrap failed', err);
});

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
