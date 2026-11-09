// The states this console can move a registration between.
//
// The server keeps the same eleven entries in
// `backend/src/services/crossStateInteroperability.js`, so a state that appears
// in a dropdown is a state the inter-state workflow actually supports - offering
// more would invite a transfer that no destination office could approve.
export interface StateOption {
  code: string;
  name: string;
}

export const STATES: StateOption[] = [
  { code: "AP", name: "Andhra Pradesh" },
  { code: "TS", name: "Telangana" },
  { code: "KA", name: "Karnataka" },
  { code: "TN", name: "Tamil Nadu" },
  { code: "MH", name: "Maharashtra" },
  { code: "DL", name: "Delhi" },
  { code: "GJ", name: "Gujarat" },
  { code: "RJ", name: "Rajasthan" },
  { code: "UP", name: "Uttar Pradesh" },
  { code: "MP", name: "Madhya Pradesh" },
  { code: "KL", name: "Kerala" },
];

export const stateName = (code?: string | null): string =>
  STATES.find((s) => s.code === code)?.name || "";

// Accounts were created before one storage rule was chosen, so a profile may
// hold the code ("KA") or the full name ("Karnataka"). A dropdown and a printed
// certificate both need the code, so every read of the field resolves it first.
export const resolveStateCode = (value?: string | null): string => {
  const raw = (value || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (STATES.some((s) => s.code === upper)) return upper;
  const byName = STATES.find(
    (s) => s.name.toUpperCase() === upper || upper.startsWith(s.name.toUpperCase()),
  );
  return byName?.code || raw;
};
