import { useState, useCallback } from "react";

// Pairs with <ConfirmDialog />. Call requestConfirm(message, onConfirm)
// wherever a native confirm() prompt used to gate a destructive action, then
// spread confirmProps onto a single <ConfirmDialog /> rendered once per page.
export function useConfirm() {
  const [state, setState] = useState(null); // { message, onConfirm } | null

  const requestConfirm = useCallback((message, onConfirm) => {
    setState({ message, onConfirm });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!state) return;
    await state.onConfirm();
    setState(null);
  }, [state]);

  const handleCancel = useCallback(() => setState(null), []);

  return {
    confirmProps: { open: !!state, message: state?.message, onConfirm: handleConfirm, onCancel: handleCancel },
    requestConfirm,
  };
}
