// Reusable "View Transaction" button.
// Opens the exact transaction on the Polygon Amoy explorer (same behavior the
// registration/transfer flows have always had) — now available for EVERY
// transaction in the project, including the new intelligence features.
// When no real on-chain transaction exists yet it shows an honest status
// badge instead of a fake link.
import { txUrl, isTxHash } from "../services/blockchain";

type Props = {
  /** On-chain transaction hash (real tx). If present, the button renders. */
  txHash?: string | null;
  /** Anchor status from the backend: anchored | pending | failed | hashed_only */
  status?: string | null;
  label?: string;
  className?: string;
};

export default function ViewTransactionButton({
  txHash,
  status,
  label = "View Transaction",
  className = "btn btn-success",
}: Props) {
  if (isTxHash(txHash)) {
    return (
      <a
        href={txUrl(txHash)!}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        title="Opens this transaction on the Polygon Amoy explorer"
      >
        {label}
      </a>
    );
  }
  if (status === "pending" || status === "hashed_only") {
    return (
      <span
        className="text-muted"
        style={{ fontSize: "12px" }}
        title="Record hash is stored in the database; the on-chain anchoring transaction has not landed yet"
      >
        On-chain tx pending
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        className="text-warning"
        style={{ fontSize: "12px" }}
        title="On-chain anchoring failed; the database hash still protects this record"
      >
        Anchoring failed (DB hash intact)
      </span>
    );
  }
  return null;
}
