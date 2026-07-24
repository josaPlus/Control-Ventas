import { NavLink } from "react-router-dom";
import styles from "./Navbar.module.css";

const links = [
  { to: "/dashboard", label: "Panel", icon: IconChart },
  { to: "/nueva-venta", label: "Nueva Venta", icon: IconPlus },
  { to: "/historial", label: "Historial de Ventas", icon: IconList },
  { to: "/clientes", label: "Clientes", icon: IconUsers },
];

export default function Navbar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.brandIcon} aria-hidden="true">
          <IconCarrete />
        </span>
        <div className={styles.brandText}>
          <span className={styles.brandTitle}>Control de Ventas</span>
          <span className={styles.brandSubtitle}>Piñas de hilo</span>
        </div>
      </div>

      <nav className={styles.nav}>
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              isActive ? `${styles.link} ${styles.linkActive}` : styles.link
            }
          >
            <Icon className={styles.icon} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className={styles.spacer} />
      <div className={styles.footer}>Uso local · sin conexión</div>
    </aside>
  );
}

/* Piña (cono) de hilo: base ancha, punta angosta y las vueltas del hilo */
function IconCarrete() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.5 17 19H7L12 2.5Z" />
      <path d="M9.4 11h5.2" />
      <path d="M8.6 14h6.8" />
      <ellipse cx="12" cy="19.5" rx="5" ry="1.8" />
    </svg>
  );
}

function IconChart({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-4" />
    </svg>
  );
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  );
}

function IconList({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  );
}

function IconUsers({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
