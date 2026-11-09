// blockchainService.js
// This file integrates with Polygon blockchain and VehicleRegistry.sol
import { ethers } from "ethers";
import { resolveFeeCaps, affordabilityGap } from "./feePolicy.js";

// Contract details - loaded from environment variables dynamically
const getContractAddress = () => process.env.CONTRACT_ADDRESS;

// ABI for the VehicleRegistry contract (updated for Polygon Amoy deployment)
const CONTRACT_ABI = [
    "function registerNewVehicle(string regNumber, string chassisNumber, string engineNumber, string make, string model, uint256 year, address owner) external",
    "function transferOwnership(string regNumber, address to, string memory reason, bytes32 biometricHash) external",
    "function getCurrentOwner(string regNumber) public view returns (address)",
    "function getVehicleInfo(string regNumber) public view returns (string memory, string memory, string memory, string memory, uint256, address, uint8, uint256, uint256)",
    "function getOwnershipHistory(string regNumber) public view returns (tuple(address from, address to, uint256 timestamp, string reason, bytes32 biometricHash)[])",
    "function getVehiclesByOwner(address owner) public view returns (string[] memory)",
    "function updateVehicleStatus(string regNumber, uint8 newStatus) external",
    "event VehicleRegistered(string indexed regNumber, address indexed owner)",
    "event OwnershipTransferred(string indexed regNumber, address indexed from, address indexed to, string reason)",
    "event VehicleStatusChanged(string indexed regNumber, uint8 status)"
];

let provider;
let signer;
let contract;

// Initialize the blockchain connection
const initializeBlockchain = async () => {
    try {
        // Try primary RPC URL first
        const primaryRpc = process.env.POLYGON_RPC_URL || "https://polygon-amoy-bor-rpc.publicnode.com";
        const backupRpc1 = process.env.POLYGON_RPC_BACKUP1 || "https://polygon-amoy.gateway.tenderly.co";
        const backupRpc2 = process.env.POLYGON_RPC_BACKUP2 || "https://rpc-amoy.polygon.technology";

        const rpcUrls = [primaryRpc, backupRpc1, backupRpc2];
        let lastError = null;
        let connectedRpc = null;

        for (const rpcUrl of rpcUrls) {
            try {
                provider = new ethers.JsonRpcProvider(rpcUrl);

                // Test the connection
                await provider.getNetwork();
                console.log(`Blockchain RPC connected: ${rpcUrl}`);
                connectedRpc = rpcUrl;
                break;
            } catch (rpcError) {
                lastError = rpcError;
                console.warn(`Blockchain RPC ${rpcUrl} failed: ${rpcError.message}`);
                continue;
            }
        }

        if (!provider) {
            throw new Error(`All RPC endpoints failed. Last error: ${lastError?.message}`);
        }

        // Use the private key from environment variables for signing transactions.
        // There is deliberately no fallback key: the well-known sample keys are
        // public, and signing with one would attach this system's records to an
        // address anyone else can also control.
        const privateKey = process.env.WALLET_PRIVATE_KEY;
        if (privateKey) {
            signer = new ethers.Wallet(privateKey, provider);
        } else {
            console.warn("No WALLET_PRIVATE_KEY configured: records will be hashed and marked pending anchoring instead of broadcast");
        }

        // Create contract instance only if CONTRACT_ADDRESS is set
        const contractAddress = getContractAddress();
        if (contractAddress && signer) {
            contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);
            console.log(`Blockchain service ready - contract ${contractAddress} on ${connectedRpc}`);
        } else if (contractAddress && !signer) {
            console.warn(`Blockchain service: contract ${contractAddress} loaded but no signing wallet, so anchoring is unavailable`);
        } else {
            console.warn("Blockchain service: CONTRACT_ADDRESS not configured, so on-chain anchoring is disabled");
        }
    } catch (error) {
        console.error("Failed to initialize blockchain service:", error.message);
        // Don't throw - allow app to continue without blockchain if needed
    }
};

// Initialize on module load (but don't crash if it fails)
// Delayed initialization to ensure dotenv is loaded first
setTimeout(() => {
    initializeBlockchain().catch(err => console.error("Blockchain init error:", err));
}, 100);

// Any state-changing call on this chain costs POL, and Amoy enforces a minimum
// priority fee. A wallet that cannot cover the worst-case fee gets every attempt
// dropped by the node - three times, with a warning each time - before the caller
// falls back to looking up the vehicle's real historical transaction. Asking the
// same question up front costs one balance read and answers it once.
//   { ok: true, caps }  - affordable; pass caps as fee overrides
//   { ok: false, note } - skip the broadcast, log the reason once
const writePreflight = async () => {
    if (!signer || !provider) return { ok: true, caps: null };
    try {
        const caps = await resolveFeeCaps(provider);
        // Generous ceiling: registration/transfer encode several strings, so the
        // real limit sits well below this and the check never blocks a payable call.
        const gap = await affordabilityGap(signer, 300000n, caps.maxFeePerGas);
        return gap ? { ok: false, note: gap, caps } : { ok: true, caps };
    } catch {
        return { ok: true, caps: null }; // node not answering about fees - let the call try
    }
};

// Look up the most recent REAL on-chain transaction recorded for a vehicle by
// scanning the contract's events. Replaces the previous "mock tx hash" generator,
// which fabricated hashes that opened dead explorer links - the exact thing the
// View Transaction button must never do. Returns null when nothing is found.
export const findVehicleBlockchainTx = async (regNumber) => {
    try {
        if (!contract) await initializeBlockchain();
        if (!contract || !provider) return null;
        const current = await provider.getBlockNumber();
        const CHUNK = 9000; // public nodes commonly reject larger eth_getLogs ranges
        const collect = async (from, to) => {
            const evs = [];
            evs.push(...await contract.queryFilter(contract.filters.VehicleRegistered(regNumber), from, to));
            evs.push(...await contract.queryFilter(contract.filters.OwnershipTransferred(regNumber), from, to));
            evs.push(...await contract.queryFilter(contract.filters.VehicleStatusChanged(regNumber), from, to));
            return evs;
        };
        // Walk back from the head in small windows until the vehicle's events appear
        for (let to = current; to > Math.max(0, current - CHUNK * 20); to -= CHUNK) {
            try {
                const events = await collect(Math.max(0, to - CHUNK), to);
                if (events.length) {
                    events.sort((a, b) => a.blockNumber - b.blockNumber);
                    return events[events.length - 1].transactionHash;
                }
            } catch {
                break; // node not usable for logs - give up honestly
            }
        }
        return null;
    } catch {
        return null;
    }
};

export const registerVehicleOnChain = async (regNumber, chassisNumber, engineNumber, make, model, year, ownerAddress) => {
    try {
        if (!contract) {
            await initializeBlockchain();
        }

        if (!contract) {
            console.warn("No blockchain contract available - this record stays 'pending' in the UI instead of claiming a transaction");
            return null;
        }

        // Announce the broadcast only once it is known to be payable, so the log never
        // reads "Anchoring ..." immediately before "Skipping ...".
        const preflight = await writePreflight();
        if (!preflight.ok) {
            console.warn(`Skipping on-chain registration of ${regNumber} - ${preflight.note}`);
            return await findVehicleBlockchainTx(regNumber);
        }

        console.log(`Anchoring vehicle registration on-chain: ${regNumber} (${make} ${model}, ${year}) for ${ownerAddress}`);
        const feeOverrides = preflight.caps || {};

        // Retry logic - attempt transaction up to 3 times
        let attempts = 0;
        const maxAttempts = 3;
        let lastError;
        let txHash = null;

        while (attempts < maxAttempts) {
            try {
                attempts++;

                // Call the registerNewVehicle function on the contract with all parameters
                const tx = await contract.registerNewVehicle(
                    regNumber,
                    chassisNumber,
                    engineNumber,
                    make,
                    model,
                    parseInt(year) || 2024,
                    ownerAddress,
                    feeOverrides
                );
                // Keep the hash the moment it is submitted: if the node then answers
                // with "already known", this is the real hash of the accepted tx.
                txHash = tx.hash;

                // Wait for the transaction to be mined
                const receipt = await tx.wait();

                console.log(`Vehicle ${regNumber} anchored on-chain: block ${receipt.blockNumber}, tx ${tx.hash}`);

                return tx.hash;
            } catch (attemptError) {
                lastError = attemptError;

                // Check if transaction actually succeeded despite error
                // "already known" means transaction is in mempool - it likely succeeded
                if (attemptError.message.includes('already known') ||
                    attemptError.message.includes('transaction replaced') ||
                    (attemptError.code === 'TRANSACTION_REPLACED')) {
                    if (txHash) return txHash;
                }

                // Check if vehicle already registered
                if (attemptError.message.includes('already registered')) {
                    console.log(`Vehicle ${regNumber} is already registered on-chain - looking up its real tx`);
                    return txHash || await findVehicleBlockchainTx(regNumber);
                }

                console.warn(`On-chain registration attempt ${attempts} failed: ${attemptError.message}`);

                // If it's a nonce error, reinitialize provider
                if (attemptError.message.includes('nonce') || attemptError.message.includes('replacement fee')) {
                    await initializeBlockchain();
                }

                // Wait before retry (exponential backoff)
                if (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, attempts * 1000));
                }
            }
        }

        // All attempts failed - report honestly instead of fabricating a hash
        console.warn(`No on-chain registration for ${regNumber} after ${maxAttempts} attempts: ${lastError?.message || "unknown"}`);
        return await findVehicleBlockchainTx(regNumber); // real tx if one ever landed

    } catch (error) {
        console.error("Error registering vehicle on chain:", error.message);
        // Honest result: real historical tx if any, otherwise null (UI hides the button)
        return await findVehicleBlockchainTx(regNumber);
    }
};

export const transferVehicleOnChain = async (regNumber, fromAddress, toAddress, reason = "purchase", biometricHash = "0x0000000000000000000000000000000000000000000000000000000000000000") => {
    try {
        if (!contract) {
            await initializeBlockchain();
        }

        if (!contract) {
            console.warn("No blockchain contract available - this transfer stays 'pending' in the UI instead of claiming a transaction");
            return null;
        }

        // The registry contract keys on the registration number. Called without one,
        // every attempt would be meaningless, so the caller is told plainly and the
        // record stays honestly unanchored.
        if (!regNumber) {
            console.warn("Transfer not anchored: this vehicle has no registration number yet, and the registry keys on it");
            return null;
        }

        const preflight = await writePreflight();
        if (!preflight.ok) {
            console.warn(`Skipping on-chain transfer of ${regNumber} - ${preflight.note}`);
            return null;
        }

        console.log(`Anchoring ownership transfer on-chain: ${regNumber} to ${toAddress} (${reason})`);
        const feeOverrides = preflight.caps || {};

        // Retry logic - attempt transaction up to 3 times
        let attempts = 0;
        const maxAttempts = 3;
        let lastError;

        while (attempts < maxAttempts) {
            try {
                attempts++;

                // Call the transferOwnership function on the contract
                // Note: fromAddress is not passed - contract uses msg.sender automatically
                const tx = await contract.transferOwnership(regNumber, toAddress, reason, biometricHash, feeOverrides);

                // Wait for the transaction to be mined
                const receipt = await tx.wait();

                console.log(`Vehicle ${regNumber} transferred on-chain: block ${receipt.blockNumber}, tx ${tx.hash}`);

                return tx.hash;
            } catch (attemptError) {
                lastError = attemptError;
                console.warn(`On-chain transfer attempt ${attempts} failed: ${attemptError.message}`);

                // Handle specific smart contract errors (no retry for these)
                if (attemptError.message.includes("Vehicle is stolen")) {
                    throw new Error("Vehicle is stolen - transfer blocked");
                }
                if (attemptError.message.includes("Vehicle is scrapped")) {
                    throw new Error("Vehicle is scrapped - transfer blocked");
                }
                // Not registered is definitive - no point retrying 3 times, and the
                // inheritance flow depends on catching this exact message.
                if (attemptError.message.includes("Vehicle not registered")) {
                    throw new Error("Vehicle not registered on blockchain");
                }

                // If it's a nonce error, reinitialize provider
                if (attemptError.message.includes('nonce') || attemptError.message.includes('replacement fee')) {
                    await initializeBlockchain();
                }

                // Wait before retry (exponential backoff)
                if (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, attempts * 1000));
                }
            }
        }

        // All attempts failed - report honestly instead of fabricating a hash
        console.warn(`No on-chain transfer for ${regNumber} after ${maxAttempts} attempts: ${lastError?.message || "unknown"}`);
        return null;

    } catch (error) {
        // Handle specific smart contract errors
        if (error.message.includes("Vehicle is stolen")) {
            console.error(`Blocked on-chain transfer of ${regNumber}: the vehicle is reported stolen`);
            throw new Error("Vehicle is stolen - transfer blocked");
        }
        if (error.message.includes("Vehicle is scrapped")) {
            console.error(`Blocked on-chain transfer of ${regNumber}: the vehicle is scrapped`);
            throw new Error("Vehicle is scrapped - transfer blocked");
        }
        if (error.message.includes("Vehicle not registered")) {
            throw error; // callers (inheritance) branch on this
        }
        console.error("Error transferring vehicle on chain:", error.message);
        return null; // honest failure - UI keeps/loads the real tx if one exists
    }
};

// Function to get current owner of a vehicle
export const getCurrentOwnerFromChain = async (regNumber) => {
    try {
        if (!contract) {
            await initializeBlockchain();
        }

        console.log(`Reading current on-chain owner of ${regNumber}`);

        // Call the getCurrentOwner function on the contract
        const owner = await contract.getCurrentOwner(regNumber);

        return owner;
    } catch (error) {
        console.error("Error getting current owner from chain:", error.message);
        throw error;
    }
};

// Function to update vehicle status on the blockchain
// Contract enum is VehicleStatus { Active=0, Stolen=1, Scrapped=2 } (uint8).
// Callers pass human-readable strings ("stolen", "active"), so map them here —
// passing the raw string made ethers throw INVALID_ARGUMENT before, silently
// breaking every on-chain status update.
const VEHICLE_STATUS_ENUM = { active: 0, stolen: 1, scrapped: 2, blocked: 1 };
export const updateVehicleStatusOnChain = async (regNumber, newStatus) => {
    try {
        if (!contract) {
            await initializeBlockchain();
        }

        const statusCode = typeof newStatus === "number" ? newStatus : VEHICLE_STATUS_ENUM[String(newStatus).toLowerCase()];
        if (statusCode === undefined) {
            throw new Error(`Unknown vehicle status for on-chain update: ${newStatus}`);
        }

        const preflight = await writePreflight();
        if (!preflight.ok) {
            // Same treatment as registration and transfer: the database record is
            // written and stays honestly "pending", the reason is stated once here,
            // and the caller receives null instead of an exception it would only log.
            console.warn(`Not updating the on-chain status of ${regNumber}: ${preflight.note}`);
            return null;
        }

        console.log(`Updating on-chain status of ${regNumber} to ${newStatus} (enum ${statusCode})`);

        // Call the updateVehicleStatus function on the contract
        const tx = await contract.updateVehicleStatus(regNumber, statusCode, preflight.caps || {});

        // Wait for the transaction to be mined
        const receipt = await tx.wait();

        console.log(`Vehicle ${regNumber} on-chain status is now ${newStatus}: ${tx.hash}`);

        return tx.hash;
    } catch (error) {
        console.error("Error updating vehicle status on chain:", error.message);
        throw error;
    }
};

export const registerVehicleTransferOnChain = async (regNumber, newRegNumber, ownerAddress, transferReason = "inter_state_transfer") => {
    try {
        if (!contract) {
            await initializeBlockchain();
        }

        if (!contract) {
            throw new Error("Blockchain contract not initialized. Check CONTRACT_ADDRESS in .env");
        }

        const preflight = await writePreflight();
        if (!preflight.ok) {
            console.warn(`Not recording the inter-state transfer of ${regNumber} on-chain: ${preflight.note}`);
            return null;
        }

        console.log(`Anchoring inter-state transfer on-chain: ${regNumber} to ${ownerAddress} (${transferReason})`);

        // The deployed Solidity contract does not support renaming regNumber on-chain.
        // It only tracks ownership transfer for the existing registration key.
        // We therefore record the transfer against the original registration number and keep
        // the destination regNumber as a local DB field for the inter-state workflow.
        if (newRegNumber && newRegNumber !== regNumber) {
            console.warn(`Smart contract cannot rename registration number on-chain. Keeping blockchain identity under ${regNumber} and using ${newRegNumber} only in the database.`);
        }

        const tx = await contract.transferOwnership(
            regNumber,
            ownerAddress,
            transferReason,
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            preflight.caps || {}
        );

        const receipt = await tx.wait();
        console.log(`Inter-state transfer anchored on-chain: block ${receipt.blockNumber}, tx ${tx.hash}`);
        return tx.hash;
    } catch (error) {
        console.error("Error registering inter-state transfer on chain:", error.message);
        throw error;
    }
};
