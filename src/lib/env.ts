import 'server-only';

function read(name: string) {
  return process.env[name]?.trim() ?? '';
}

export const env = {
  get databaseUrl() {
    return read('DATABASE_URL');
  },
  get supabaseUrl() {
    return read('NEXT_PUBLIC_SUPABASE_URL');
  },
  get supabaseAnonKey() {
    return read('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  },
  get ownerEmail() {
    return read('OWNER_EMAIL').toLowerCase();
  },
  get secUserAgent() {
    return read('SEC_USER_AGENT') || 'SilverNote personal research tool (contact@example.com)';
  },
  get finnhubKey() {
    return read('FINNHUB_API_KEY');
  },
  get fmpKey() {
    return read('FMP_API_KEY');
  },
  get xaiKey() {
    return read('XAI_API_KEY');
  },
  /** Deep model: the chat's Thinking mode and long-form drafting. */
  get xaiModel() {
    return read('XAI_MODEL') || 'grok-4';
  },
  /** Default chat model. */
  get xaiFastModel() {
    return read('XAI_FAST_MODEL') || 'grok-4-fast-reasoning';
  },
  /** Fast mode: no reasoning pass, paired with trimmed context. */
  get xaiFastLiteModel() {
    return read('XAI_FAST_LITE_MODEL') || 'grok-4-fast-non-reasoning';
  },
  /** Model used to read portfolio photos; must accept image input. */
  get xaiVisionModel() {
    return read('XAI_VISION_MODEL') || read('XAI_MODEL') || 'grok-4';
  },
};

export function isAuthEnabled() {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}

/** Non-secret summary of what is configured, safe to send to the browser. */
export function getConfigStatus() {
  return {
    database: env.databaseUrl ? 'supabase' : 'local',
    auth: isAuthEnabled() ? 'supabase' : 'local',
    providers: {
      nasdaq: true,
      sec: true,
      fred: true,
      finnhub: Boolean(env.finnhubKey),
      fmp: Boolean(env.fmpKey),
    },
    ai: { configured: Boolean(env.xaiKey), model: env.xaiModel },
    secUserAgentCustomized: Boolean(read('SEC_USER_AGENT')),
  } as const;
}

export type ConfigStatus = ReturnType<typeof getConfigStatus>;
