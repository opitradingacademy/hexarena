import type { ReactNode } from "react";

export const metadata = {
  title: "HexArena",
  description: "Hex-Othello matches on Celo, playable inside MiniPay.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
