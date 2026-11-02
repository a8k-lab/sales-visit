import { PlusIcon, TrashIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { products } from "@/data/mock-data";
import { EntrySelect } from "@/features/visits/components/entry-select";
import type { EntryErrors, StockRow } from "@/features/visits/lib/visit-entry";

export function StockReportFields({
  enabled,
  rows,
  errors,
  onToggle,
  onChange,
}: {
  enabled: boolean;
  rows: StockRow[];
  errors: EntryErrors;
  onToggle: () => void;
  onChange: (rows: StockRow[]) => void;
}) {
  const update = (id: string, patch: Partial<StockRow>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  return (
    <FieldSet>
      <FieldLegend>Laporan Stok (opsional)</FieldLegend>
      <FieldDescription>
        Kunjungan boleh dicatat tanpa laporan stok. Jumlah yang dilaporkan
        adalah pengamatan, bukan stok terkini.
      </FieldDescription>
      <Button
        type="button"
        variant={enabled ? "secondary" : "outline"}
        aria-pressed={enabled}
        onClick={onToggle}
        className="self-start"
      >
        {enabled ? "Laporan stok disertakan" : "Sertakan laporan stok"}
      </Button>
      {enabled && (
        <FieldGroup>
          {rows.map((row, index) => (
            <FieldSet key={row.id} className="rounded-lg border p-4">
              <FieldLegend variant="label">Produk {index + 1}</FieldLegend>
              <FieldGroup className="sm:flex-row sm:items-start">
                <EntrySelect
                  id={`product-${row.id}`}
                  label="Produk"
                  value={row.productId}
                  options={products.map((product) => ({
                    value: product.id,
                    label: product.name,
                    disabled: rows.some(
                      (other) =>
                        other.id !== row.id && other.productId === product.id
                    ),
                  }))}
                  error={errors[`${row.id}.product`]}
                  onChange={(productId) => update(row.id, { productId })}
                />
                <Field
                  className="sm:max-w-40"
                  data-invalid={!!errors[`${row.id}.quantity`]}
                >
                  <FieldLabel htmlFor={`quantity-${row.id}`}>
                    Jumlah (wajib)
                  </FieldLabel>
                  <Input
                    id={`quantity-${row.id}`}
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    required
                    value={row.quantity}
                    onChange={(event) =>
                      update(row.id, { quantity: event.target.value })
                    }
                    aria-invalid={!!errors[`${row.id}.quantity`]}
                    aria-describedby={
                      errors[`${row.id}.quantity`]
                        ? `quantity-${row.id}-error`
                        : undefined
                    }
                  />
                  {errors[`${row.id}.quantity`] && (
                    <FieldError id={`quantity-${row.id}-error`}>
                      {errors[`${row.id}.quantity`]}
                    </FieldError>
                  )}
                </Field>
              </FieldGroup>
              <Button
                type="button"
                variant="ghost"
                className="self-start"
                onClick={() =>
                  onChange(rows.filter((item) => item.id !== row.id))
                }
                aria-label={`Hapus produk ${index + 1}`}
              >
                <TrashIcon data-icon="inline-start" /> Hapus produk
              </Button>
            </FieldSet>
          ))}
          {errors.rows && <FieldError>{errors.rows}</FieldError>}
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={rows.length >= products.length}
            onClick={() =>
              onChange([
                ...rows,
                { id: crypto.randomUUID(), productId: "", quantity: "" },
              ])
            }
          >
            <PlusIcon data-icon="inline-start" /> Tambah produk
          </Button>
          <FieldDescription>
            Isi bilangan bulat nol atau lebih. Setiap produk hanya boleh dipilih
            sekali.
          </FieldDescription>
        </FieldGroup>
      )}
    </FieldSet>
  );
}
