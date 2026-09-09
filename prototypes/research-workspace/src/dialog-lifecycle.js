// Retain the trigger across StrictMode effect replay. Never focus behind a reopened modal.
export function openDialogWithReturn(dialog, trigger, schedule = requestAnimationFrame) {
  dialog.showModal();
  return () => {
    dialog.close();
    schedule(() => {
      if (
        !dialog.open &&
        trigger?.isConnected &&
        !trigger.ownerDocument?.querySelector('dialog[open]')
      ) {
        trigger.focus({ preventScroll: true });
      }
    });
  };
}
