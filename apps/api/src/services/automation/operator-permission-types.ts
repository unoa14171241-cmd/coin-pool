export interface OperatorPermission {
  ownerWallet: `0x${string}`;
  operatorWallet: `0x${string}`;
  canEvaluate: boolean;
  canExecute: boolean;
  canPause: boolean;
  canChangeStrategy: boolean;
  active: boolean;
  updatedAt: string;
}
