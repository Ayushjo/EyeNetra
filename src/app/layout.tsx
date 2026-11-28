import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Geist has no Devanagari glyphs: Hindi falls through to this font instead
// of whatever the device has, so the kiosk looks the same everywhere.
const devanagari = Noto_Sans_Devanagari({
  variable: "--font-devanagari",
  subsets: ["devanagari"],
  weight: "variable",
});

export const metadata: Metadata = {
  title: "EyeNetra — Virtual Eyewear Try-On",
  description:
    "Web-based virtual try-on for eyewear with real-time webcam AR.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="hi">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${devanagari.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
