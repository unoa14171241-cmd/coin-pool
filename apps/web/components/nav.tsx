"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Command Center" },
  { href: "/create-position", label: "Create Position" },
  { href: "/my-positions", label: "My Positions" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/strategy-lab", label: "Strategy Lab" },
  { href: "/automation", label: "Automation" },
  { href: "/rebalance", label: "Rebalance" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" }
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-2">
      {links.map((link) => (
        <Link
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            pathname === link.href ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-100"
          )}
          href={link.href}
          key={link.href}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
