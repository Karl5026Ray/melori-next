import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AudioPlayer from "@/components/AudioPlayer";
import PlayerProvider from "@/components/player/PlayerProvider";
import { SITE_URL } from "@/lib/site";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const viewport: Viewport = {
  themeColor: "#ff8c00",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "MELORI MUSIC",
    template: "%s · MELORI MUSIC",
  },
  description:
    "Independent music from Karl Ray, KAIEL R, Gloria Joy Rivers, Gbenga Yakubu, and more. Stream, download and support independent artists on Melori Music.",
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    siteName: "MELORI MUSIC",
    title: "MELORI MUSIC",
    description: "Stream freely. Support directly. Create endlessly.",
    images: [
      {
        url: "/images/og-image.png",
        width: 1200,
        height: 630,
        alt: "MELORI MUSIC",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "MELORI MUSIC",
    description: "Stream freely. Support directly. Create endlessly.",
    images: ["/images/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans bg-brand-background text-text-primary min-h-screen flex flex-col">
        <PlayerProvider>
          <Header />
          <main className="flex-1 pb-24">{children}</main>
          <Footer />
          <AudioPlayer />
        </PlayerProvider>
      </body>
    </html>
  );
}
