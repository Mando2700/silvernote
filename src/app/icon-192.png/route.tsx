import { brandIcon } from '@/lib/brand-icon';

export const dynamic = 'force-static';

export function GET() {
  return brandIcon(192);
}
