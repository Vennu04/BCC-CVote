// Shared destructive-action confirmation — replaces native confirm() so the
// prompt looks like the rest of the app and behaves consistently on mobile
// (native confirm() dialogs render inconsistently across mobile browsers and
// block the JS thread).
export default function ConfirmDialog({ open, title = "Are you sure?", message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = true, onConfirm, onCancel }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 safe-top safe-bottom"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div className="card max-w-sm w-full shadow-soft-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-5">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="btn-secondary text-sm py-2.5 px-4">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={danger ? "btn-danger text-sm py-2.5 px-4" : "btn-primary text-sm py-2.5 px-4"}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
