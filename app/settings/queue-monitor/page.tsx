// app/settings/queue-monitor/page.tsx
// Redirect to unified worker-groups page (Queue Monitor tab)
import { redirect } from 'next/navigation';

export default function QueueMonitorRedirect() {
  redirect('/settings/worker-groups');
}
