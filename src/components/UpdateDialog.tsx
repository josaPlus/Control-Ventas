import { useEffect, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import styles from './UpdateDialog.module.css';

export function UpdateDialog() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [estado, setEstado] = useState<'idle' | 'descargando' | 'error'>('idle');
  const [progreso, setProgreso] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    checkForUpdates();
  }, []);

  async function checkForUpdates() {
    try {
      const resultado = await check();
      if (resultado) {
        setUpdate(resultado);
        setVisible(true);
      }
    } catch (error) {
      console.error('Error buscando actualizaciones:', error);
    }
  }

  async function instalarActualizacion() {
    if (!update) return;

    setEstado('descargando');
    let descargado = 0;
    let total = 0;

    try {
      await update.downloadAndInstall((evento) => {
        switch (evento.event) {
          case 'Started':
            total = evento.data.contentLength ?? 0;
            break;
          case 'Progress':
            descargado += evento.data.chunkLength;
            if (total > 0) {
              setProgreso(Math.round((descargado / total) * 100));
            }
            break;
          case 'Finished':
            setProgreso(100);
            break;
        }
      });

      await relaunch();
    } catch (error) {
      console.error('Error instalando actualización:', error);
      setEstado('error');
    }
  }

  function cerrarPorAhora() {
    setVisible(false);
  }

  if (!visible || !update) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <h2 className={styles.title}>Actualización disponible</h2>
        <p className={styles.description}>
          Hay una nueva versión disponible: <strong>{update.version}</strong>
          {update.body && (
            <span className={styles.notes}>{update.body}</span>
          )}
        </p>

        {estado === 'idle' && (
          <div className={styles.actions}>
            <button className={styles.secondaryButton} onClick={cerrarPorAhora}>
              Más tarde
            </button>
            <button className={styles.primaryButton} onClick={instalarActualizacion}>
              Actualizar ahora
            </button>
          </div>
        )}

        {estado === 'descargando' && (
          <div className={styles.progressContainer}>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${progreso}%` }}
              />
            </div>
            <span className={styles.progressText}>
              Descargando... {progreso}%
            </span>
          </div>
        )}

        {estado === 'error' && (
          <div className={styles.actions}>
            <p className={styles.errorText}>
              Ocurrió un error al actualizar. Intenta más tarde.
            </p>
            <button className={styles.secondaryButton} onClick={cerrarPorAhora}>
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}