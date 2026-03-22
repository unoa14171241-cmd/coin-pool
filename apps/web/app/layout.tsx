import "./globals.css";
import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";
import { Providers } from "@/providers";
import { Nav } from "@/components/nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { GlobalActorContextBanner } from "@/components/layout/global-actor-context-banner";
import { KeyboardShortcutsHelp } from "@/components/layout/keyboard-shortcuts-help";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Non-custodial LP management support tool for concentrated liquidity."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <main className="mx-auto min-h-screen max-w-6xl p-4 pb-24 md:p-6 md:pb-6">
            <header className="mb-5">
              <h1 className="text-2xl font-bold md:text-3xl">{APP_NAME}</h1>
              <p className="text-sm text-slate-400 md:text-slate-600">
                Investment support tool only. Not an investment management service.
              </p>
            </header>
            <div className="hidden md:block">
              <Nav />
            </div>
            <GlobalActorContextBanner />
            {children}
          </main>
          <MobileNav />
          <KeyboardShortcutsHelp />
        </Providers>
      </body>
    </html>
  );
}
