# BioChain RTO - Frontend

React 19 + TypeScript + Vite. Single-page app with one entry per role: citizen
(owner), dealer, workshop, police officer and RTO officer.

## Run

```bash
npm install
npm run dev        # http://localhost:5173, API expected at http://localhost:5000
```

`VITE_API_URL` in `.env` points the app at a different API origin. Copy
`.env.example` to `.env` first.

```bash
npm run lint       # ESLint, flat config
npm run build      # type-check with tsc -b, then production bundle into dist/
npm run preview    # serve the built bundle
```

## Structure

- `src/App.tsx` - the whole route table; every protected path goes through a role
  gate that redirects an unauthorised visitor to login.
- `src/pages/` - one screen per route: the five dashboards, vehicle history (with
  service / parts / damage / battery tabs), documents, digital RC card, challan
  invoice, public vehicle search, analytics, investigations, transfer approvals,
  profiles and the RTO jurisdiction setup page.
- `src/components/` - biometric capture and dual-verification modals, notification
  bell, "View Transaction" button, RC certificate, invoice templates, document
  preview and expiry alerts.
- `src/services/api.ts` - the single axios instance: it attaches the JWT, refreshes
  nothing silently, and turns an API error into a message the user can read.
- `src/services/blockchain.ts` - the one canonical Polygon Amoy explorer URL
  builder, so no page invents its own link.
- `src/services/socketService.ts` - Socket.IO connection for live notifications and
  theft alerts.
- `src/context/` - auth state (token, profile, role) shared by the route guards and
  the header.

## Rules the UI follows

- A blockchain link is rendered only when a real transaction hash exists. Anything
  else shows its actual anchor status (`On-chain tx pending`,
  `Anchoring failed (DB hash intact)`) rather than a dead link.
- Nothing is presented as verified until the backend has verified it: document
  buttons appear only for documents that have a stored copy.
- Biometric capture is a simulation unless the backend is wired to a scanner SDK;
  the modal says so and the demo path never claims hardware was used.
