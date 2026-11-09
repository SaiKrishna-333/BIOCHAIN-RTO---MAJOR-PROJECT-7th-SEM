// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract VehicleRegistry {

    enum VehicleStatus { Active, Stolen, Scrapped }
    
    // Admin address (deployer) - can approve transfers for testing
    address public admin;

    struct TransferEvent {
        address from;
        address to;
        uint256 timestamp;
        string reason;
        bytes32 biometricHash;
    }

    struct Vehicle {
        string regNumber;
        string chassisNumber;
        string engineNumber;
        string make;
        string model;
        uint256 year;
        address currentOwner;
        address[] previousOwners;
        TransferEvent[] ownershipHistory;
        bool exists;
        uint256 createdAt;
        uint256 updatedAt;
        VehicleStatus status;
    }

    mapping(string => Vehicle) private vehicles;
    mapping(address => string[]) private ownerVehicles;

    event VehicleRegistered(string indexed regNumber, address indexed owner);
    event OwnershipTransferred(string indexed regNumber, address indexed from, address indexed to, string reason);
    event VehicleStatusChanged(string indexed regNumber, VehicleStatus status);
    
    constructor() {
        admin = msg.sender;
    }

    // Register new vehicle
    function registerNewVehicle(
        string memory regNumber,
        string memory chassisNumber,
        string memory engineNumber,
        string memory make,
        string memory model,
        uint256 year,
        address owner
    ) public {

        require(!vehicles[regNumber].exists, "Vehicle already registered");
        require(owner != address(0), "Invalid owner");
        require(year > 1900, "Invalid vehicle year");

        Vehicle storage vehicle = vehicles[regNumber];

        vehicle.regNumber = regNumber;
        vehicle.chassisNumber = chassisNumber;
        vehicle.engineNumber = engineNumber;
        vehicle.make = make;
        vehicle.model = model;
        vehicle.year = year;
        vehicle.currentOwner = owner;
        vehicle.exists = true;
        vehicle.createdAt = block.timestamp;
        vehicle.updatedAt = block.timestamp;
        vehicle.status = VehicleStatus.Active;

        ownerVehicles[owner].push(regNumber);

        emit VehicleRegistered(regNumber, owner);
    }

    // Transfer ownership
    function transferOwnership(
        string memory regNumber,
        address to,
        string memory reason,
        bytes32 biometricHash
    ) public {

        Vehicle storage vehicle = vehicles[regNumber];

        require(vehicle.exists, "Vehicle not registered");
        require(msg.sender == vehicle.currentOwner || msg.sender == admin, "Only owner or admin can transfer");
        require(to != address(0), "Invalid new owner");
        require(vehicle.status == VehicleStatus.Active, "Vehicle transfer blocked");

        address from = vehicle.currentOwner;

        vehicle.ownershipHistory.push(
            TransferEvent({
                from: from,
                to: to,
                timestamp: block.timestamp,
                reason: reason,
                biometricHash: biometricHash
            })
        );

        vehicle.previousOwners.push(from);

        vehicle.currentOwner = to;
        vehicle.updatedAt = block.timestamp;

        removeVehicleFromOwner(regNumber, from);
        ownerVehicles[to].push(regNumber);

        emit OwnershipTransferred(regNumber, from, to, reason);
    }

    // Get current owner
    function getCurrentOwner(string memory regNumber) public view returns (address) {

        require(vehicles[regNumber].exists, "Vehicle not registered");

        return vehicles[regNumber].currentOwner;
    }

    // Get vehicle info
    function getVehicleInfo(string memory regNumber)
        public
        view
        returns (
            string memory chassisNumber,
            string memory engineNumber,
            string memory make,
            string memory model,
            uint256 year,
            address currentOwner,
            VehicleStatus status,
            uint256 createdAt,
            uint256 updatedAt
        )
    {
        require(vehicles[regNumber].exists, "Vehicle not registered");

        Vehicle storage v = vehicles[regNumber];

        return (
            v.chassisNumber,
            v.engineNumber,
            v.make,
            v.model,
            v.year,
            v.currentOwner,
            v.status,
            v.createdAt,
            v.updatedAt
        );
    }

    // Get ownership history
    function getOwnershipHistory(string memory regNumber)
        public
        view
        returns (TransferEvent[] memory)
    {
        require(vehicles[regNumber].exists, "Vehicle not registered");

        return vehicles[regNumber].ownershipHistory;
    }

    // Get vehicles owned by address
    function getVehiclesByOwner(address owner)
        public
        view
        returns (string[] memory)
    {
        return ownerVehicles[owner];
    }

    // Update vehicle status
    function updateVehicleStatus(
        string memory regNumber,
        VehicleStatus newStatus
    ) public {

        Vehicle storage vehicle = vehicles[regNumber];

        require(vehicle.exists, "Vehicle not registered");
        require(msg.sender == vehicle.currentOwner, "Not authorized");

        vehicle.status = newStatus;
        vehicle.updatedAt = block.timestamp;

        emit VehicleStatusChanged(regNumber, newStatus);
    }

    // Remove vehicle from owner list
    function removeVehicleFromOwner(
        string memory regNumber,
        address owner
    ) private {

        string[] storage userVehicles = ownerVehicles[owner];

        for (uint256 i = 0; i < userVehicles.length; i++) {

            if (
                keccak256(bytes(userVehicles[i])) ==
                keccak256(bytes(regNumber))
            ) {
                userVehicles[i] = userVehicles[userVehicles.length - 1];
                userVehicles.pop();
                break;
            }
        }
    }
}
