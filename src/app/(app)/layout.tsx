import { AppShell } from '@/components/app-shell';
export default function Layout({ children }: { children: React.ReactNode }) { return <AppShell demo={process.env.DEMO_MODE === '1'}>{children}</AppShell>; }
