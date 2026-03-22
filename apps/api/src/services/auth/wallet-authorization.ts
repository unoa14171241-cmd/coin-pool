import { getAddress, isAddress } from "viem";
import { getActiveOperatorPermission } from "../automation/operator-permissions";

export type ActorRole = "owner" | "operator";

export type OwnerOperatorAuthorizationFailure =
  | "invalid_auth_wallet"
  | "operator_not_authorized"
  | "operator_missing_can_evaluate"
  | "operator_missing_can_execute"
  | "operator_missing_can_pause"
  | "operator_missing_can_change_strategy";

export type OwnerOperatorAuthorizationResult =
  | {
      ok: true;
      actorRole: ActorRole;
      authWallet: `0x${string}`;
    }
  | {
      ok: false;
      reason: OwnerOperatorAuthorizationFailure;
    };

export function normalizeWalletAddress(raw: string): `0x${string}` | null {
  if (!isAddress(raw)) return null;
  return getAddress(raw);
}

export async function authorizeOwnerOrOperatorAction(input: {
  targetOwnerWallet: `0x${string}`;
  authWalletRaw: unknown;
  requireCanEvaluate?: boolean;
  requireCanExecute?: boolean;
  requireCanPause?: boolean;
  requireCanChangeStrategy?: boolean;
}): Promise<OwnerOperatorAuthorizationResult> {
  const authWallet = normalizeWalletAddress(String(input.authWalletRaw ?? ""));
  if (!authWallet) {
    return { ok: false, reason: "invalid_auth_wallet" };
  }
  if (authWallet.toLowerCase() === input.targetOwnerWallet.toLowerCase()) {
    return {
      ok: true,
      actorRole: "owner",
      authWallet
    };
  }
  const permission = await getActiveOperatorPermission({
    ownerWallet: input.targetOwnerWallet,
    operatorWallet: authWallet
  });
  if (!permission) {
    return { ok: false, reason: "operator_not_authorized" };
  }
  if ((input.requireCanEvaluate ?? true) && !permission.canEvaluate) {
    return { ok: false, reason: "operator_missing_can_evaluate" };
  }
  if ((input.requireCanExecute ?? false) && !permission.canExecute) {
    return { ok: false, reason: "operator_missing_can_execute" };
  }
  if ((input.requireCanPause ?? false) && !permission.canPause) {
    return { ok: false, reason: "operator_missing_can_pause" };
  }
  if ((input.requireCanChangeStrategy ?? false) && !permission.canChangeStrategy) {
    return { ok: false, reason: "operator_missing_can_change_strategy" };
  }
  return {
    ok: true,
    actorRole: "operator",
    authWallet
  };
}
