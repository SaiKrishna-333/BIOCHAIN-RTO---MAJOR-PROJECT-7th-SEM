// ui-tokens.ts
// Design tokens + status→colour mapping shared by the BioChain design system.
// Kept out of ui.tsx so that file exports only React components (fast-refresh
// rule) while these constants remain importable anywhere.
export const BIO = {
  blue: "#1e5aa8",
  ink: "#2c3e50",
  slate: "#5b6b7b",
  line: "#e4e9f0",
  bg: "#f6f8fc",
  green: "#1f9d55",
  amber: "#d98314",
  red: "#c0392b",
  violet: "#6b46c1",
  white: "#ffffff",
};

const STATUS_TONE: Record<string, string> = {
  // generic lifecycle words the backend uses across all four modules
  completed: BIO.green,
  approved: BIO.green,
  verified: BIO.green,
  passed: BIO.green,
  active: BIO.green,
  resolved: BIO.green,
  closed: BIO.green,
  paid: BIO.green,
  in_progress: BIO.blue,
  pending: BIO.amber,
  under_review: BIO.amber,
  needs_review: BIO.amber,
  review: BIO.amber,
  warning: BIO.amber,
  partial: BIO.amber,
  awaiting: BIO.amber,
  submitted: BIO.violet,
  blocked: BIO.red,
  rejected: BIO.red,
  failed: BIO.red,
  expired: BIO.red,
  overdue: BIO.red,
  unreadable: BIO.red,
  missing: BIO.slate,
  locked: BIO.slate,
  critical: BIO.red,
  high: BIO.red,
  medium: BIO.amber,
  low: BIO.green,
};

export const toneForStatus = (status?: string | null): string => {
  if (!status) return BIO.slate;
  const key = String(status).toLowerCase().trim();
  if (STATUS_TONE[key]) return STATUS_TONE[key];
  // "awaiting_source_rto", "noc_pending", etc. - match on a trailing keyword.
  for (const [k, v] of Object.entries(STATUS_TONE)) {
    if (key.includes(k)) return v;
  }
  return BIO.slate;
};
