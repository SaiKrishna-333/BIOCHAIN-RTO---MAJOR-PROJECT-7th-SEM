/* ========= COMMON ========= */
export type VehicleStatus = "active" | "blocked";
export type RequestStatus = "approved" | "rejected" | "pending";

/* ========= PERSON ========= */
export interface Person {
  name: string;
  email: string;
  aadhaarNumber: string;
  dlNumber: string;
  role: string;
  verificationStatus: string;
}

/* ========= RTO DETAILS ========= */
export interface RTODetails {
  stateCode: string;
  stateName: string;
  district: string;
  rtoOfficeCode: string;
  rtoOfficeName: string;
  designation: string;
  employeeId: string;
  officeAddress: string;
  jurisdiction: string;
}

/* ========= VEHICLE ========= */
export interface Vehicle {
  _id: string;
  regNumber: string;
  make: string;
  model: string;
  year: string;
  status: VehicleStatus;
  chassisNumber?: string;
  engineNumber?: string;
  currentOwner?: string;
  blockchainTxHash?: string;
  ipfsRecordHash?: string;
}

/* ========= OWNERSHIP ========= */
export interface OwnershipRecord {
  from: string;
  to: string;
  transferType: string;
  date: string;
  blockchainTxHash?: string;
}

/* ========= THEFT ========= */
export interface TheftReport {
  status: string;
  policeStation: string;
  firNumber: string;
  incidentDate: string;
}

/* ========= QUICK VERIFY ========= */
export interface QuickVerifyResult {
  regNumber: string;
  make: string;
  model: string;
  year: string;
  status: VehicleStatus;
  isStolen: boolean;
  currentOwner?: Person;
}

/* ========= DETAILED VEHICLE ========= */
export interface DetailedVehicleResult extends QuickVerifyResult {
  chassisNumber: string;
  engineNumber: string;
  theftReport?: TheftReport;
  ownershipHistory: OwnershipRecord[];
  blockchainOwner?: string;
  blockchainTxHash?: string;
}

/* ========= PERSON VERIFY ========= */
export interface PersonVerifyResult {
  person: Person;
  vehicles: Vehicle[];
  ownershipHistories: {
    regNumber: string;
    history: OwnershipRecord[];
  }[];
}

/* ========= REQUEST ========= */
export interface TransferRequest {
  _id: string;
  type: string;
  vehicle?: Vehicle;
  dealer?: Person;
  seller?: Person;
  buyer?: Person;
  status: "pending" | "approved" | "rejected";
  remarks?: string;
  createdAt?: string;
  updatedAt?: string;
  // Resale offer between owners - buyer must accept before RTO finalization
  offer?: {
    salePrice?: number;
    message?: string;
    attachIntel?: boolean;
    buyerAccepted?: boolean;
    buyerAcceptedAt?: string;
    declinedAt?: string;
    declineReason?: string;
  };
}

/* ========= INHERITANCE TRANSFER ========= */
export interface InheritanceRequest {
  _id: string;
  vehicle?: Vehicle;
  deceasedOwner?: Person;
  legalHeir?: Person;
  deathCertificateNumber: string;
  relationshipToDeceased: string;
  successionCertificateNumber?: string;
  courtOrderNumber?: string;
  documents: {
    documentType: string;
    // null on claims filed before documents were stored, so the officer UI can
    // say "no stored copy" instead of offering a button that cannot work.
    documentUrl: string | null;
    verified: boolean;
  }[];
  status:
    | "submitted"
    | "documents_verified"
    | "rto_review"
    | "approved"
    | "rejected";
  remarks?: string;
  createdAt?: string;
  updatedAt?: string;
}

/* ========= THEFT REPORT ADMIN ========= */
export interface TheftReportAdmin {
  _id: string;
  vehicle?: Vehicle;
  reporter?: Person;
  policeStation: string;
  firNumber: string;
  incidentDate: string;
  incidentLocation: string;
  description: string;
  status: "reported" | "under_investigation" | "recovered" | "closed";
  recoveryDate?: string;
  recoveryLocation?: string;
  remarks?: string;
  createdAt?: string;
  updatedAt?: string;
}

/* ========= INTER-STATE TRANSFER ========= */
export interface InterStateTransferRequest {
  _id: string;
  type: string;
  vehicle?: Vehicle;
  seller?: Person;
  status: string;
  interStateDetails?: {
    currentState: string;
    targetState: string;
    newAddress: string;
    currentRegNumber: string;
    newRegNumber: string;
    sourceRTOApproval: {
      status: string;
      officerName: string;
      rtoOffice: string;
      timestamp: string;
      remarks: string;
    };
    destinationRTOApproval: {
      status: string;
      officerName: string;
      rtoOffice: string;
      timestamp: string;
      remarks: string;
    };
    transferInitiatedAt: string;
  };
  createdAt?: string;
  updatedAt?: string;
}