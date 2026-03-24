"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const MENU_LINKS = [
  { href: "/", label: "ホーム" },
  { href: "/command-center", label: "Command Center" },
  { href: "/create-position", label: "Create Position" },
  { href: "/my-positions", label: "My Positions" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/strategy-lab", label: "Strategy Lab" },
  { href: "/automation", label: "Automation" },
  { href: "/rebalance", label: "Rebalance" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" }
];

function HamburgerIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-6 w-6", className)}
      aria-hidden
    >
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-6 w-6", className)}
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function HamburgerNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md p-2 text-slate-300 hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-500"
        aria-label="メニューを開く"
        aria-expanded={open}
      >
        <HamburgerIcon />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setOpen(false)}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            role="button"
            tabIndex={0}
            aria-label="メニューを閉じる"
          />
          <aside
            className="fixed left-0 top-0 z-50 flex h-full w-72 flex-col border-r border-slate-800 bg-slate-950 shadow-xl"
            aria-modal="true"
            aria-label="メニュー"
          >
            <div className="flex items-center justify-between border-b border-slate-800 p-4">
              <span className="text-sm font-semibold text-slate-200">Coin Pool</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                aria-label="メニューを閉じる"
              >
                <CloseIcon />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-2">
              <ul className="space-y-0.5">
                {MENU_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className={cn(
                        "block rounded-md px-3 py-2.5 text-sm",
                        pathname === link.href
                          ? "bg-slate-800 text-white"
                          : "text-slate-300 hover:bg-slate-800/60 hover:text-slate-100"
                      )}
                      onClick={() => setOpen(false)}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        </>
      )}
    </div>
  );
}
