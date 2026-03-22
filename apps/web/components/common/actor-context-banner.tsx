"use client";

type ActorRole = "OWNER" | "OPERATOR" | "NOT_CONNECTED";
type ActorScope =
  | { kind: "owner_full" }
  | { kind: "permission_unknown" }
  | {
      kind: "operator";
      canEvaluate: boolean;
      canExecute: boolean;
      canPause: boolean;
      canChangeStrategy: boolean;
    };

export function ActorContextBanner(input: {
  role: ActorRole;
  actorWallet?: string;
  targetOwnerWallet?: string;
  scope?: ActorScope;
  executionPaused?: boolean;
  size?: "compact" | "normal";
  className?: string;
}) {
  const roleBadgeClass =
    input.role === "OWNER"
      ? "border-emerald-700 bg-emerald-950 text-emerald-300"
      : input.role === "OPERATOR"
        ? "border-blue-700 bg-blue-950 text-blue-300"
        : "border-slate-700 bg-slate-900 text-slate-400";
  const sizeClass = input.size === "compact" ? "p-2 text-[11px]" : "p-3 text-xs";
  const classes = input.className
    ? `rounded-xl border border-slate-800 bg-slate-900 ${sizeClass} ${input.className}`
    : `rounded-xl border border-slate-800 bg-slate-900 ${sizeClass}`;
  const badgeClass = input.size === "compact" ? "rounded border px-1.5 py-0.5 font-semibold tracking-wide" : "rounded border px-2 py-1 font-semibold tracking-wide";
  const actorWalletLabel = input.size === "compact" ? shortAddress(input.actorWallet) : input.actorWallet ?? "-";
  const targetOwnerLabel =
    input.targetOwnerWallet == null ? null : input.size === "compact" ? shortAddress(input.targetOwnerWallet) : input.targetOwnerWallet;
  const scopeLabel = buildScopeLabel({ scope: input.scope, size: input.size ?? "normal" });
  return (
    <div className={classes}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${badgeClass} ${roleBadgeClass}`}>role: {input.role}</span>
        <span className="text-slate-300" title={input.actorWallet ?? "-"}>
          wallet: {actorWalletLabel}
        </span>
        {targetOwnerLabel ? (
          <span className="text-slate-400" title={input.targetOwnerWallet}>
            target owner: {targetOwnerLabel}
          </span>
        ) : null}
        {input.executionPaused != null ? (
          <span className={input.executionPaused ? "text-amber-300" : "text-emerald-300"}>
            execution: {input.executionPaused ? "PAUSED" : "ACTIVE"}
          </span>
        ) : null}
      </div>
      {scopeLabel ? <p className="mt-2 text-slate-400">scope: {scopeLabel}</p> : null}
    </div>
  );
}

function shortAddress(value?: string): string {
  if (!value) return "-";
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function buildScopeLabel(input: { scope?: ActorScope; size: "compact" | "normal" }): string | undefined {
  if (!input.scope) return undefined;
  if (input.scope.kind === "owner_full") return input.size === "compact" ? "OWNER:FULL" : "full owner scope";
  if (input.scope.kind === "permission_unknown") {
    return input.size === "compact" ? "PERM:UNKNOWN" : "permission unknown (load pending or not granted)";
  }
  const verbose = `evaluate=${input.scope.canEvaluate ? "Y" : "N"}, execute=${input.scope.canExecute ? "Y" : "N"}, pause=${
    input.scope.canPause ? "Y" : "N"
  }, strategy=${input.scope.canChangeStrategy ? "Y" : "N"}`;
  if (input.size !== "compact") return verbose;
  return `E:${input.scope.canEvaluate ? "Y" : "N"} X:${input.scope.canExecute ? "Y" : "N"} P:${
    input.scope.canPause ? "Y" : "N"
  } S:${input.scope.canChangeStrategy ? "Y" : "N"}`;
}
