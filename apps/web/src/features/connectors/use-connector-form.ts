import { useState, useEffect } from "react";
import { useCreateConnector } from "./connector-hooks";
import { ApiError } from "@/lib/api";
import { classifyHint } from "./connector-hints";

export interface ConnectorInitialValues {
  label?: string;
  host?: string;
  port?: number;
  username?: string;
}

export function useConnectorForm(
  open: boolean,
  initialValues: ConnectorInitialValues | null | undefined,
  onOpenChange: (open: boolean) => void,
) {
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<{ code: string; message: string } | null>(null);

  const create = useCreateConnector();

  useEffect(() => {
    if (open) {
      if (initialValues) {
        if (initialValues.label) setLabel(initialValues.label);
        if (initialValues.host) setHost(initialValues.host);
        if (initialValues.port) setPort(String(initialValues.port));
        if (initialValues.username) setUsername(initialValues.username);
      }
    } else {
      reset();
    }
  }, [open, initialValues]);

  const canSubmit = label.trim() !== "" && host.trim() !== "" && username.trim() !== "" && !create.isPending;

  function reset() {
    setLabel("");
    setHost("");
    setPort("22");
    setUsername("");
    setPassword("");
    setShowPassword(false);
    setFieldErrors({});
    setApiError(null);
    create.reset();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError(null);
    setFieldErrors({});
    const cleanPort = port.trim();
    const portNum = cleanPort === "" ? 22 : Number(cleanPort);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setFieldErrors({ port: "Port harus berupa angka antara 1–65535." });
      return;
    }
    try {
      await create.mutateAsync({
        label: label.trim(),
        host: host.trim(),
        port: portNum,
        username: username.trim(),
        password,
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setApiError({ code: err.code, message: err.message });
        if (err.fieldErrors) setFieldErrors(err.fieldErrors);
      } else {
        setApiError({ code: "INTERNAL_ERROR", message: "Terjadi kesalahan tak terduga saat menghubungi router." });
      }
    }
  }

  const hint = apiError ? classifyHint(apiError.code, apiError.message) : "";

  return {
    label,
    setLabel,
    host,
    setHost,
    port,
    setPort,
    username,
    setUsername,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    fieldErrors,
    setFieldErrors,
    apiError,
    hint,
    canSubmit,
    isPending: create.isPending,
    reset,
    onSubmit,
  };
}
