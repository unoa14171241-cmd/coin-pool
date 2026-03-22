import {
  getApproveAllowListByChain,
  POSITION_MANAGER_BY_CHAIN,
  USDC_BY_CHAIN,
  WETH_BY_CHAIN
} from "@/lib/contracts";
import { decimalStringSchema } from "@lp-manager/shared";
import { createPublicClient, encodeFunctionData, getAddress, http, parseEther, parseUnits } from "viem";
import { arbitrum, base, mainnet, polygon } from "viem/chains";

type ApprovalToken = "WETH" | "USDC";

export interface ApprovalPlan {
  chainId: number;
  token: ApprovalToken;
  tokenAddress: `0x${string}`;
  spender: `0x${string}`;
  requiredAmount: bigint;
  decimals: number;
  humanAmount: string;
  mode: "EXACT";
}

export interface ApprovalRequirement extends ApprovalPlan {
  currentAllowance: bigint;
  approvalRequired: boolean;
  missingAmount: bigint;
  txHash?: `0x${string}`;
  errorMessage?: string;
  approvalSkipped: boolean;
}

export interface PreparedApproveTransaction {
  token: ApprovalToken;
  tokenAddress: `0x${string}`;
  spender: `0x${string}`;
  amount: bigint;
  calldata: `0x${string}`;
  value: bigint;
}

const chainMap = {
  42161: arbitrum,
  1: mainnet,
  8453: base,
  137: polygon
} as const;

const erc20Abi = [
  {
    inputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "address", name: "spender", type: "address" }
    ],
    name: "allowance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" }
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const;

export function buildExactApprovalPlan(chainId: number, amountEth: string, amountUsdc: string): ApprovalPlan[] {
  const parsedEth = decimalStringSchema.safeParse(amountEth);
  if (!parsedEth.success) {
    throw new Error(`ETH amount invalid: ${parsedEth.error.issues[0]?.message ?? "invalid decimal"}`);
  }
  const parsedUsdc = decimalStringSchema.safeParse(amountUsdc);
  if (!parsedUsdc.success) {
    throw new Error(`USDC amount invalid: ${parsedUsdc.error.issues[0]?.message ?? "invalid decimal"}`);
  }

  const spender = POSITION_MANAGER_BY_CHAIN[chainId];
  const weth = WETH_BY_CHAIN[chainId];
  const usdcAddress = USDC_BY_CHAIN[chainId];
  if (!spender || !weth || !usdcAddress) {
    throw new Error("Unsupported chain for approval plan");
  }

  return [
    {
      chainId,
      token: "WETH",
      tokenAddress: getAddress(weth),
      spender: getAddress(spender),
      requiredAmount: parseEther(parsedEth.data),
      decimals: 18,
      humanAmount: parsedEth.data,
      mode: "EXACT"
    },
    {
      chainId,
      token: "USDC",
      tokenAddress: getAddress(usdcAddress),
      spender: getAddress(spender),
      requiredAmount: parseUnits(parsedUsdc.data, 6),
      decimals: 6,
      humanAmount: parsedUsdc.data,
      mode: "EXACT"
    }
  ];
}

export async function checkApprovalRequirements(input: {
  chainId: number;
  owner: `0x${string}`;
  plans: ApprovalPlan[];
}): Promise<ApprovalRequirement[]> {
  const chain = chainMap[input.chainId as keyof typeof chainMap];
  if (!chain) throw new Error("Unsupported chain for approval check");
  const client = createPublicClient({
    chain,
    transport: http(getRpcUrl(input.chainId))
  });
  const owner = getAddress(input.owner);

  const rows = await Promise.all(
    input.plans.map(async (plan) => {
      const allowance = await client.readContract({
        address: plan.tokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, plan.spender]
      });
      const approvalRequired = allowance < plan.requiredAmount;
      return {
        ...plan,
        currentAllowance: allowance,
        approvalRequired,
        missingAmount: approvalRequired ? plan.requiredAmount - allowance : 0n,
        txHash: undefined,
        errorMessage: undefined,
        approvalSkipped: !approvalRequired
      };
    })
  );

  return rows;
}

export function prepareApproveTransaction(plan: ApprovalPlan): PreparedApproveTransaction {
  validatePlanSpenderAllowlist(plan.chainId, plan.spender);
  const calldata = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [plan.spender, plan.requiredAmount]
  });
  return {
    token: plan.token,
    tokenAddress: plan.tokenAddress,
    spender: plan.spender,
    amount: plan.requiredAmount,
    calldata,
    value: 0n
  };
}

function validatePlanSpenderAllowlist(chainId: number, spender: `0x${string}`) {
  const allowlist = getApproveAllowListByChain(chainId).map((v) => v.toLowerCase());
  if (!allowlist.includes(spender.toLowerCase())) {
    throw new Error("Approval spender is not allow-listed for this chain");
  }
}

function getRpcUrl(chainId: number): string {
  const url =
    chainId === 42161
      ? process.env.NEXT_PUBLIC_RPC_URL_ARBITRUM
      : chainId === 1
        ? process.env.NEXT_PUBLIC_RPC_URL_ETHEREUM
        : chainId === 8453
          ? process.env.NEXT_PUBLIC_RPC_URL_BASE
          : chainId === 137
            ? process.env.NEXT_PUBLIC_RPC_URL_POLYGON
            : undefined;
  if (!url) {
    throw new Error(`RPC URL is not configured for chain ${chainId}`);
  }
  return url;
}
