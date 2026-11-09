import { createContext } from "react";
import type { RTODetails } from "../types/api";

export interface DealerDetails {
  businessName: string;
  gstin: string;
  tin: string;
  licenseNumber: string;
  showroomAddress: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  phone: string;
}

export interface WorkshopDetails {
  companyName: string;
  affiliatedManufacturer: string; // Vehicle company, e.g. "Maruti Suzuki"
  gstin?: string;
  licenseNumber?: string;
  address?: string;
  phone?: string;
  verified?: boolean;
}

export interface User {
  id: string;
  email: string;
  role: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  state?: string | null; // User's state code (KA, TN, etc.)
  district?: string | null; // User's district
  aadhaarNumber?: string | null;
  dlNumber?: string | null;
  badgeNumber?: string | null; // For police
  hasProfilePhoto?: boolean;
  profilePhoto?: {
    data?: ArrayBuffer | null;
    contentType?: string;
  };
  dealerDetails?: DealerDetails;
  rtoDetails?: RTODetails;
  workshopDetails?: WorkshopDetails;
}

import type { AxiosInstance } from "axios";

export interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  // Merge freshly stored account facts into the signed-in user, so a page that
  // just saved profile or dealer details can show them without reloading.
  refreshUser: (changes: Partial<User>) => void;
  loading: boolean;
  api: AxiosInstance;
}

export const AuthContext = createContext<AuthContextType | undefined>(
  undefined,
);
