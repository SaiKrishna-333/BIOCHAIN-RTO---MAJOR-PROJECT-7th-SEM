// One formatting rule for the whole console.
//
// Before this file, the same screen could show 9/19/2026, 10/25/2026,
// 10/25/2026, 11:38:26 PM and 28 Oct 2026 side by side, because each component
// called the browser default - which is the visitor's locale, not India's. A
// registration certificate is a day-month-year document, so that ordering is now
// declared once here and every page reads it from here.
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DAY_MONTH_YEAR_TIME = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// Anything the server sent that is not a readable date renders as the em dash the
// rest of the console already uses for "no value", never as "Invalid Date".
const asDate = (value?: string | number | Date | null): Date | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDate = (
  value?: string | number | Date | null,
  fallback = "\u2014",
): string => {
  const date = asDate(value);
  return date ? DAY_MONTH_YEAR.format(date) : fallback;
};

export const formatDateTime = (
  value?: string | number | Date | null,
  fallback = "\u2014",
): string => {
  const date = asDate(value);
  return date ? DAY_MONTH_YEAR_TIME.format(date) : fallback;
};

// Rupee amounts are grouped the Indian way (5,00,000), which is what an
// inspector reads on a challan or invoice.
export const formatMoney = (value?: number | string | null): string => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-IN") : "0";
};

// Stored enumerations are machine words ("newRegistration", "under_investigation").
// Nobody should see them raw in a government console.
export const enumLabel = (value?: string | null): string => {
  if (!value) return "\u2014";
  const spaced = value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export const ROLE_LABEL: Record<string, string> = {
  owner: "Vehicle Owner",
  dealer: "Authorised Dealer",
  rto: "RTO Officer",
  police: "Police Officer",
  workshop: "Authorised Workshop",
  admin: "System Administrator",
};

export const roleLabel = (role?: string | null): string =>
  (role && ROLE_LABEL[role]) || enumLabel(role);

// Aadhaar and driving-licence numbers are masked wherever they are displayed for
// reading rather than for editing; the profile forms keep the full value in a
// field the account holder owns.
export const maskNumber = (value?: string | null): string => {
  const digits = (value || "").replace(/\s/g, "");
  if (digits.length < 5) return value || "\u2014";
  const tail = digits.slice(-4);
  return `${"X".repeat(digits.length - 4)} ${tail}`;
};

// The server masks an identity number as "XXXX XXXX 4321" before it sends it.
// Anything the console still has to mask itself uses this same shape, so one
// number never looks different on two screens.
export const maskAadhaar = (value?: string | null): string => {
  const raw = (value || "").trim();
  if (!raw) return "\u2014";
  // A number the server already masked is printed exactly as it arrived.
  if (/x/i.test(raw)) return raw.toUpperCase();
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 12) return "XXXX XXXX XXXX";
  return `XXXX XXXX ${digits.slice(8)}`;
};

export const pluralise = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? "" : "s"}`;
