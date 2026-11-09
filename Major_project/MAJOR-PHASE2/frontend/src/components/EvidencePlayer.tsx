// EvidencePlayer.tsx
// Plays one accident evidence file. The media is fetched with the signed-in
// session (it is personal data, so it is never exposed as a public URL), which
// means a plain <video src="http://..."> cannot be used - the bytes have to be
// pulled through the authenticated client first and then handed to the browser
// as an object URL.
//
// Loading is on purpose: a review queue can list forty clips, and nobody should
// download hundreds of megabytes to read the list.
import { useEffect, useState } from "react";
import { useAuth } from "../context/useAuth";

interface Props {
  eventId: string;
  index: number;
  fileName: string;
  contentType?: string;
  fileSize?: number;
  isVideo?: boolean;
}

const humanSize = (bytes?: number) => {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function EvidencePlayer({
  eventId,
  index,
  fileName,
  contentType,
  fileSize,
  isVideo,
}: Props) {
  const { api } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Release the bytes as soon as this row goes away or is reloaded
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.get(
        `/vehicle-intelligence/accident-uploads/${eventId}/media/${index}`,
        { responseType: "blob" },
      );
      // A JSON body arriving where media was expected means the server refused
      // (or the file has gone), and the refusal text is what the officer needs.
      if ((res.data as Blob).type?.includes("application/json")) {
        const text = await (res.data as Blob).text();
        let message = "Could not retrieve this file.";
        try {
          message = JSON.parse(text).message || message;
        } catch {
          /* keep the fallback */
        }
        throw new Error(message);
      }
      setUrl(URL.createObjectURL(res.data as Blob));
    } catch (err: unknown) {
      setError(
        (err as { message?: string })?.message ||
          "Could not retrieve this file.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span className="intel-chip">
          {isVideo ? "Video" : "Photo"} · {fileName}
          {fileSize ? ` · ${humanSize(fileSize)}` : ""}
        </span>
        {!url && (
          <button
            className="btn btn-outline-primary btn-sm"
            onClick={load}
            disabled={busy}
          >
            {busy ? "Loading…" : isVideo ? "Play clip" : "View image"}
          </button>
        )}
        {url && (
          <a
            className="btn btn-secondary btn-sm"
            href={url}
            download={fileName}
          >
            Download
          </a>
        )}
      </div>
      {error && (
        <p
          style={{
            color: "var(--color-danger)",
            fontSize: "0.8rem",
            margin: "4px 0 0",
          }}
        >
          {error}
        </p>
      )}
      {url &&
        (isVideo || (contentType || "").startsWith("video/") ? (
          // The backend serves byte ranges, so seeking inside a long clip works
          <video
            src={url}
            controls
            style={{
              width: "100%",
              maxWidth: 520,
              marginTop: 8,
              borderRadius: 8,
              background: "#000",
            }}
          />
        ) : (
          <img
            src={url}
            alt={fileName}
            style={{
              maxWidth: "100%",
              maxHeight: 320,
              marginTop: 8,
              borderRadius: 8,
            }}
          />
        ))}
    </div>
  );
}
