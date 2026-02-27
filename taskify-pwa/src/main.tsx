import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const root = createRoot(document.getElementById('root')!);

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

  try {
    await initializeStorageBoundaries();
  } catch {
    // ignore; app can still run with in-memory fallbacks
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
}
void bootstrapApp().catch(() => undefined);

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
