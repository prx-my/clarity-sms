type Environment = Record<string, string | undefined>;

export function productionDeployment(env: Environment = process.env) {
  return env.VERCEL_ENV === 'production' || env.AI_DEPLOYMENT_MODE === 'production';
}

// Report variable names and requirements only. Never include supplied values.
export function publicUrlIssue(value: string | undefined, protocol: 'https:' | 'wss:') {
  if (!value) return 'required';
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.protocol !== protocol || url.username || url.password || url.search || url.hash) return `use ${protocol} without credentials, query or fragment`;
    if (!host.includes('.') || host === 'localhost' || /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host) || /(^|\.)example\.(com|org|net)$/.test(host) || /^[\d.]+$/.test(host) || host.includes(':')) return 'use a public DNS hostname';
    if (/(^|\.)(ngrok\.io|ngrok\.app|ngrok\.dev|ngrok-free\.app|ngrok-free\.dev|trycloudflare\.com|loca\.lt)$/.test(host)) return 'temporary demo tunnels are not production hosts';
    return null;
  } catch { return 'use a valid public URL'; }
}

export function productionAiIssues(env: Environment = process.env) {
  if (!productionDeployment(env)) return [];
  const issues: string[] = [];
  for (const [key, protocol] of [['APP_URL', 'https:'], ['AI_WEBSOCKET_PUBLIC_URL', 'wss:']] as const) {
    const issue = publicUrlIssue(env[key], protocol);
    if (issue) issues.push(`${key} (${issue})`);
  }
  if (env.APP_URL) { try { if (new URL(env.APP_URL).pathname !== '/') issues.push('APP_URL (use the application origin without a path)'); } catch { /* Reported above. */ } }
  if (env.AI_PROXY_APP_URL) issues.push('AI_PROXY_APP_URL (local demo proxy must be unset in production)');
  if(env.AI_GATEWAY_MODE&& !['standalone','vercel'].includes(env.AI_GATEWAY_MODE))issues.push('AI_GATEWAY_MODE (use standalone or vercel)');
  if(env.AI_GATEWAY_MODE==='vercel'){
    try{const app=new URL(env.APP_URL||''),relay=new URL(env.AI_WEBSOCKET_PUBLIC_URL||'');if(app.host!==relay.host||relay.pathname!=='/api/twilio/ai/relay')issues.push('AI_WEBSOCKET_PUBLIC_URL (Vercel mode requires the application host and /api/twilio/ai/relay path)');}catch{/* URL errors reported above. */}
  }
  if (env.DEMO_MODE === '1') issues.push('DEMO_MODE (must be disabled for production AI)');
  return issues;
}

export function productionEnvironmentReport(env: Environment = process.env) {
  const errors: string[] = [], warnings: string[] = [];
  const required = ['DATABASE_URL', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'TWILIO_API_KEY_SID', 'TWILIO_API_KEY_SECRET', 'TWILIO_TWIML_APP_SID', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'APP_URL'];
  for (const key of required) if (!env[key]?.trim()) errors.push(`${key} (required)`);
  if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32) errors.push('SESSION_SECRET (at least 32 characters)');
  const appIssue = publicUrlIssue(env.APP_URL, 'https:');
  if (appIssue) errors.push(`APP_URL (${appIssue})`);
  if (env.DEMO_MODE === '1') errors.push('DEMO_MODE (must be disabled in production)');
  if (env.AI_VOICE_ENABLED && !['0', '1'].includes(env.AI_VOICE_ENABLED)) errors.push('AI_VOICE_ENABLED (use 0 or 1)');
  const aiEnabled = env.AI_VOICE_ENABLED === '1';
  if (aiEnabled) {
    errors.push(...productionAiIssues({ ...env, AI_DEPLOYMENT_MODE: 'production' }));
    if (env.AI_LLM_PROVIDER && !['groq', 'openai'].includes(env.AI_LLM_PROVIDER)) errors.push('AI_LLM_PROVIDER (use groq or openai)');
    const key = env.AI_LLM_PROVIDER === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY';
    if (!env[key]?.trim()) errors.push(`${key} (required for selected provider)`);
    if (!env.AI_GATEWAY_SECRET || env.AI_GATEWAY_SECRET.length < 32) errors.push('AI_GATEWAY_SECRET (at least 32 characters, identical on app and gateway)');
    if (env.AI_CONVERSATION_RELAY_ACKNOWLEDGED !== '1') errors.push('AI_CONVERSATION_RELAY_ACKNOWLEDGED (verify Twilio onboarding first)');
    if (!env.AI_DEMO_ALLOWED_NUMBERS?.trim()) warnings.push('AI_DEMO_ALLOWED_NUMBERS is empty; outbound AI calls are denied');
    warnings.push('Run authenticated provider readiness after deployment; variable validation does not verify credentials or gateway connectivity');
  } else warnings.push('AI voice is disabled; gateway and LLM variables are optional until activation');
  return { ready: errors.length === 0, aiEnabled, errors: [...new Set(errors)], warnings };
}
