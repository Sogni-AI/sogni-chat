/**
 * Simple pub/sub controller for SogniTV so that chat components
 * can open/close the TV player without prop drilling.
 */

type Listener = () => void;

let isOpen = false;
let autoCloseOnComplete = false;
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
    notify();
  },

  /** Called when a tool completes — only closes if opened with autoClose */
  notifyToolComplete() {
    if (autoCloseOnComplete && isOpen) {
      isOpen = false;
      autoCloseOnComplete = false;
      notify();
    }
  },

  getState() {
    return { isOpen, autoCloseOnComplete };
  },

  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};
