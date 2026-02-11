import { resumeMigrationIfNeeded } from "../storage/storageMigration";
import { resetMigrationMarkers, isForceRecoveryPrompt, setForceRecoveryPrompt } from "./recoveryState";
import { replaceUrlForRecovery } from "./recoveryRouting";

export async function resumeMigrationSafely(options?: { onRecovery?: () => void }): Promise<boolean> {
  if (isForceRecoveryPrompt()) return true;
  try {
    await resumeMigrationIfNeeded();
    return false;
  } catch {
    resetMigrationMarkers();
    setForceRecoveryPrompt(true);
    replaceUrlForRecovery();
    try {
      options?.onRecovery?.();
    } catch {
      // ignore handler errors
    }
    return true;
  }
}
