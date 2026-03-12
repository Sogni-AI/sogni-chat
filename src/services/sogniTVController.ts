/**
 * Simple pub/sub controller for SogniTV so that chat components
 * can open/close the TV player without prop drilling.
 *
 * Also carries tool-execution progress so the TV player can show
 * a countdown / percentage overlay while the user watches.
 */

type Listener = () => void;

export interface TVProgress {
  /** 0-1 normalised progress */
  progress: number;
  /** Seconds remaining (may be undefined if SDK doesn't provide it) */
  etaSeconds?: number;
  /** Which tool is running */
  toolName?: string;
  /** Optional human-readable step label */
  stepLabel?: string;
}

let isOpen = false;
let autoCloseOnComplete = false;
let currentProgress: TVProgress | null = null;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((fn) => fn());
}

export const sogniTVController = {
  open(autoClose = false) {
    isOpen = true;
    autoCloseOnComplete = autoClose;
    notify();
  },

  close() {
    isOpen = false;
    autoCloseOnComplete = false;
    currentProgress = null;
    notify();
  },

  /** Push latest progress from tool execution */
  updateProgress(p: TVProgress) {
    currentProgress = p;
    notify();
  },

  /** Clear progress (e.g. when tool finishes or is cancelled) */
  clearProgress() {
    currentProgress = null;
    notify();
  },

  /** Called when a tool completes — only closes if opened with autoClose */
  notifyToolComplete() {
    currentProgress = null;
    if (autoCloseOnComplete && isOpen) {
      isOpen = false;
      autoCloseOnComplete = false;
      notify();
    } else {
      notify();
    }
  },

  getState() {
    return { isOpen, autoCloseOnComplete, progress: currentProgress };
  },

  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};
