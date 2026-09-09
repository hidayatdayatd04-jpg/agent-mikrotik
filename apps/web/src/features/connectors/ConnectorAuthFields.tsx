import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Lock } from "@/components/icons";

export function ConnectorAuthFields(props: {
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  fieldErrors: Record<string, string>;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const { fieldErrors, setFieldErrors } = props;
  return (
    <>
      {/* Username */}
      <div className="space-y-1.5">
        <Label htmlFor="conn-username" className="text-xs font-medium">
          Username SSH
        </Label>
        <Input
          id="conn-username"
          value={props.username}
          onChange={(e) => {
            props.setUsername(e.target.value);
            if (fieldErrors.username) {
              setFieldErrors((prev) => {
                const { username: _, ...rest } = prev;
                return rest;
              });
            }
          }}
          placeholder="admin"
          autoComplete="off"
          className="font-mono text-xs"
        />
        {fieldErrors.username && <p className="text-[11px] text-destructive">{fieldErrors.username}</p>}
      </div>

      {/* Password with Eye toggle */}
      <div className="space-y-1.5">
        <Label htmlFor="conn-password" className="text-xs font-medium">
          Password SSH
        </Label>
        <div className="relative">
          <Input
            id="conn-password"
            type={props.showPassword ? "text" : "password"}
            value={props.password}
            onChange={(e) => {
              props.setPassword(e.target.value);
              if (fieldErrors.password) {
                setFieldErrors((prev) => {
                  const { password: _, ...rest } = prev;
                  return rest;
                });
              }
            }}
            autoComplete="new-password"
            placeholder="Kosongkan jika default tanpa password"
            className="pr-9 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => props.setShowPassword(!props.showPassword)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
            aria-label={props.showPassword ? "Sembunyikan password" : "Lihat password"}
          >
            {props.showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>
        {fieldErrors.password && <p className="text-[11px] text-destructive">{fieldErrors.password}</p>}
        <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground pt-0.5">
          <div className="flex items-center gap-1">
            <Lock className="size-3 text-emerald-500 shrink-0" />
            <span>Disimpan terenkripsi AES-256-GCM.</span>
          </div>
          <span className="text-[10px] text-indigo-500/80">Default WinBox: tanpa password</span>
        </div>
      </div>
    </>
  );
}
