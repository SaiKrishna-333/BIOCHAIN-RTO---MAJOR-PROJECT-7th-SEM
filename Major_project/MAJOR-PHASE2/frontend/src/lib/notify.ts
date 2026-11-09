// notify.ts - one non-blocking replacement for the browser's alert().
//
// alert() stops the page, steals focus and shows an unstyled system dialog,
// which is not acceptable on a registry console: an officer's screen must keep
// working, and a message must look like it belongs to this application. It is
// also actively harmful here, because several screens alert() and then navigate
// away - the dialog is dismissed together with the page it belonged to.
//
// Usage:
//   import { notify } from "../lib/notify";
//   notify("Challan cleared.");             // neutral information
//   notify("Payment recorded.", "success"); // an action that completed
//   notify(err.message, "error");           // something the user must read
//
// The visible stack is rendered by <NotifyHost />, mounted once at the
// application root, so any page can notify() without threading props or a
// provider through the tree.

export type NotifyKind = "info" | "success" | "error";

export type Notice = {
  id: number;
  message: string;
  kind: NotifyKind;
};

let queue: Notice[] = [];
const listeners = new Set<(notices: Notice[]) => void>();
let nextId = 1;

const emit = () => listeners.forEach((l) => l([...queue]));

export const dismissNotice = (id: number) => {
  queue = queue.filter((n) => n.id !== id);
  emit();
};

export const subscribeNotices = (
  listener: (notices: Notice[]) => void,
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const notify = (message: string, kind: NotifyKind = "info"): void => {
  const notice: Notice = { id: nextId++, message: String(message), kind };
  // Newest last, so the newest action reads as the bottom of the stack.
  queue = [...queue, notice];
  emit();
  // A problem stays on screen longer than a routine confirmation.
  const ttl = kind === "error" ? 9000 : 4500;
  setTimeout(() => {
    if (queue.some((n) => n.id === notice.id)) dismissNotice(notice.id);
  }, ttl);
};

export const TONE: Record<
  NotifyKind,
  { border: string; bar: string; label: string }
> = {
  info: { border: "#1e5aa8", bar: "#1e5aa8", label: "Registry" },
  success: { border: "#15803d", bar: "#15803d", label: "Completed" },
  error: { border: "#b91c1c", bar: "#b91c1c", label: "Attention" },
};
