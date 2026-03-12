import type { NostrEvent } from "nostr-tools";

export class EventCache {
  private seenIds = new Set<string>();
  private maxSize: number;

  constructor(maxSize = 2048) {
    this.maxSize = Math.max(256, maxSize);
  }

  has(event: { id?: string } | null | undefined): boolean {
    if (!event || typeof event.id !== "string") return false;
    return this.seenIds.has(event.id);
  }

  add(event: NostrEvent): void {
    if (!event?.id) return;
    this.seenIds.add(event.id);
    if (this.seenIds.size > this.maxSize) {
      const [first] = this.seenIds;
      if (first) this.seenIds.delete(first);
    }
  }
}
