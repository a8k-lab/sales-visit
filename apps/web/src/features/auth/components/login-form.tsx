import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useRef, useState, type SubmitEvent } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

// Adapted from the official shadcn/ui login-03 block (Base UI / nova).
export function LoginForm() {
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({ email: "", password: "" });
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = emailRef.current;
    const password = passwordRef.current;
    if (!email || !password) return;

    // Inspect browser validity only; credentials are never copied into app state,
    // sent over the network, logged, or persisted.
    const nextErrors = {
      email: email.validity.valueMissing
        ? "Masukkan alamat email."
        : !email.validity.valid
          ? "Masukkan alamat email yang valid."
          : "",
      password: password.validity.valueMissing ? "Masukkan kata sandi." : "",
    };
    setErrors(nextErrors);
    setSubmitted(false);
    if (nextErrors.email || nextErrors.password) {
      (nextErrors.email ? email : password).focus();
      return;
    }

    event.currentTarget.reset();
    setShowPassword(false);
    setSubmitted(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            <h1>Selamat datang kembali</h1>
          </CardTitle>
          <CardDescription>
            Masuk ke Sales Visit untuk melanjutkan pelaporan kunjungan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            autoComplete="off"
            aria-describedby="login-prototype"
            onSubmit={handleSubmit}
          >
            <FieldGroup>
              <FieldDescription id="login-prototype" className="text-center">
                Login belum tersedia. Formulir ini hanya untuk mencoba validasi.
                Jangan gunakan email atau kata sandi asli.
              </FieldDescription>
              <Field data-invalid={!!errors.email}>
                <FieldLabel htmlFor="login-email">Email</FieldLabel>
                <Input
                  ref={emailRef}
                  id="login-email"
                  type="email"
                  placeholder="nama@contoh.com"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  aria-invalid={!!errors.email}
                  aria-describedby={
                    errors.email ? "login-email-error" : undefined
                  }
                  onInput={() => {
                    setErrors((previous) => ({ ...previous, email: "" }));
                    setSubmitted(false);
                  }}
                />
                {errors.email && (
                  <FieldError id="login-email-error">{errors.email}</FieldError>
                )}
              </Field>
              <Field data-invalid={!!errors.password}>
                <FieldLabel htmlFor="login-password">Kata sandi</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    ref={passwordRef}
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="off"
                    required
                    aria-invalid={!!errors.password}
                    aria-describedby={
                      errors.password ? "login-password-error" : undefined
                    }
                    onInput={() => {
                      setErrors((previous) => ({ ...previous, password: "" }));
                      setSubmitted(false);
                    }}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-sm"
                      aria-label={
                        showPassword
                          ? "Sembunyikan kata sandi"
                          : "Tampilkan kata sandi"
                      }
                      aria-pressed={showPassword}
                      aria-controls="login-password"
                      onClick={() => setShowPassword((previous) => !previous)}
                    >
                      {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                {errors.password && (
                  <FieldError id="login-password-error">
                    {errors.password}
                  </FieldError>
                )}
              </Field>
              <Field>
                <Button type="submit">Login</Button>
                <FieldDescription role="status" className="text-center">
                  {submitted
                    ? "Login belum tersedia. Isian telah dikosongkan tanpa dikirim atau disimpan. Silakan lihat Dashboard demo."
                    : "Tidak ada proses autentikasi. Isian tidak dikirim atau disimpan."}
                </FieldDescription>
              </Field>
              <Field>
                <Link
                  to="/overview"
                  data-slot="button"
                  className={cn(buttonVariants({ variant: "outline" }))}
                >
                  Lihat Dashboard Demo
                </Link>
                <FieldDescription className="text-center">
                  Jelajahi data contoh tanpa login.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
