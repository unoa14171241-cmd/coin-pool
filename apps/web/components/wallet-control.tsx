"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAccount, useConnect, useDisconnect } from "wagmi";

export function WalletControl() {
  const { address, chain } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keep SSR and first client render stable to avoid hydration mismatch.
  if (!mounted) {
    return (
      <div className="rounded-lg border bg-white p-3 text-sm">
        <p className="mb-2">Connect wallet (signature-based, no custody)</p>
      </div>
    );
  }

  if (address) {
    return (
      <div className="rounded-lg border bg-white p-3 text-sm">
        <p>Wallet: {address}</p>
        <p>Chain: {chain?.name ?? "Unknown"}</p>
        <Button className="mt-2" variant="outline" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-3 text-sm">
      <p className="mb-2">Connect wallet (signature-based, no custody)</p>
      {connectors.map((connector) => (
        <Button
          className="mr-2"
          key={connector.uid}
          onClick={() => connect({ connector })}
          disabled={isPending}
          variant="outline"
        >
          {connector.name}
        </Button>
      ))}
    </div>
  );
}
