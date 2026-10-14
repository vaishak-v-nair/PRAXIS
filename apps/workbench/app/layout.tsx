import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./product.css";
import "./workspace.css";
import "./aurora.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "PRAXIS · AI Project Engineer",
  description: "Understand a real project, inspect evidence-backed findings, run authorized checks, and plan the next engineering step locally.",
  icons: { icon: "/praxis-mark.png" },
  other: { "praxis-review-surface": "workbench-v1" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${geist.variable} ${mono.variable}`} suppressHydrationWarning><body>{children}
    <Script id="praxis-appearance" strategy="beforeInteractive">{`try { document.documentElement.dataset.theme = localStorage.getItem('praxis-appearance') === 'dark' ? 'dark' : 'light'; } catch { document.documentElement.dataset.theme = 'light'; }`}</Script>
  </body></html>;
}
