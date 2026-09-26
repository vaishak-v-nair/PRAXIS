import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PRAXIS Workbench · Make your code worth shipping",
  description: "Understand your project's issues and repair them with a team of agents, locally.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
