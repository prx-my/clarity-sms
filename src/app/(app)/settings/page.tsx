import { SettingsClient } from '@/components/settings-client';
export const runtime = 'nodejs';
export default function SettingsPage(){const sid=process.env.TWILIO_ACCOUNT_SID||'';return <SettingsClient number={process.env.TWILIO_PHONE_NUMBER||'Not configured'} sid={sid?`${sid.slice(0,4)}••••••••${sid.slice(-4)}`:'Not configured'} appUrl={process.env.APP_URL||'http://localhost:3000'}/>}
