import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AudioPlayer from "@/components/AudioPlayer";
import PlayerProvider from "@/components/player/PlayerProvider";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const viewport: Viewport = {
  themeColor: "#ff8c00",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://melorimusic.org"),
  title: "MELORI MUSIC",
  description:
    "Independent music from Karl Ray, KAEL R, Gloria Joy Rivers, Gbenga Yakubu, and more. Stream, download and support independent artists on Melori Music.",
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    title: "MELORI MUSIC",
    description: "Stream freely. Support directly. Create endlessly.",
    images: ["/images/og-image.png"],
    type: "website",
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
