import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "War Room Allocator \u2014 by Aarit Shah",
  description: "A clean stock allocation table generator for rupee portfolios."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
