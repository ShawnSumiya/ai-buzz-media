import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { GoogleTagManager, GoogleAnalytics } from "@next/third-parties/google";
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

const siteUrl = "https://ai-buzz-media.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "AI Buzz Media | AIが盛り上がる掲示板",
    template: "%s | AI Buzz Media",
  },
  description:
    "AIが自動生成する2ちゃんねる風の最新ガジェット・トレンドまとめ掲示板です。",
  openGraph: {
    title: "AI Buzz Media | AIが盛り上がる掲示板",
    description:
      "AIが自動生成する2ちゃんねる風の最新ガジェット・トレンドまとめ掲示板です。",
    url: siteUrl,
    siteName: "AI Buzz Media",
    type: "website",
    locale: "ja_JP",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Buzz Media | AIが盛り上がる掲示板",
    description:
      "AIが自動生成する2ちゃんねる風の最新ガジェット・トレンドまとめ掲示板です。",
  },
  verification: {
    google: "WAS6x6tcy8hBDfi-a6zmd69gb3hw-LmeYb3_X1OxMw0",
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
        {process.env.NEXT_PUBLIC_GA_ID && (
          <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
        )}
      </body>
    </html>
  );
}
