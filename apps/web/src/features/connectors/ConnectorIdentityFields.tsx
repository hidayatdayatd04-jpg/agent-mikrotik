import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ConnectorIdentityFields(props: {
  label: string;
  setLabel: (v: string) => void;
  host: string;
  setHost: (v: string) => void;
  port: string;
  setPort: (v: string) => void;
  fieldErrors: Record<string, string>;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const { fieldErrors, setFieldErrors } = props;
  return (
    <>
      {/* Label */}
      <div className="space-y-1.5">
        <Label htmlFor="conn-label" className="text-xs font-medium">
          Nama / Label Router
        </Label>
        <Input
          id="conn-label"
          value={props.label}
          onChange={(e) => {
            props.setLabel(e.target.value);
            if (fieldErrors.label) {
              setFieldErrors((prev) => {
                const { label: _, ...rest } = prev;
                return rest;
              });
            }
          }}
          maxLength={200}
          placeholder="Contoh: Router Kantor Utama / RB4011"
          className="text-xs"
          autoFocus
        />
        {fieldErrors.label && <p className="text-[11px] text-destructive">{fieldErrors.label}</p>}
      </div>

      {/* Host and Port */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="conn-host" className="text-xs font-medium">
            Host / IP Address
          </Label>
          <Input
            id="conn-host"
            value={props.host}
            onChange={(e) => {
              props.setHost(e.target.value);
              if (fieldErrors.host) {
                setFieldErrors((prev) => {
                  const { host: _, ...rest } = prev;
                  return rest;
                });
              }
            }}
            placeholder="192.168.88.1"
            autoComplete="off"
            className="font-mono text-xs"
          />
          {fieldErrors.host && <p className="text-[11px] text-destructive">{fieldErrors.host}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="conn-port" className="text-xs font-medium">
            Port SSH
          </Label>
          <Input
            id="conn-port"
            value={props.port}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "");
              props.setPort(val);
              if (fieldErrors.port) {
                setFieldErrors((prev) => {
                  const { port: _, ...rest } = prev;
                  return rest;
                });
              }
            }}
            inputMode="numeric"
            placeholder="22"
            className="font-mono text-xs"
          />
          {fieldErrors.port && <p className="text-[11px] text-destructive">{fieldErrors.port}</p>}
        </div>
      </div>
    </>
  );
}
