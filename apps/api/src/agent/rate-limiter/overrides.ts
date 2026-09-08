import { clampPositiveInt, minPositive } from "./estimate";
import { DEFAULT_GLOBAL_RPM, DEFAULT_GLOBAL_TPM, type EffectiveLimits, type LimiterOptions, type RateLimitOverride } from "./types";

/** Override per-provider / per-model / shared yang lebih ketat (#4). */
export class OverrideRegistry {
  private defaults: Required<RateLimitOverride>;
  private providerOverrides = new Map<string, RateLimitOverride>();
  private modelOverrides = new Map<string, RateLimitOverride>();
  private sharedOverrides = new Map<string, RateLimitOverride>();

  constructor(opts: LimiterOptions = {}) {
    this.defaults = {
      rpm: clampPositiveInt(opts.defaults?.rpm, DEFAULT_GLOBAL_RPM),
      tpm: clampPositiveInt(opts.defaults?.tpm, DEFAULT_GLOBAL_TPM),
    };
    for (const [k, v] of Object.entries(opts.providerOverrides ?? {})) this.providerOverrides.set(k, { ...v });
    for (const [k, v] of Object.entries(opts.modelOverrides ?? {})) this.modelOverrides.set(k, { ...v });
    for (const [k, v] of Object.entries(opts.sharedOverrides ?? {})) this.sharedOverrides.set(k, { ...v });
  }

  setProviderOverride(kind: string, override: RateLimitOverride): void {
    this.providerOverrides.set(kind, { ...override });
  }

  setModelOverride(modelKey: string, override: RateLimitOverride): void {
    this.modelOverrides.set(modelKey, { ...override });
  }

  setSharedOverride(sharedKey: string, override: RateLimitOverride): void {
    this.sharedOverrides.set(sharedKey, { ...override });
  }

  getDefaults(): EffectiveLimits {
    return { ...this.defaults };
  }

  setDefaults(override: RateLimitOverride): void {
    if (override.rpm !== undefined) this.defaults.rpm = clampPositiveInt(override.rpm, this.defaults.rpm);
    if (override.tpm !== undefined) this.defaults.tpm = clampPositiveInt(override.tpm, this.defaults.tpm);
  }

  getEffectiveLimits(input: { providerKind: string; modelKey: string; sharedKey?: string | null }): EffectiveLimits {
    const provider = this.providerOverrides.get(input.providerKind);
    const model = this.modelOverrides.get(input.modelKey);
    const shared = input.sharedKey ? this.sharedOverrides.get(input.sharedKey) : undefined;
    const rpm = minPositive(this.defaults.rpm, provider?.rpm, model?.rpm, shared?.rpm);
    const tpm = minPositive(this.defaults.tpm, provider?.tpm, model?.tpm, shared?.tpm);
    return {
      rpm: Number.isFinite(rpm) ? Math.floor(rpm) : this.defaults.rpm,
      tpm: Number.isFinite(tpm) ? Math.floor(tpm) : this.defaults.tpm,
    };
  }
}
