import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Toaster } from 'sonner';
import './globals.css';
const inter = localFont({ src: '../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', display: 'swap', weight: '100 900' });
export const metadata: Metadata = { title: 'Clarity SMS', description: 'A clear, simple SMS inbox' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en" className={inter.className}><body>{children}<Toaster position="bottom-right" duration={4000} richColors closeButton /></body></html>; }
