import type { SharedTaskPayload } from "../lib/shareInbox";

export type WalletMessageSender = {
  name?: string | null;
  npub?: string | null;
  pubkey?: string | null;
  relays?: string[];
  lud16?: string | null;
};

export type WalletMessageContact = {
  npub?: string | null;
  name?: string | null;
  displayName?: string | null;
  username?: string | null;
  address?: string | null;
  nip05?: string | null;
  picture?: string | null;
};

export type WalletMessageItem = {
  id: string;
  title: string;
  note?: string | null;
  completed?: boolean;
  dmEventId?: string | null;
  type?: "board" | "contact" | "task";
  status?: "pending" | "accepted" | "deleted" | "read";
  boardId?: string | null;
  boardName?: string | null;
  contact?: WalletMessageContact | null;
  task?: SharedTaskPayload | null;
  sender?: WalletMessageSender | null;
  receivedAt?: string | null;
};
