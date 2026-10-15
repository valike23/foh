import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EXA FOH Dashboard",
  description: "Local-network-first front-of-house dashboard for EXA events."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
