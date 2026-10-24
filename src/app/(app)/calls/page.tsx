'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Clock3, Headphones, Phone, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { Badge, Button, Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/client-api';
import { openDialer } from '@/lib/dialer';
import { displayPhone } from '@/lib/phone';

type VoiceCall = {
  sid: string;
  to: string;
  status: string;
  duration: number;
  createdAt: string | null;
};

function readableStatus(status: string) {
  return status.replace(/-/g, ' ').replace(/^./, letter => letter.toUpperCase());
}

function duration(seconds: number) {
  if (!seconds) return '—';
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export default function CallsPage() {
  const [items, setItems] = useState<VoiceCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    try {
      const result = await api<{ items: VoiceCall[] }>('/api/voice/calls');
      setItems(result.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load calls');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = () => window.setTimeout(() => load(true), 1600);
    window.addEventListener('clarity:call-ended', refresh);
    return () => window.removeEventListener('clarity:call-ended', refresh);
  }, [load]);

  return <>
    <PageHeader title="Calls" subtitle="Call people from your connected Twilio number"
      action={<Button variant="primary" onClick={() => openDialer()}><Phone size={15} />New call</Button>} />
    <div className="content-page calls-page">
      <section className="calls-hero">
        <div className="calls-hero-icon"><Headphones size={25} strokeWidth={1.7} /></div>
        <div><span className="calls-eyebrow">BROWSER CALLING</span>
          <h2>Your desk phone, in Clarity.</h2>
          <p>Dial a number or call a contact. Keep this tab open and allow microphone access when your browser asks.</p>
        </div>
        <Button onClick={() => openDialer()}><Phone size={15} />Open dialer</Button>
      </section>
      <section className="table-card calls-list" aria-label="Recent outgoing calls">
        <div className="calls-list-head"><div><h2>Recent calls</h2><p>Outgoing calls from your Twilio number</p></div>
          <Button size="sm" variant="ghost" onClick={() => load(true)} disabled={refreshing} aria-label="Refresh calls">
            <RefreshCw size={15} />Refresh</Button>
        </div>
        {loading ? <div className="calls-loading">{Array.from({ length: 4 }, (_, index) =>
          <Skeleton key={index} className="h-[46px] mb-3" />)}</div>
          : items.length ? <div className="calls-table-wrap"><table className="data-table">
            <thead><tr><th>To</th><th>When</th><th>Result</th><th>Duration</th><th></th></tr></thead>
            <tbody>{items.map(item => <tr key={item.sid}>
              <td><span className="calls-destination"><ArrowUpRight size={15} />{displayPhone(item.to)}</span></td>
              <td>{item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}</td>
              <td><Badge tone={item.status === 'completed' ? 'success' : ['failed', 'busy', 'no-answer'].includes(item.status) ? 'danger' : 'neutral'}>
                {readableStatus(item.status)}</Badge></td>
              <td><span className="calls-duration"><Clock3 size={13} />{duration(item.duration)}</span></td>
              <td><Button size="sm" variant="ghost" onClick={() => openDialer(item.to)}><Phone size={14} />Call again</Button></td>
            </tr>)}</tbody>
          </table></div> : <EmptyState icon={<Phone size={21} />} title="No calls yet"
            description="Your outgoing call history will appear here after your first call."
            action={<Button variant="primary" onClick={() => openDialer()}><Phone size={14} />Open dialer</Button>} />}
      </section>
    </div>
  </>;
}
