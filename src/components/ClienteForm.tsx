import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import type { Cliente } from "../types/models";
import { crearCliente, actualizarCliente } from "../db/database";
import ConfirmDialog from "./ConfirmDialog";
import styles from "./ClienteForm.module.css";

const clienteSchema = z.object({
  comprador: z.string().trim().min(1, "El nombre del comprador es obligatorio"),
  domicilio: z.string().trim().min(1, "El domicilio es obligatorio"),
  telefono: z
    .string()
    .trim()
    .min(1, "El teléfono es obligatorio")
    .regex(/^\d+$/, "El teléfono solo debe contener números"),
});

type ClienteFormValues = z.infer<typeof clienteSchema>;

interface ClienteFormProps {
  initialValue?: Cliente;
  initialComprador?: string;
  submitLabel?: string;
  onSaved: (cliente: Cliente) => void;
  onCancel?: () => void;
}

export default function ClienteForm({
  initialValue,
  initialComprador,
  submitLabel,
  onSaved,
  onCancel,
}: ClienteFormProps) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [cambiosPendientes, setCambiosPendientes] = useState<ClienteFormValues | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ClienteFormValues>({
    resolver: zodResolver(clienteSchema),
    defaultValues: {
      comprador: initialValue?.comprador ?? initialComprador ?? "",
      domicilio: initialValue?.domicilio ?? "",
      telefono: initialValue?.telefono ?? "",
    },
  });

  const editando = Boolean(initialValue?.id);

  const onSubmit = async (values: ClienteFormValues) => {
    setSaveError(null);
    // Modificar un cliente ya registrado cambia cómo aparece en todas sus
    // notas de venta anteriores, así que se confirma antes.
    if (editando) {
      setCambiosPendientes(values);
      return;
    }
    try {
      const id = await crearCliente(values);
      onSaved({ ...values, id });
    } catch (err) {
      console.error(err);
      const detalle = err instanceof Error ? err.message : String(err);
      setSaveError(`No se pudo guardar el cliente: ${detalle}`);
    }
  };

  // El error se propaga para que lo muestre el diálogo de confirmación.
  async function confirmarCambios() {
    const actualizado: Cliente = { ...initialValue!, ...cambiosPendientes! };
    await actualizarCliente(actualizado);
    setCambiosPendientes(null);
    onSaved(actualizado);
  }

  // Se renderiza como <div>, no como <form>, porque este componente también se
  // usa embebido dentro del formulario de la nota de venta (ClienteAutocomplete).
  // Un <form> anidado es HTML inválido y hacía que el submit burbujeara al
  // formulario de la venta, disparando su validación al guardar un cliente.
  const enviar = handleSubmit(onSubmit);

  return (
    <div
      className={styles.form}
      onKeyDown={(e) => {
        // Enter sigue guardando, como en un <form> normal, pero sin salirse
        // al formulario de arriba.
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          e.stopPropagation();
          void enviar();
        }
      }}
    >
      <div className="field">
        <label className="field-label field-required" htmlFor="comprador">
          Nombre del comprador
        </label>
        <input
          id="comprador"
          className={`input ${errors.comprador ? "input-error" : ""}`}
          placeholder="Ej. Juan Pérez"
          {...register("comprador")}
        />
        {errors.comprador && <span className="field-error">{errors.comprador.message}</span>}
      </div>

      <div className="field">
        <label className="field-label field-required" htmlFor="domicilio">
          Domicilio
        </label>
        <input
          id="domicilio"
          className={`input ${errors.domicilio ? "input-error" : ""}`}
          placeholder="Calle, número, colonia"
          {...register("domicilio")}
        />
        {errors.domicilio && <span className="field-error">{errors.domicilio.message}</span>}
      </div>

      <div className="field">
        <label className="field-label field-required" htmlFor="telefono">
          Teléfono
        </label>
        <input
          id="telefono"
          className={`input ${errors.telefono ? "input-error" : ""}`}
          placeholder="10 dígitos"
          inputMode="numeric"
          {...register("telefono")}
        />
        {errors.telefono && <span className="field-error">{errors.telefono.message}</span>}
      </div>

      {saveError && <span className="field-error">{saveError}</span>}

      <div className={styles.actions}>
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancelar
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => void enviar()} disabled={isSubmitting}>
          {isSubmitting ? "Guardando..." : submitLabel ?? "Guardar cliente"}
        </button>
      </div>

      {cambiosPendientes && initialValue && (
        <ConfirmDialog
          title={`¿Guardar los cambios de ${initialValue.comprador}?`}
          message={
            <>
              Los datos nuevos se van a reflejar también en las notas de venta que
              este cliente ya tenga registradas.
              <ul className={styles.cambiosLista}>
                {cambiosPendientes.comprador !== initialValue.comprador && (
                  <li>
                    Nombre: {initialValue.comprador} → <strong>{cambiosPendientes.comprador}</strong>
                  </li>
                )}
                {cambiosPendientes.domicilio !== initialValue.domicilio && (
                  <li>
                    Domicilio: {initialValue.domicilio} → <strong>{cambiosPendientes.domicilio}</strong>
                  </li>
                )}
                {cambiosPendientes.telefono !== initialValue.telefono && (
                  <li>
                    Teléfono: {initialValue.telefono} → <strong>{cambiosPendientes.telefono}</strong>
                  </li>
                )}
              </ul>
            </>
          }
          confirmLabel="Guardar cambios"
          onConfirm={confirmarCambios}
          onCancel={() => setCambiosPendientes(null)}
        />
      )}
    </div>
  );
}
