import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { GoogleTagManager } from "@next/third-parties/google";
import { Footer } from "@/components/Footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Buzz Media | Latest Buzz",
  description: "AIが盛り上がる話題をお届けするメディア",
  verification: {
    google: "wVe3xhfCcPiL9ALxwhMDasa4-Qc5U1x3aIKdhZYitxA",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col antialiased`}
      >
        <GoogleTagManager gtmId="GTM-M9T728HB" />
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
