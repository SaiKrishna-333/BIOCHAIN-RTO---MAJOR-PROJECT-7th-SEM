// Shared blockchain-explorer helpers.
// Every transaction in this project lives on Polygon Amoy; the ONE canonical
// explorer URL builder lives here so no page hardcodes its own link.

export const EXPLORER_BASE = "https://amoy.polygonscan.com";

/** Explorer URL for a transaction hash, or null when there is no real tx yet. */
export const txUrl = (hash?: string | null): string | null =>
    hash ? `${EXPLORER_BASE}/tx/${hash}` : null;

/** Explorer URL for an address / contract, or null. */
export const addressUrl = (address?: string | null): string | null =>
    address ? `${EXPLORER_BASE}/address/${address}` : null;

/** True when the hash looks like an Ethereum transaction hash. */
export const isTxHash = (value?: string | null): boolean =>
    /^0x[0-9a-fA-F]{64}$/.test(value || "");
