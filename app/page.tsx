// app/page.tsx
// Switch trang chủ dựa trên setting home_mode trong DB
// - "showcase" (default) → trang marketing (AI Skill Hub branding)
// - "developer" → trang technical skill reference (RPA.Doc branding)

import { getSetting } from '@/lib/settings';
import HomeNew from './_home/HomeNew';
import HomeLegacy from './_home/HomeLegacy';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const mode = await getSetting('home_mode');

  if (mode === 'developer') {
    return <HomeNew />;
  }
  return <HomeLegacy />;
}
