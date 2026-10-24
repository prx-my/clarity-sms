'use client';

import { useEffect, useRef, useState } from 'react';
import type { Call, Device } from '@twilio/voice-sdk';
import { Delete, Mic, MicOff, Phone, PhoneOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/client-api';
import { normalizePhone } from '@/lib/phone';
import { Button, Input } from './ui/primitives';

type Phase = 'idle' | 'preparing' | 'dialing' | 'ringing' | 'connected' | 'ended' | 'error';
const keys = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', ''], ['#', ''],
];
const active = (phase: Phase) => ['preparing', 'dialing', 'ringing', 'connected'].includes(phase);

export function VoiceDialer({ demo = false }: { demo?: boolean }) {
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [muted, setMuted] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    const show = (event: Event) => {
      const requested = (event as CustomEvent<string>).detail;
      if (requested && !active(phase)) setNumber(requested);
      setOpen(true);
    };
    window.addEventListener('clarity:dial', show);
    return () => window.removeEventListener('clarity:dial', show);
  }, [phase]);

  useEffect(() => {
    if (!startedAt) return;
    const update = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  useEffect(() => () => {
    attemptRef.current += 1;
    deviceRef.current?.disconnectAll();
    deviceRef.current?.destroy();
  }, []);

  function dispose(device?: Device) {
    if (device && deviceRef.current !== device) return;
    callRef.current = null;
    deviceRef.current?.destroy();
    deviceRef.current = null;
  }

  function hangUp() {
    attemptRef.current += 1;
    callRef.current?.disconnect();
    deviceRef.current?.disconnectAll();
    dispose();
    setPhase('ended');
    setStartedAt(null);
    setMuted(false);
    window.dispatchEvent(new Event('clarity:call-ended'));
  }

  async function call() {
    const to = normalizePhone(number);
    if (!to || active(phase) || demo) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('A browser with microphone access is required to call.');
      setPhase('error');
      return;
    }

    const attempt = ++attemptRef.current;
    setNumber(to);
    setError('');
    setMuted(false);
    setElapsed(0);
    setStartedAt(null);
    setPhase('preparing');

    try {
      const { token } = await api<{ token: string }>('/api/voice/token', { method: 'POST' });
      if (attempt !== attemptRef.current) return;
      const { Device: VoiceDevice } = await import('@twilio/voice-sdk');
      if (attempt !== attemptRef.current) return;
      const device = new VoiceDevice(token, { tokenRefreshMs: 60_000 });
      deviceRef.current = device;
      device.on('tokenWillExpire', async () => {
        try {
          const refreshed = await api<{ token: string }>('/api/voice/token', { method: 'POST' });
          if (deviceRef.current === device) device.updateToken(refreshed.token);
        } catch {
          toast.error('Call authorization could not be refreshed');
        }
      });
      device.on('error', (cause: Error) => {
        if (deviceRef.current === device) setError(cause.message || 'Call failed');
      });

      setPhase('dialing');
      const connection = await device.connect({ params: { To: to } });
      if (attempt !== attemptRef.current) {
        connection.disconnect();
        device.destroy();
        return;
      }
      callRef.current = connection;
      connection.on('ringing', () => setPhase('ringing'));
      connection.on('accept', () => {
        setPhase('connected');
        setStartedAt(Date.now());
      });
      connection.on('mute', (value: boolean) => setMuted(value));
      connection.on('error', (cause: Error) => {
        connection.disconnect();
        dispose(device);
        setError(cause.message || 'Call failed');
        setPhase('error');
        setStartedAt(null);
      });
      const ended = () => {
        if (deviceRef.current !== device) return;
        dispose(device);
        setPhase('ended');
        setStartedAt(null);
        setMuted(false);
        window.dispatchEvent(new Event('clarity:call-ended'));
      };
      connection.on('disconnect', ended);
      connection.on('cancel', ended);
      connection.on('reject', ended);
      if (connection.status() === 'open') {
        setPhase('connected');
        setStartedAt(Date.now());
      } else if (connection.status() === 'ringing') {
        setPhase('ringing');
      } else if (connection.status() === 'closed') {
        ended();
      }
    } catch (cause) {
      if (attempt !== attemptRef.current) return;
      dispose();
      setPhase('error');
      setError(cause instanceof Error ? cause.message : 'Could not start call');
    }
  }

  function press(value: string) {
    if (phase === 'connected') {
      callRef.current?.sendDigits(value);
    } else if (!active(phase)) {
      setNumber(previous => previous + value);
    }
  }

  const duration = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const status = phase === 'preparing' ? 'Preparing microphone'
    : phase === 'dialing' ? 'Connecting call'
    : phase === 'ringing' ? 'Ringing'
    : phase === 'connected' ? `Call active · ${duration}`
    : phase === 'ended' ? 'Call ended'
    : phase === 'error' ? 'Call unavailable'
    : demo ? 'Preview only' : 'Ready to call';

  if (!open) return active(phase) ? (
    <button className="dialer-mini" onClick={() => setOpen(true)} aria-label="Open active call">
      <Phone size={16} /> {status}
    </button>
  ) : null;

  return <aside className="dialer-panel" aria-label="Phone dialer">
    <div className="dialer-head">
      <div className="dialer-mark"><Phone size={17} /></div>
      <div><h2>Dialer</h2><p>{status}</p></div>
      <button className="icon-button dialer-close" onClick={() => setOpen(false)} aria-label="Minimize dialer"><X size={17} /></button>
    </div>
    <div className="dialer-body">
      <label htmlFor="dialer-number">Phone number</label>
      <div className="dialer-number">
        <button type="button" className="dialer-plus" aria-label="Add country code"
          title="Add country code" disabled={active(phase)}
          onClick={() => setNumber(value => value.startsWith('+') ? value : `+${value}`)}>+</button>
        <Input id="dialer-number" type="tel" autoComplete="tel" value={number}
          onChange={event => setNumber(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); call(); } }}
          placeholder="+1 (555) 000-0000" disabled={active(phase)} />
        <button className="icon-button" aria-label="Delete last digit" disabled={active(phase) || !number}
          onClick={() => setNumber(value => value.slice(0, -1))}><Delete size={17} /></button>
      </div>
      <div className="dialer-help">{phase === 'connected' ? 'Use the keypad for phone menus.' : 'Include the country code.'}</div>
      <div className="dialer-keys">{keys.map(([digit, letters]) =>
        <button key={digit} type="button" onClick={() => press(digit)}
          disabled={phase === 'preparing' || phase === 'dialing' || phase === 'ringing'}>
          <span>{digit}</span><small>{letters || '\u00a0'}</small>
        </button>)}</div>
      {error && <p className="dialer-error" role="alert">{error}</p>}
      {demo && <p className="dialer-help">Calls use your connected Twilio number in the live workspace.</p>}
      <div className="dialer-actions">
        {active(phase) ? <>
          <Button onClick={() => callRef.current?.mute(!muted)} disabled={phase !== 'connected'}
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>
            {muted ? <MicOff size={16} /> : <Mic size={16} />}{muted ? 'Unmute' : 'Mute'}
          </Button>
          <Button className="dialer-hangup" onClick={hangUp}><PhoneOff size={16} />End call</Button>
        </> : <Button variant="primary" className="dialer-call" onClick={call}
          disabled={demo || !normalizePhone(number)}><Phone size={16} />Call now</Button>}
      </div>
    </div>
  </aside>;
}
