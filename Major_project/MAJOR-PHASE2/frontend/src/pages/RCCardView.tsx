import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import RCCertificate from "../components/RCCertificate";

// The certificate prints recorded facts only. Every value below comes from the
// vehicle document or the owner account; where the registry holds nothing, the
// certificate says so instead of showing a plausible sample.
type VehicleDocument = {
  type?: string;
  name?: string;
  expiryDate?: string;
  ipfsHash?: string;
  verificationStatus?: string;
};

type RcVehicle = {
  _id: string;
  regNumber?: string;
  make: string;
  model: string;
  year?: number;
  status?: string;
  chassisNumber?: string;
  engineNumber?: string;
  currentOwner?:
    | string
    | {
        _id?: string;
        name?: string;
        email?: string;
        address?: string;
        aadhaarNumber?: string;
      };
  blockchainTxHash?: string;
  ipfsRecordHash?: string;
  registrationDate?: string;
  issuedByOffice?: string;
  issuedByOfficer?: string;
  ipfsDocuments?: { rcCertificate?: string; insurance?: string; puc?: string };
  documents?: VehicleDocument[];
  ownershipHistory?: { transferReason?: string }[];
};

type RcOwner = {
  name?: string;
  email?: string;
  address?: string;
  aadhaarNumber?: string;
};

export default function RCCardView() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const { api } = useAuth();
  const [vehicle, setVehicle] = useState<RcVehicle | null>(null);
  const [owner, setOwner] = useState<RcOwner | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadRCData = async () => {
      if (!vehicleId) {
        setError("No vehicle ID provided");
        setLoading(false);
        return;
      }

      try {
        const vehicleRes = await api.get(`/vehicles/${vehicleId}`);
        const data = vehicleRes.data as RcVehicle;
        setVehicle(data);

        // The owner may arrive populated or as a bare id, depending on the endpoint.
        const holder = data.currentOwner;
        if (holder && typeof holder === "object" && holder._id) {
          setOwner(holder);
        } else if (typeof holder === "string") {
          try {
            const ownerRes = await api.get(`/auth/users/${holder}`);
            setOwner(ownerRes.data as RcOwner);
          } catch {
            // Without the account the certificate still prints; the owner line
            // simply reports that no holder is named on the record.
            setOwner(null);
          }
        } else {
          setOwner(null);
        }
      } catch (err) {
        let errorMsg = "Unknown error";
        if (typeof err === "object" && err !== null && "response" in err) {
          const axiosError = err as {
            response?: { data?: { message?: string } };
          };
          errorMsg = axiosError.response?.data?.message || "Request failed";
        } else if (err instanceof Error) {
          errorMsg = err.message;
        }
        setError(`Failed to load RC card: ${errorMsg}`);
      } finally {
        setLoading(false);
      }
    };

    loadRCData();
  }, [vehicleId, api]);

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <h2>Loading RC Card...</h2>
        <p>Please wait while we fetch your registration certificate</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <h2 style={{ color: "var(--color-danger)" }}>Error Loading RC Card</h2>
        <p>{error}</p>
        <button
          onClick={() => navigate(-1)}
          style={{
            marginTop: "20px",
            padding: "10px 20px",
            background: "#1e5aa8",
            color: "white",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
          }}
        >
          Go Back
        </button>
      </div>
    );
  }

  // Which certificate to print follows the ownership record, not a guess.
  const history = vehicle?.ownershipHistory || [];
  const lastReason = history[history.length - 1]?.transferReason;
  const transferType: "new" | "second-hand" | "inheritance" =
    lastReason === "inheritance"
      ? "inheritance"
      : history.length > 0
        ? "second-hand"
        : "new";

  // Insurance and PUC validity come from the uploaded documents, if any.
  const expiryOf = (type: string) =>
    vehicle?.documents?.find((d) => d.type === type && d.expiryDate)
      ?.expiryDate;

  return (
    <div
      style={{
        padding: "20px",
        maxWidth: "1000px",
        margin: "20px auto",
      }}
    >
      {/* The certificate is a print target, so navigation lives above it and
          stays out of the printed sheet. */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
        className="no-print"
      >
        <button
          className="btn btn-secondary"
          onClick={() =>
            // Officers and dealers open this card too, so the return point is
            // wherever the reader came from, never a hard-coded dashboard.
            window.history.length > 1 ? navigate(-1) : navigate("/")
          }
        >
          &larr; Back
        </button>
        <span style={{ color: "var(--color-text-muted)", fontSize: "0.85rem" }}>
          Registration certificate &mdash; use the certificate's own Download /
          Print controls to keep a copy
        </span>
      </div>
      <RCCertificate
        vehicle={{
          regNumber: vehicle?.regNumber || "Not yet registered",
          chassisNumber: vehicle?.chassisNumber,
          engineNumber: vehicle?.engineNumber,
          make: vehicle?.make || "Not recorded",
          model: vehicle?.model || "Not recorded",
          year: vehicle?.year,
          status: vehicle?.status,
        }}
        owner={{
          name: owner?.name || "No holder named on this record",
          address: owner?.address,
          aadhaarNumber: owner?.aadhaarNumber,
        }}
        registrationDate={vehicle?.registrationDate}
        rtoOffice={vehicle?.issuedByOffice}
        issuedByOfficer={vehicle?.issuedByOfficer}
        blockchainTxHash={vehicle?.blockchainTxHash}
        insuranceValidUpto={expiryOf("insurance")}
        pucValidUpto={expiryOf("puc")}
        ipfsHash={
          vehicle?.ipfsDocuments?.rcCertificate ||
          vehicle?.ipfsRecordHash ||
          vehicle?.documents?.find((d) => d.type === "rc" && d.ipfsHash)
            ?.ipfsHash
        }
        transferType={transferType}
      />
    </div>
  );
}
