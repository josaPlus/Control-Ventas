import { type ReactNode, useEffect, useRef, useState } from "react";
import { IconAlert } from "./Icons";
import styles from "./ConfirmDialog.module.css";

interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "peligro" pinta el botón en rojo: úsalo para eliminaciones. */
  tono?: "peligro" | "normal";
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tono = "normal",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // El foco arranca en "Cancelar": si el usuario llegó aquí por error, la
  // tecla más a la mano no debe ser la destructiva.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !trabajando) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, trabajando]);

  async function confirmar() {
    setError(null);
    setTrabajando(true);
    try {
      await onConfirm();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      setTrabajando(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.panel} role="alertdialog" aria-modal="true" aria-label={title}>
        <div className={styles.head}>
          <span className={`${styles.icon} ${tono === "peligro" ? styles.iconPeligro : ""}`}>
            <IconAlert />
          </span>
          <div>
            <h2 className={styles.title}>{title}</h2>
            <div className={styles.message}>{message}</div>
          </div>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.actions}>
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={trabajando}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${tono === "peligro" ? styles.btnPeligro : "btn-primary"}`}
            onClick={confirmar}
            disabled={trabajando}
          >
            {trabajando ? "Procesando..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
