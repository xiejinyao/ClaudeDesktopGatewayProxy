import type { ToastItem } from "../types";

interface ToastContainerProps {
  toasts: ToastItem[];
}

const colorMap: Record<ToastItem["type"], string> = {
  success: "border-emerald-700 bg-emerald-900/80 text-emerald-300",
  error: "border-red-700 bg-red-900/80 text-red-300",
  info: "border-brand-700 bg-brand-900/80 text-brand-300",
};

export default function ToastContainer({ toasts }: ToastContainerProps) {
  return (
    <div className="fixed top-16 right-4 z-50 space-y-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto px-4 py-2.5 rounded-lg border text-sm shadow-xl animate-slide-in ${colorMap[toast.type]}`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
