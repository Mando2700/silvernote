import { route, symbolSchema } from '@/lib/api';
import { pitchFacts } from '@/lib/pitch';
import { getCompanyProfile } from '@/lib/services/market';

export const dynamic = 'force-dynamic';

/** Company facts for the thesis PDF: profile details for the key-data table and filed financials. */
export const GET = route<{ symbol: string }>(async ({ params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const [profile, facts] = await Promise.all([getCompanyProfile(symbol).catch(() => null), pitchFacts(symbol).catch(() => null)]);
  return {
    profile: profile
      ? {
          name: profile.name,
          description: profile.description,
          exchange: profile.exchange,
          country: profile.country,
          website: profile.website,
          ceo: profile.ceo,
          employees: profile.employees,
          high52: profile.high52,
          low52: profile.low52,
          forwardPE: profile.forwardPE,
          dividendYield: profile.dividendYield,
        }
      : null,
    facts,
  };
});
