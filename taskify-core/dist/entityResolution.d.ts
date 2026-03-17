export type IdentifierLookup = {
    id: string;
};
export declare function resolveIdentifierReference<T extends IdentifierLookup>(entries: T[], ref: string): T | null;
export declare function readTagValue(tags: string[][], tagName: string): string | undefined;
export declare function readStatusTag(tags: string[][], fallback: string): string;
