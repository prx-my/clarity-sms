'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, ChartNoAxesCombined, Inbox, MessageSquareText, Phone, Plus, Send, Settings, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/client-api';
import { normalizePhone } from '@/lib/phone';
import { VoiceDialer } from './voice-dialer';
import { Button, Dialog, Input, Textarea } from './ui/primitives';

const links = [
  { href: '/', label: 'Inbox', icon: Inbox },
  { href: '/calls', label: 'Calls', icon: Phone },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/analytics', label: 'Analytics', icon: ChartNoAxesCombined },
  { href: '/monitoring', label: 'Monitoring', icon: Activity },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function openNewMessage() { window.dispatchEvent(new Event('clarity:new')); }

export function AppShell({ children, demo = false }: { children: React.ReactNode; demo?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('clarity:new', show);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('clarity:new', show);
      window.removeEventListener('keydown', key);
    };
  }, []);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!to.trim() || !body.trim()) return;
    setSending(true);
    try {
      const data = await api<{ conversationId: string }>('/api/messages', {
        method: 'POST', body: JSON.stringify({ to, name, body }),
      });
      toast.success('Message sent');
      setOpen(false);
      setTo(''); setName(''); setBody('');
      window.location.assign(`/?thread=${data.conversationId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send message');
    } finally { setSending(false); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/" className="brand" aria-label="Clarity SMS home">
        <span className="brand-mark"><MessageSquareText size={16} /></span>
        <span className="brand-name">Clarity <span className="brand-suffix">SMS</span></span>
      </Link>
      <div className="nav-section-label">Workspace</div>
      <nav className="nav" aria-label="Main navigation">
        {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href}
          className={`nav-link ${pathname === href ? 'active' : ''}`}><Icon /><span>{label}</span></Link>)}
      </nav>
      <div className="sidebar-bottom"><span className="sidebar-status-dot" />
        <span>{demo ? 'Preview workspace' : 'Your private workspace'}</span>
      </div>
    </aside>
    <main className="main">
      {demo && <div className="demo-banner">Demo preview · Messages are simulated</div>}
      {children}
    </main>
    <VoiceDialer demo={demo} />
    <Dialog open={open} onOpenChange={setOpen} title="New message"
      description={demo ? 'Messages are simulated in this preview.' : 'Send a text from your Twilio number.'}>
      <form onSubmit={send}>
        <div className="field"><label htmlFor="new-to">Phone number</label>
          <Input id="new-to" type="tel" placeholder="+1 (555) 000-0000" value={to}
            onChange={event => setTo(event.target.value)} autoFocus required />
          <div className="field-hint">{normalizePhone(to)
            ? `Sending to ${normalizePhone(to)}` : 'Include country code for numbers outside the US.'}</div>
        </div>
        <div className="field"><label htmlFor="new-name">Name <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>optional</span></label>
          <Input id="new-name" placeholder="Contact name" value={name} onChange={event => setName(event.target.value)} />
        </div>
        <div className="field"><label htmlFor="new-body">Message</label>
          <Textarea id="new-body" rows={4} value={body} required placeholder="Write a message…"
            onChange={event => setBody(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault(); event.currentTarget.form?.requestSubmit();
            } }} />
          <div className="field-hint">{body.length > 160
            ? `${Math.ceil(body.length / 153)} SMS segments` : `${body.length}/160 characters`}</div>
        </div>
        <div className="dialog-actions">
          <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={sending || !normalizePhone(to) || !body.trim()}>
            <Send size={14} />{sending ? 'Sending…' : 'Send message'}
          </Button>
        </div>
      </form>
    </Dialog>
  </div>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</header>;
}

export function NewMessageButton({ label = 'New message' }: { label?: string }) {
  return <Button variant="primary" onClick={openNewMessage} aria-label={label}>
    <Plus size={15} /><span className="new-message-label">{label}</span>
  </Button>;
}
