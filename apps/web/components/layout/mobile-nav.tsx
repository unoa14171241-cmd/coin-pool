"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const MOBILE_LINKS = [
  { href: "/", label: "Home" },
  { href: "/my-positions", label: "Positions" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/activity", label: "Activity" },
  { href: "/automation", label: "Automation" }
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-800 bg-slate-950/95 md:hidden">
      <div className="grid grid-cols-5 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2">
        {MOBILE_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "rounded-md px-1 py-2 text-center text-[11px] font-medium",
              pathname === link.href ? "bg-blue-600 text-white" : "text-slate-300"
            )}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
