// feePolicy.js
// What the app is willing to pay to put a hash on Polygon Amoy, and what it
// refuses to attempt at all.
//
// The network enforces a minimum priority fee (the node answers "gas tip cap 5
// 00000000, minimum needed 25000000000"), so pricing a commit from the chain's
// tiny base fee alone gets it rejected. This module therefore takes the fee the
// network itself suggests, and - crucially - checks the wallet can actually pay
// for the transaction BEFORE broadcasting. An unaffordable commitment is
// reported honestly instead of being retried three times against a node that
// will never accept it, which is what filled the logs with "Attempt 1/3 failed"
// warnings.
//
// ANCHOR_MAX_FEE_PER_GWEI can raise or lower the ceiling once the wallet is topped up.

const GWEI = 10n ** 9n;

// Remembered for the life of the process: the node's fee suggestion does not
// change block to block in any way that matters here.
let cachedCaps = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

const ceiling = () => {
    const configured = Number(process.env.ANCHOR_MAX_FEE_PER_GWEI);
    return Number.isFinite(configured) && configured > 0 ? BigInt(configured) * GWEI : 100n * GWEI;
};

/**
 * Fee caps the node should accept: its own suggested tip, clamped by the ceiling.
 * @param {import("ethers").JsonRpcProvider | { provider?: any }} providerish
 */
export const resolveFeeCaps = async (provider) => {
    const now = Date.now();
    if (cachedCaps && now - cachedAt < CACHE_MS) return cachedCaps;

    const node = provider?.provider || provider;
    let tip = 25n * GWEI; // the Amoy minimum the node reports when asked for less
    let baseFee = 0n;
    try {
        const feeData = await node.getFeeData();
        const suggested = feeData?.maxPriorityFeePerGas ?? feeData?.gasPrice;
        if (suggested && suggested > 0n) tip = suggested;
    } catch { /* keep the known-good floor */ }
    try {
        const block = await node.send("eth_getBlockByNumber", ["latest", false]);
        baseFee = BigInt(block?.baseFeePerGas || "0");
    } catch { /* no block: maxFee falls back to the tip alone */ }

    const cap = ceiling();
    const maxFeePerGas = baseFee + tip * 2n;
    cachedCaps = {
        maxFeePerGas: maxFeePerGas < cap ? maxFeePerGas : cap,
        maxPriorityFeePerGas: tip < cap ? tip : cap,
    };
    cachedAt = now;
    return cachedCaps;
};

/**
 * Gas ceiling for a request, with margin, or null when the node cannot estimate.
 */
export const estimateLimit = async (signer, txRequest) => {
    try {
        const est = await signer.estimateGas(txRequest);
        return (est * 13n) / 10n;
    } catch {
        return null;
    }
};

/**
 * Returns null when the wallet can cover the worst-case fee, and a precise,
 * human-readable reason when it cannot - so callers can record an honest note
 * instead of broadcasting something the network will drop.
 */
export const affordabilityGap = async (signer, gasLimit, maxFeePerGas) => {
    // ethers v6 wallets expose the provider, not a balance helper of their own.
    const balance = await signer.provider.getBalance(await signer.getAddress());
    const worstCase = gasLimit * maxFeePerGas;
    if (worstCase <= balance) return null;
    return `the anchoring wallet holds ${formatPol(balance)} and this commitment would cost about ${formatPol(worstCase)} at the fee the network requires. Top the wallet up from the Polygon Amoy faucet (0.05 POL covers roughly 60 record commits) to put hashes on-chain.`;
};

// Display-only conversion; these amounts never need BigInt precision.
const formatPol = (wei) => `${(Number(wei) / 1e18).toFixed(6)} POL`;
