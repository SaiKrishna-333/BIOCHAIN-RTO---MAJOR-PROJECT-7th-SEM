// vehicleLifecycleService.js
// PATENT FEATURE #4: Vehicle Lifecycle State Machine
// Controls entire lifecycle using predefined states and rules

import { Vehicle } from "../models/Vehicle.js";
import { updateVehicleStatusOnChain } from "../services/blockchainService.js";

/**
 * Vehicle lifecycle states and valid transitions
 */
export const VEHICLE_LIFECYCLE = {
    states: {
        REGISTERED: "registered",
        ACTIVE: "active",
        TRANSFER_PENDING: "transfer_pending",
        STOLEN: "stolen",
        BLOCKED: "blocked",
        UNDER_INVESTIGATION: "under_investigation",
        SCRAPPED: "scrapped"
    },

    transitions: {
        registered: {
            valid: ["active"],
            operations: ["view"]
        },
        active: {
            valid: ["transfer_pending", "stolen", "blocked", "scrapped"],
            operations: ["view", "transfer", "update_documents"]
        },
        transfer_pending: {
            valid: ["active"],
            operations: ["view"],
            blockedOperations: ["transfer", "scrap"]
        },
        stolen: {
            valid: ["active", "under_investigation"],
            operations: ["view"],
            blockedOperations: ["transfer", "update_documents", "scrap"]
        },
        blocked: {
            valid: ["active"],
            operations: ["view"],
            blockedOperations: ["transfer", "update_documents", "scrap"]
        },
        under_investigation: {
            valid: ["active", "stolen"],
            operations: ["view"],
            blockedOperations: ["transfer", "update_documents", "scrap"]
        },
        scrapped: {
            valid: [],
            operations: ["view"],
            blockedOperations: ["transfer", "update_documents"]
        }
    }
};

/**
 * State machine for vehicle operations
 */
export class VehicleStateMachine {
    constructor(vehicle) {
        this.vehicle = vehicle;
        this.currentState = vehicle.status || "registered";
    }

    /**
     * Check if operation is allowed in current state
     */
    canPerform(operation) {
        const stateConfig = VEHICLE_LIFECYCLE.transitions[this.currentState];

        if (!stateConfig) {
            return { allowed: false, reason: "Invalid state" };
        }

        // Check if operation is explicitly blocked
        if (stateConfig.blockedOperations?.includes(operation)) {
            return {
                allowed: false,
                reason: `Operation '${operation}' is blocked in '${this.currentState}' state`
            };
        }

        // Check if operation is allowed
        if (stateConfig.operations.includes(operation)) {
            return { allowed: true, reason: "Operation permitted" };
        }

        return { allowed: false, reason: `Operation '${operation}' not allowed in '${this.currentState}' state` };
    }

    /**
     * Check if transition to new state is valid
     */
    canTransitionTo(newState) {
        const stateConfig = VEHICLE_LIFECYCLE.transitions[this.currentState];

        if (!stateConfig) {
            return { allowed: false, reason: "Invalid current state" };
        }

        if (stateConfig.valid.includes(newState)) {
            return { allowed: true, reason: "Transition permitted" };
        }

        return {
            allowed: false,
            reason: `Cannot transition from '${this.currentState}' to '${newState}'`
        };
    }

    /**
     * Transition vehicle to new state
     */
    async transition(newState, options = {}) {
        const { reason, authorizedBy, blockchainUpdate = true } = options;

        // Check if transition is allowed
        const transitionCheck = this.canTransitionTo(newState);
        if (!transitionCheck.allowed) {
            return {
                success: false,
                error: transitionCheck.reason
            };
        }

        try {
            const oldState = this.currentState;

            // Update vehicle state
            this.vehicle.status = newState;
            this.vehicle.lastStateChange = new Date();
            this.vehicle.stateChangeHistory = this.vehicle.stateChangeHistory || [];
            this.vehicle.stateChangeHistory.push({
                from: oldState,
                to: newState,
                reason: reason || "System transition",
                authorizedBy: authorizedBy || "system",
                timestamp: new Date()
            });

            // Update blockchain if required
            let blockchainTxHash = null;
            if (blockchainUpdate && this.vehicle.regNumber) {
                try {
                    blockchainTxHash = await updateVehicleStatusOnChain(
                        this.vehicle.regNumber,
                        this.stateToBlockchainEnum(newState)
                    );
                } catch (blockchainErr) {
                    console.warn("Blockchain state update failed:", blockchainErr.message);
                    // Don't fail the operation if blockchain update fails
                }
            }

            await this.vehicle.save();

            return {
                success: true,
                oldState,
                newState,
                blockchainTxHash,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error("Error transitioning state:", error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Convert state to blockchain enum
     */
    stateToBlockchainEnum(state) {
        const mapping = {
            "active": 0,
            "stolen": 1,
            "scrapped": 2,
            "blocked": 1, // Treat blocked as stolen for blockchain
            "registered": 0,
            "transfer_pending": 0,
            "under_investigation": 1
        };
        return mapping[state] ?? 0;
    }

    /**
     * Get current state information
     */
    getStateInfo() {
        return {
            currentState: this.currentState,
            canTransition: VEHICLE_LIFECYCLE.transitions[this.currentState]?.valid || [],
            allowedOperations: VEHICLE_LIFECYCLE.transitions[this.currentState]?.operations || [],
            blockedOperations: VEHICLE_LIFECYCLE.transitions[this.currentState]?.blockedOperations || []
        };
    }
}

/**
 * Create state machine for a vehicle
 */
export const createVehicleStateMachine = async (vehicleId) => {
    try {
        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) {
            return { error: "Vehicle not found" };
        }

        return new VehicleStateMachine(vehicle);
    } catch (error) {
        console.error("Error creating state machine:", error.message);
        return { error: error.message };
    }
};

/**
 * Transition vehicle state with validation
 */
export const transitionVehicleState = async (vehicleId, newState, options = {}) => {
    const machine = await createVehicleStateMachine(vehicleId);

    if (machine.error) {
        return machine;
    }

    return await machine.transition(newState, options);
};

/**
 * Get vehicle state and allowed operations
 */
export const getVehicleStateInfo = async (vehicleId) => {
    const machine = await createVehicleStateMachine(vehicleId);

    if (machine.error) {
        return machine;
    }

    return machine.getStateInfo();
};

/**
 * Check if vehicle can be transferred
 */
export const canTransferVehicle = async (vehicleId) => {
    const machine = await createVehicleStateMachine(vehicleId);

    if (machine.error) {
        return { canTransfer: false, reason: machine.error };
    }

    const result = machine.canPerform("transfer");
    return {
        canTransfer: result.allowed,
        reason: result.reason,
        currentState: machine.currentState
    };
};

/**
 * Auto-freeze vehicle (for theft or suspicious activity)
 */
export const autoFreezeVehicle = async (vehicleId, reason, authorizedBy) => {
    return await transitionVehicleState(vehicleId, "blocked", {
        reason: `Auto-freeze: ${reason}`,
        authorizedBy
    });
};

/**
 * Report vehicle as stolen
 */
export const reportVehicleStolen = async (vehicleId, reason, authorizedBy) => {
    return await transitionVehicleState(vehicleId, "stolen", {
        reason: `Theft report: ${reason}`,
        authorizedBy
    });
};

/**
 * Recover stolen vehicle
 */
export const recoverStolenVehicle = async (vehicleId, reason, authorizedBy) => {
    return await transitionVehicleState(vehicleId, "active", {
        reason: `Vehicle recovered: ${reason}`,
        authorizedBy
    });
};

export default {
    VehicleStateMachine,
    createVehicleStateMachine,
    transitionVehicleState,
    getVehicleStateInfo,
    canTransferVehicle,
    autoFreezeVehicle,
    reportVehicleStolen,
    recoverStolenVehicle,
    VEHICLE_LIFECYCLE
};
