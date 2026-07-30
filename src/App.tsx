import { useEffect, useState } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { getDb } from "./db/database";
import Navbar from "./components/Navbar";
import Dashboard from "./pages/Dashboard";
import NuevaVenta from "./pages/NuevaVenta";
import HistorialVentas from "./pages/HistorialVentas";
import Clientes from "./pages/Clientes";
import Reportes from "./pages/Reportes";
import Ajustes from "./pages/Ajustes";
import { UpdateDialog } from "./components/UpdateDialog";
import { ConfiguracionProvider } from "./context/ConfiguracionContext";
import styles from "./App.module.css";
import "./styles/theme.css";

function App() {
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    getDb()
      .then(() => console.log("✅ Base de datos conectada y migraciones aplicadas"))
      .catch((err) => {
        console.error("❌ Error conectando a la base de datos:", err);
        setDbError("No se pudo conectar a la base de datos local.");
      });
  }, []);

  // El proveedor hace de puerta: si es la primera vez que se abre la app,
  // muestra el asistente en lugar del contenido. El router queda dentro para
  // que el asistente no tenga URL propia ni barra lateral.
  return (
    <ConfiguracionProvider>
      <HashRouter>
        <UpdateDialog />
        <div className={styles.shell}>
          <Navbar />
          <main className={styles.content}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/nueva-venta" element={<NuevaVenta />} />
              <Route path="/historial" element={<HistorialVentas />} />
              <Route path="/clientes" element={<Clientes />} />
              <Route path="/reportes" element={<Reportes />} />
              <Route path="/ajustes" element={<Ajustes />} />
            </Routes>
          </main>
        </div>
        {dbError && <div className={`${styles.dbStatus} ${styles.dbStatusError}`}>{dbError}</div>}
      </HashRouter>
    </ConfiguracionProvider>
  );
}

export default App;