import type {
  ReadPage,
  Reference,
  NamedStockReport,
} from "@sales-visit/contracts";

import { api } from "@/features/auth/session";
import { catalogQuery } from "@/features/outlets/lib/outlet-data";

export type DirectoryKind = "sales-force" | "products" | "stock-reports";
export async function loadDirectory(
  kind: DirectoryKind,
  q: string,
  offset: number
) {
  const query = catalogQuery(kind === "stock-reports" ? "" : q, offset);
  if (kind === "stock-reports")
    return {
      kind,
      records: await api<ReadPage<NamedStockReport>>(`/stock-reports?${query}`),
      references: null,
    };
  return {
    kind,
    references: await api<ReadPage<Reference>>(`/${kind}?${query}`),
    records: null,
  };
}
