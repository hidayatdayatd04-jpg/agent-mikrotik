import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Loader2, Mail } from "lucide-react";
import { useRequestOtp, useVerifyOtp } from "./auth-hooks";

type Step = "email" | "code";

export function LoginForm() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const requestOtp = useRequestOtp();
  const verifyOtp = useVerifyOtp();

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await requestOtp.mutateAsync(email);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim kode.");
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await verifyOtp.mutateAsync({ email, code });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kode salah atau kedaluwarsa.");
    }
  }

  const busy = requestOtp.isPending || verifyOtp.isPending;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Masuk</CardTitle>
        <CardDescription>
          {step === "email"
            ? "Masukkan email untuk menerima kode verifikasi."
            : `Kode 6 digit dikirim ke ${email}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {step === "email" ? (
          <form onSubmit={submitEmail}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  placeholder="nama@contoh.com"
                />
              </Field>
              <Button type="submit" className="w-full" disabled={busy || !email.includes("@")}>
                {requestOtp.isPending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Mail data-icon="inline-start" />}
                Kirim Kode
              </Button>
            </FieldGroup>
          </form>
        ) : (
          <form onSubmit={submitCode}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="code">Kode Verifikasi</FieldLabel>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  disabled={busy}
                  placeholder="000000"
                  className="text-center text-lg tracking-widest"
                />
                <FieldDescription>Masukkan 6 digit yang dikirim ke email Anda.</FieldDescription>
              </Field>
              <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
                {verifyOtp.isPending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
                Verifikasi
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={busy}
                onClick={() => {
                  setStep("email");
                  setCode("");
                }}
              >
                Ganti Email
              </Button>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
