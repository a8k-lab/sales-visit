import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { api, finishLogin, restoreSession, safeReturn } from "../session";

interface TelegramLogin {
  auth(
    options: {
      client_id: number;
      scope: ["profile"];
      nonce: string;
      lang: string;
    },
    callback: (result: { id_token?: string; error?: string }) => void
  ): void;
  close(): void;
}
declare global {
  interface Window {
    Telegram?: { Login: TelegramLogin };
  }
}
let sdk: Promise<void> | undefined;
function loadSdk() {
  return (sdk ??= new Promise<void>((resolve, reject) => {
    if (window.Telegram?.Login) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    const timer = window.setTimeout(() => {
      script.remove();
      sdk = undefined;
      reject(
        new Error(
          "Telegram tidak dapat dimuat. Periksa koneksi lalu coba lagi."
        )
      );
    }, 15000);
    script.src = "https://oauth.telegram.org/js/telegram-login.js?6";
    script.async = true;
    script.addEventListener(
      "load",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
    script.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        script.remove();
        sdk = undefined;
        reject(new Error("Telegram tidak dapat dimuat."));
      },
      { once: true }
    );
    document.head.append(script);
  }));
}
interface Ready {
  clientId: number;
  challenge: string;
  nonce: string;
  expiresAt: number;
}
const destination = () =>
  safeReturn(new URLSearchParams(location.search).get("redirect"));
export function LoginForm() {
  const [preparing, setPreparing] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Menyiapkan login…");
  const attempt = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(false);
  async function prepare() {
    setPreparing(true);
    setReady(null);
    setMessage("Menyiapkan login…");
    try {
      const [config, challenge] = await Promise.all([
        api<{ clientId: number }>("/auth/config"),
        api<Omit<Ready, "clientId">>("/auth/challenge", { method: "POST" }),
        loadSdk(),
      ]);
      if (!mounted.current) return;
      setReady({ ...challenge, clientId: config.clientId });
      setMessage("");
    } catch {
      if (mounted.current)
        setMessage("Login tidak tersedia. Periksa koneksi atau hubungi Admin.");
    } finally {
      if (mounted.current) setPreparing(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void restoreSession()
      .then((account) => {
        if (account && mounted.current) location.replace(destination());
      })
      .catch(() => {});
    void prepare();
    return () => {
      mounted.current = false;
      attempt.current++;
      clearTimeout(timer.current);
      window.Telegram?.Login.close();
    };
  }, []);
  function cancel(text = "Login dibatalkan. Silakan coba lagi.") {
    attempt.current++;
    clearTimeout(timer.current);
    window.Telegram?.Login.close();
    setBusy(false);
    setVerifying(false);
    setReady(null);
    setMessage(text);
  }
  function open() {
    if (!ready || !window.Telegram?.Login) return;
    if (ready.expiresAt <= Date.now() + 5000) {
      setReady(null);
      setMessage("Persiapan login kedaluwarsa. Silakan siapkan ulang.");
      return;
    }
    const current = ++attempt.current;
    setBusy(true);
    setMessage(
      "Selesaikan login di jendela Telegram. Jika tidak muncul, izinkan popup."
    );
    timer.current = window.setTimeout(
      () =>
        cancel(
          "Login kehabisan waktu atau popup diblokir. Izinkan popup lalu coba lagi."
        ),
      90000
    );
    try {
      // No await before auth: window.open runs within this real click gesture.
      window.Telegram.Login.auth(
        {
          client_id: ready.clientId,
          scope: ["profile"],
          nonce: ready.nonce,
          lang: "id",
        },
        (result) => {
          if (attempt.current !== current || !mounted.current) return;
          clearTimeout(timer.current);
          if (!result.id_token || result.error) {
            cancel();
            return;
          }
          setVerifying(true);
          setMessage("Memverifikasi akun…");
          void finishLogin(result.id_token, ready.challenge)
            .then(() => {
              if (mounted.current && attempt.current === current)
                location.replace(destination());
            })
            .catch(() => {
              if (mounted.current)
                cancel(
                  "Login ditolak atau sesi berakhir. Pastikan akun telah disetujui Admin."
                );
            });
        }
      );
    } catch {
      cancel("Popup tidak dapat dibuka. Izinkan popup lalu coba lagi.");
    }
  }
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">
          <h1>Selamat datang kembali</h1>
        </CardTitle>
        <CardDescription>
          Masuk dengan akun Telegram yang telah disetujui Admin.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sessionStorage.getItem("sales-visit.session-ended") && (
          <p
            role="status"
            className="text-muted-foreground text-center text-sm"
          >
            Sesi Anda telah berakhir. Silakan masuk kembali.
          </p>
        )}
        <Button disabled={!ready || busy} onClick={open}>
          Masuk dengan Telegram
        </Button>
        <p
          role="status"
          aria-live="polite"
          className="text-muted-foreground text-center text-sm"
        >
          {message}
        </p>
        {busy ? (
          <Button
            variant="outline"
            disabled={verifying}
            onClick={() => cancel()}
          >
            Batal
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={preparing}
            onClick={() => void prepare()}
          >
            Siapkan ulang login
          </Button>
        )}
        <p className="text-muted-foreground text-center text-xs">
          Dashboard masih menampilkan data contoh. Pelaporan Web belum tersedia.
        </p>
      </CardContent>
    </Card>
  );
}
