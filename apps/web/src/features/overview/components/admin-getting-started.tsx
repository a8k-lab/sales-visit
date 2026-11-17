import { Link } from "@tanstack/react-router";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function AdminGettingStarted() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Mulai operasional tim</h2>
        </CardTitle>
        <CardDescription>
          Belum ada kunjungan pada periode ini. Panduan berikut dapat digunakan
          bila tim baru mulai; bukan status kelengkapan pengaturan Anda.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm [&_a]:underline [&_a]:underline-offset-4">
          <li>
            Tambahkan master di{" "}
            <Link to="/master/sales-force" search={{ q: "", after: "" }}>
              Kelola Sales Force
            </Link>
            .
          </li>
          <li>Minta anggota tim mendaftar melalui Telegram Bot.</li>
          <li>
            Setujui akun dan tentukan perannya di{" "}
            <Link
              to="/users"
              search={{ after: "", pendingAfter: "", status: "" }}
            >
              Pengguna & Akses
            </Link>
            .
          </li>
          <li>
            Atur <Link to="/supervisor-assignments">Penugasan Supervisor</Link>{" "}
            untuk akses pemantauan.
          </li>
          <li>
            Mulai mencatat kunjungan melalui Telegram Bot. Pelaporan Web belum
            tersedia.
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}
