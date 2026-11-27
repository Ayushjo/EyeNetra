import type { Metadata } from "next";
import { Geist, Geist_Mono, Mukta, Tiro_Devanagari_Hindi } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Kiosk type: Mukta (Devanagari + Latin UI) and Tiro Devanagari Hindi (display serif).
const mukta = Mukta({
  variable: "--font-mukta",
  subsets: ["devanagari", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const tiro = Tiro_Devanagari_Hindi({
  variable: "--font-tiro",
  subsets: ["devanagari", "latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "KG Optic",
  description: "KG Optic — your optical consultant and virtual try-on.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="hi">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${mukta.variable} ${tiro.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
