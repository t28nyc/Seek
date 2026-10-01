import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Peek — UK Pokémon TCG stock',
  description: 'Live stock, sales and upcoming drops for Pokémon TCG across UK retailers.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="antialiased">{children}</body>
    </html>
  );
}
