export type Toast = {
  id: number;
  message: string;
};

type ToasterProps = {
  toasts: Toast[];
  onDismiss: (id: number) => void;
};

// Pure presentational toast stack pinned to the bottom-right corner.
export function Toaster({ toasts, onDismiss }: ToasterProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className="toast"
          title="Click to dismiss"
          onClick={() => onDismiss(toast.id)}
        >
          <span className="toast-icon" aria-hidden="true">
            ℹ️
          </span>
          <span>{toast.message}</span>
          <span className="toast-close" aria-hidden="true">
            ✕
          </span>
        </button>
      ))}
    </div>
  );
}
