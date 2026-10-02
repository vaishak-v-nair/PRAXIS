import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./product.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "PRAXIS · Project Review",
  description: "Review your project locally, run isolated checks, and turn source-backed findings into a repair plan.",
  icons: { icon: "/praxis-mark.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${geist.variable} ${mono.variable}`} suppressHydrationWarning><body>{children}
    <Script id="praxis-appearance" strategy="beforeInteractive">{`try { document.documentElement.dataset.theme = localStorage.getItem('praxis-appearance') === 'light' ? 'light' : 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }`}</Script>
  </body></html>;
}
