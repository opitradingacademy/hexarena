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
      <head>
        <meta
          name="talentapp:project_verification"
          content="d41910c8625aadfb7a60c91ae93f114f24c3f497feefccdfcae33a08d925f9b7cd5ad2c17a302297d9622242a684dda116463dcbb46199d03dac26e3ee425147"
        />
      </head>
      <body className="min-h-screen bg-arena-bg pb-20">
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
