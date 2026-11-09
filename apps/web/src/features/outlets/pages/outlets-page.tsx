import {
  Link,
  useLoaderData,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";

import { OperationalRefresh } from "@/components/operational-state";
import { ReadPagination } from "@/components/read-pagination";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function OutletsPage() {
  const data = useLoaderData({ from: "/dashboard/outlets" });
  const { q, offset } = useSearch({ from: "/dashboard/outlets" });
  const navigate = useNavigate({ from: "/outlets" });
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Outlet
        </h1>
        <p className="text-muted-foreground text-sm">
          Master Outlet dan riwayat operasional sesuai akses Anda.
        </p>
      </div>
      <div>
        <OperationalRefresh />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            Daftar Outlet{" "}
            <Badge variant="secondary">
              {data.total.toLocaleString("id-ID")}
            </Badge>
          </CardTitle>
          <CardDescription>Nama dan ID dari master data.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Field>
            <FieldLabel htmlFor="outlet-search">
              Cari nama atau ID Outlet
            </FieldLabel>
            <Input
              id="outlet-search"
              value={q}
              maxLength={200}
              onChange={(e) =>
                void navigate({
                  search: { q: e.target.value, offset: 0 },
                  replace: true,
                  resetScroll: false,
                })
              }
            />
          </Field>
          {data.items.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Outlet</TableHead>
                  <TableHead>ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((outlet) => (
                  <TableRow key={outlet.id}>
                    <TableCell>
                      <Link
                        to="/outlets/$outletId"
                        params={{ outletId: outlet.id }}
                        search={{}}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {outlet.name}
                      </Link>
                    </TableCell>
                    <TableCell className="break-all whitespace-normal">
                      {outlet.id}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Tidak ada Outlet yang sesuai</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
          <ReadPagination
            offset={offset}
            count={data.items.length}
            total={data.total}
            onChange={(next) =>
              void navigate({ search: { q, offset: next }, resetScroll: false })
            }
          />
        </CardContent>
      </Card>
    </>
  );
}
