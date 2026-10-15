import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EXA FOH Guest Order",
  description: "Guest-facing QR ordering for EXA FOH."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
