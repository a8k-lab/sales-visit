import {
  Link,
  useNavigate,
  useRouter,
  useSearch,
} from "@tanstack/react-router";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { outlets, salesForce } from "@/data/mock-data";
import { saveVisit } from "@/data/visit-store";
import { StockReportFields } from "@/features/stock-reports/components/stock-report-fields";
import { EntrySelect } from "@/features/visits/components/entry-select";
import {
  currentWibDateTime,
  validateEntry,
  visitTimestamp,
  type VisitEntry,
} from "@/features/visits/lib/visit-entry";

export function NewVisitPage() {
  const filters = useSearch({ from: "/dashboard/visits/new" });
  const navigate = useNavigate();
  const router = useRouter();
  const [value, setValue] = useState<VisitEntry>(() => ({
    outletId: "",
    salesForceId: "",
    visitedAt: currentWibDateTime(),
    notes: "",
    followUp: "",
    includeStock: false,
    rows: [],
  }));
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const locked = useRef(false);
  const [entryId] = useState(() => crypto.randomUUID());
  const errors = attempted ? validateEntry(value) : {};
  const update = (patch: Partial<VisitEntry>) =>
    setValue((previous) => ({ ...previous, ...patch }));

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    setAttempted(true);
    setSubmitError("");
    const invalid = validateEntry(value);
    if (Object.keys(invalid).length) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      );
      return;
    }
    locked.current = true;
    setSubmitting(true);
    let saved = false;
    const id = `VST-${entryId}`;
    try {
      const submittedAt = new Date().toISOString();
      saveVisit(
        {
          id,
          outletId: value.outletId,
          salesForceId: value.salesForceId,
          visitedAt: visitTimestamp(value.visitedAt),
          notes: value.notes.trim() || undefined,
          followUp: value.followUp.trim() || undefined,
          submissionChannel: "web",
          submittedAt,
        },
        value.includeStock
          ? {
              id: `SR-${entryId}`,
              visitId: id,
              outletId: value.outletId,
              reporterSalesForceId: value.salesForceId,
              reportedAt: submittedAt,
              submissionChannel: "web",
              items: value.rows.map((row) => ({
                productId: row.productId,
                quantity: Number(row.quantity),
              })),
            }
          : undefined
      );
      saved = true;
      await router.invalidate();
      await navigate({
        to: "/visits/$visitId",
        params: { visitId: id },
        search: filters,
      });
    } catch (error) {
      setSubmitError(
        saved
          ? "Kunjungan sudah tersimpan, tetapi halaman detail belum terbuka. Buka daftar kunjungan untuk melihatnya."
          : error instanceof Error
            ? error.message
            : "Kunjungan belum tersimpan. Silakan coba lagi."
      );
    } finally {
      // A successful write stays locked even if navigation fails.
      if (!saved) {
        locked.current = false;
        setSubmitting(false);
      }
    }
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Catat Kunjungan
        </h1>
        <p className="text-muted-foreground text-sm">
          Prototipe lokal: data hanya disimpan di browser ini, bukan dikirim ke
          server. Isian bertanda wajib harus diisi.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Informasi kunjungan</CardTitle>
          <CardDescription>
            Pilih petugas secara manual karena login belum tersedia. Kanal
            pelaporan otomatis Dashboard Web.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={submit} className="flex flex-col gap-6">
            <fieldset
              disabled={submitting}
              className="flex min-w-0 flex-col gap-6"
            >
              <FieldGroup>
                <EntrySelect
                  id="entry-outlet"
                  label="Outlet"
                  value={value.outletId}
                  options={outlets.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                  error={errors.outletId}
                  onChange={(outletId) => update({ outletId })}
                />
                <EntrySelect
                  id="entry-member"
                  label="Sales Force"
                  value={value.salesForceId}
                  options={salesForce.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                  error={errors.salesForceId}
                  onChange={(salesForceId) => update({ salesForceId })}
                />
                <Field data-invalid={!!errors.visitedAt}>
                  <FieldLabel htmlFor="entry-time">
                    Tanggal dan waktu kunjungan (wajib, WIB)
                  </FieldLabel>
                  <Input
                    id="entry-time"
                    type="datetime-local"
                    required
                    value={value.visitedAt}
                    onChange={(event) =>
                      update({ visitedAt: event.target.value })
                    }
                    aria-invalid={!!errors.visitedAt}
                    aria-describedby={
                      errors.visitedAt ? "entry-time-error" : "entry-time-help"
                    }
                  />
                  <FieldDescription id="entry-time-help">
                    Waktu kunjungan sebenarnya, terpisah dari waktu penyimpanan
                    otomatis.
                  </FieldDescription>
                  {errors.visitedAt && (
                    <FieldError id="entry-time-error">
                      {errors.visitedAt}
                    </FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="entry-notes">
                    Catatan kunjungan (opsional)
                  </FieldLabel>
                  <Textarea
                    id="entry-notes"
                    rows={3}
                    value={value.notes}
                    onChange={(event) => update({ notes: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="entry-follow-up">
                    Catatan tindak lanjut (opsional)
                  </FieldLabel>
                  <Textarea
                    id="entry-follow-up"
                    rows={3}
                    value={value.followUp}
                    onChange={(event) =>
                      update({ followUp: event.target.value })
                    }
                  />
                </Field>
              </FieldGroup>
              <StockReportFields
                enabled={value.includeStock}
                rows={value.rows}
                errors={errors}
                onToggle={() =>
                  update({
                    includeStock: !value.includeStock,
                    rows: value.rows.length
                      ? value.rows
                      : [
                          {
                            id: crypto.randomUUID(),
                            productId: "",
                            quantity: "",
                          },
                        ],
                  })
                }
                onChange={(rows) => update({ rows })}
              />
            </fieldset>
            {submitError && <FieldError>{submitError}</FieldError>}
            {attempted && Object.keys(errors).length > 0 && (
              <FieldError>
                Periksa isian yang ditandai. Kunjungan belum disimpan.
              </FieldError>
            )}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Menyimpan…" : "Simpan kunjungan"}
              </Button>
              <Button
                nativeButton={false}
                variant="outline"
                render={<Link to="/visits" search={filters} />}
              >
                {submitting ? "Lihat daftar kunjungan" : "Batal"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
