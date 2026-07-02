import type { ReactNode } from "react";
import "./globals.css";
import { BottomNav } from "../components/BottomNav";

export const metadata = {
  title: "HexArena",
  description: "Hex-Othello matches on Celo, playable inside MiniPay.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-arena-bg pb-20">
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
