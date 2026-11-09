// Reusable "Upload your government ID to OCR auto-fills the form" widget.
// Sits above the manual sign-up form: the document image is OCR-read on our
// own server (tesseract.js) and the mined fields are handed to the parent to
// populate the form. Manual typing always remains available - OCR is an
// accelerator, never a requirement.
import { useState } from "react";
import axios from "axios";

export type OcrFields = {
  name?: string;
  aadhaarNumber?: string;
  dlNumber?: string;
  phone?: string;
  address?: string;
  state?: string;
  district?: string;
  dob?: string;
  gender?: string;
  pincode?: string;
  stateName?: string;
  guardianName?: string;
};

type Props = {
  onExtract: (fields: OcrFields, documentType: string) => void;
};

const DOC_LABELS: Record<string, string> = {
  aadhaar: "Aadhaar Card",
  "driving-licence": "Driving Licence",
  "voter-id": "Voter ID",
  pan: "PAN Card",
  "id-document": "ID Document",
  unknown: "Document",
};

export default function OcrDocumentUpload({ onExtract }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [found, setFound] = useState(0);

  const handleExtract = async () => {
    if (!file) return;
    setBusy(true);
    setResult("");
    try {
      const fd = new FormData();
      fd.append("document", file);
      const { data } = await axios.post(
        "http://localhost:5000/api/ocr/extract",
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      const fieldCount = Object.keys(data.fields || {}).length;
      setFound(fieldCount);
      if (fieldCount) {
        onExtract(data.fields as OcrFields, data.documentType);
        setResult(
          `${DOC_LABELS[data.documentType] || "Document"} read (confidence ${data.confidence}%): ${fieldCount} field(s) auto-filled. Please review them below.`,
        );
      } else {
        setResult(
          data.message || "Could not read fields - please type them manually.",
        );
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "OCR service unreachable - type the details manually.";
      setResult(`${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        border: "2px dashed #1e5aa8",
        borderRadius: "10px",
        padding: "14px",
        marginBottom: "18px",
        background: "rgba(30, 90, 168, 0.04)",
      }}
    >
      <label
        style={{
          fontWeight: 700,
          color: "#1e5aa8",
          display: "block",
          marginBottom: 6,
        }}
      >
        Upload Government ID (Aadhaar / Driving Licence) — OCR auto-fills the
        form
      </label>
      <div
        style={{
          display: "flex",
          gap: "10px",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setResult("");
            setFound(0);
          }}
          style={{ flex: 1, minWidth: 220 }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!file || busy}
          onClick={handleExtract}
        >
          {busy ? "Reading document…" : "Extract with OCR"}
        </button>
      </div>
      {result && (
        <p
          style={{
            marginTop: 10,
            marginBottom: 0,
            fontSize: "0.9rem",
            color: found ? "var(--color-success)" : "var(--color-warning)",
          }}
        >
          {found ? "" : ""}
          {result}
        </p>
      )}
      <small style={{ color: "#777", display: "block", marginTop: 6 }}>
        No document at hand? Simply type the details below — manual entry works
        exactly as before.
      </small>
    </div>
  );
}
