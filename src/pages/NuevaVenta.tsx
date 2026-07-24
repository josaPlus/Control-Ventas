import NotaVentaForm from "../components/NotaVentaForm";
import styles from "./NuevaVenta.module.css";

export default function NuevaVenta() {
  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Nueva venta</h1>
      <p className={styles.pageSubtitle}>Registra una nota de venta de piñas de hilo para un cliente.</p>
      <NotaVentaForm />
    </div>
  );
}
