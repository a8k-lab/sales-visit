import {
  stockReportSchema,
  visitSchema,
  type StockReport,
  type Visit,
} from "@sales-visit/contracts";

import {
  outlets,
  products,
  salesForce,
  stockReports as seedReports,
  visits as seedVisits,
} from "@/data/mock-data";

// Submission time is prototype metadata, not a change to the shared contracts.
export type LocalVisit = Visit & { submittedAt: string };
type LocalData = {
  version: 1;
  visits: LocalVisit[];
  stockReports: StockReport[];
};
export type VisitData = {
  visits: (Visit & { submittedAt?: string })[];
  stockReports: StockReport[];
  storageError?: string;
};

const storageKey = "sales-visit:entries:v1";
const emptyData = (): LocalData => ({
  version: 1,
  visits: [],
  stockReports: [],
});
const storageMessage =
  "Penyimpanan lokal tidak dapat dibaca. Data contoh tetap tersedia. Periksa izin browser atau data situs sebelum menyimpan kunjungan.";

function validReferences(visit: Visit) {
  return (
    outlets.some((outlet) => outlet.id === visit.outletId) &&
    salesForce.some((member) => member.id === visit.salesForceId)
  );
}

function validReport(report: StockReport) {
  return (
    outlets.some((outlet) => outlet.id === report.outletId) &&
    salesForce.some((member) => member.id === report.reporterSalesForceId) &&
    report.items.every((item) =>
      products.some((product) => product.id === item.productId)
    ) &&
    new Set(report.items.map((item) => item.productId)).size ===
      report.items.length
  );
}

function readLocalData(): LocalData {
  const raw = window.localStorage.getItem(storageKey);
  if (raw === null) return emptyData();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(storageMessage);
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("visits" in value) ||
    !Array.isArray(value.visits) ||
    !("stockReports" in value) ||
    !Array.isArray(value.stockReports)
  ) {
    throw new Error(storageMessage);
  }
  const visits = value.visits.map((entry: unknown) => {
    const parsed = visitSchema.safeParse(entry);
    if (
      !parsed.success ||
      !validReferences(parsed.data) ||
      !entry ||
      typeof entry !== "object" ||
      !("submittedAt" in entry) ||
      typeof entry.submittedAt !== "string" ||
      !visitSchema.shape.visitedAt.safeParse(entry.submittedAt).success
    ) {
      throw new Error(storageMessage);
    }
    return { ...parsed.data, submittedAt: entry.submittedAt };
  });
  const stockReports = value.stockReports.map((entry: unknown) => {
    const parsed = stockReportSchema.safeParse(entry);
    if (!parsed.success || !validReport(parsed.data))
      throw new Error(storageMessage);
    const visit = visits.find((item) => item.id === parsed.data.visitId);
    if (
      !visit ||
      visit.outletId !== parsed.data.outletId ||
      visit.salesForceId !== parsed.data.reporterSalesForceId
    ) {
      throw new Error(storageMessage);
    }
    return parsed.data;
  });
  if (
    new Set([...seedVisits, ...visits].map((item) => item.id)).size !==
      seedVisits.length + visits.length ||
    new Set([...seedReports, ...stockReports].map((item) => item.id)).size !==
      seedReports.length + stockReports.length
  ) {
    throw new Error(storageMessage);
  }
  return { version: 1, visits, stockReports };
}

export function loadVisitData(): VisitData {
  try {
    const local = readLocalData();
    return {
      visits: [...seedVisits, ...local.visits],
      stockReports: [...seedReports, ...local.stockReports],
    };
  } catch {
    return {
      visits: [...seedVisits],
      stockReports: [...seedReports],
      storageError: storageMessage,
    };
  }
}

export function visitContext(visit: Visit, reports: StockReport[]) {
  return {
    outlet: outlets.find((item) => item.id === visit.outletId)!,
    member: salesForce.find((item) => item.id === visit.salesForceId)!,
    reports: reports.filter((report) => report.visitId === visit.id),
  };
}

// One write commits both records. Never report success or use an ephemeral fallback
// when storage is blocked/full. A form-owned ID also makes retries idempotent.
export function saveVisit(visit: LocalVisit, report?: StockReport): LocalVisit {
  let local: LocalData;
  try {
    local = readLocalData();
  } catch {
    throw new Error(storageMessage);
  }
  const existing = local.visits.find((item) => item.id === visit.id);
  if (existing) return existing;
  if (
    !visitSchema.safeParse(visit).success ||
    !validReferences(visit) ||
    !visitSchema.shape.visitedAt.safeParse(visit.submittedAt).success ||
    visit.submissionChannel !== "web" ||
    seedVisits.some((item) => item.id === visit.id) ||
    (report &&
      (!stockReportSchema.safeParse(report).success ||
        !validReport(report) ||
        report.visitId !== visit.id ||
        report.outletId !== visit.outletId ||
        report.reporterSalesForceId !== visit.salesForceId ||
        report.submissionChannel !== "web"))
  ) {
    throw new Error("Data kunjungan tidak valid. Periksa kembali isian Anda.");
  }
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        visits: [...local.visits, visit],
        stockReports: report
          ? [...local.stockReports, report]
          : local.stockReports,
      } satisfies LocalData)
    );
  } catch {
    throw new Error(
      "Kunjungan belum tersimpan. Penyimpanan browser penuh atau tidak diizinkan. Periksa pengaturan browser lalu coba lagi; isian Anda tetap tersedia."
    );
  }
  return visit;
}
