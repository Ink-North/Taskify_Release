// boardTag must be synchronous — it is called inside React useMemo without await.
// taskify-core's boardTagHash is async (WebCrypto), so we use the synchronous
// noble/hashes implementation from taskify-runtime-nostr instead.
export { boardTagHash as boardTag } from "taskify-runtime-nostr";
export { encryptToBoard, decryptFromBoard } from "taskify-core";
