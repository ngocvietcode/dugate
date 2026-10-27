// app/settings/worker-groups/page.tsx
// Admin page: Worker Groups management + Queue Monitor (unified)
'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkerGroup {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  profileCount: number;
}

interface Profile {
  id: string;
  name: string;
  prefix: string;
  status: string;
  workerGroup?: string | null;
}

interface QueueStats {
  name: string;
  type: 'pipeline' | 'workflow-steps';
  group: string | null;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
}

interface JobEntry {
  id: string;
  name: string;
  state: string;
  createdAt: string | null;
  processedAt: string | null;
  data: { operationId?: string; profileName?: string; type?: string };
}

type TabId = 'groups' | 'monitor';

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WorkerGroupsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('groups');

  return (
    <main className="max-w-7xl mx-auto px-6 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-zinc-100 mb-2">
          Worker Groups & Queue Monitor
        </h1>
        <p className="text-slate-500 dark:text-zinc-400 text-base">
          Quản lý worker groups, gắn profiles vào queues riêng biệt, và giám sát trạng thái jobs.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b dark:border-zinc-700">
        <button
          onClick={() => setActiveTab('groups')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'groups'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200'
          }`}
        >
          Worker Groups
        </button>
        <button
          onClick={() => setActiveTab('monitor')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'monitor'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200'
          }`}
        >
          Queue Monitor
        </button>
      </div>

      {activeTab === 'groups' && <WorkerGroupsTab />}
      {activeTab === 'monitor' && <QueueMonitorTab />}
    </main>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1: Worker Groups Management
// ═══════════════════════════════════════════════════════════════════════════════

function WorkerGroupsTab() {
  const [groups, setGroups] = useState<WorkerGroup[]>([]);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Create form
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  // Rename
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  // Delete
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Selected group detail
  const [selectedGroup, setSelectedGroup] = useState<WorkerGroup | null>(null);
  const [groupProfiles, setGroupProfiles] = useState<Profile[]>([]);

  // Assign
  const [assignProfileId, setAssignProfileId] = useState('');

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch('/api/internal/worker-groups');
      if (!res.ok) throw new Error('Failed to fetch worker groups');
      const data = await res.json();
      setGroups(data.workerGroups);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAllProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/internal/apikeys');
      if (!res.ok) return;
      const data = await res.json();
      setAllProfiles(data.apiKeys || []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchGroups();
    fetchAllProfiles();
  }, [fetchGroups, fetchAllProfiles]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !newName.trim()) return;
    setCreateError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/internal/worker-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setCreateError(data.error || 'Failed to create');
        return;
      }
      setNewName('');
      fetchGroups();
    } catch {
      setCreateError('Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRename = async (id: string) => {
    if (isSubmitting) return;
    if (!renameName.trim()) {
      setRenameError('Name cannot be empty');
      return;
    }
    setRenameError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/internal/worker-groups/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setRenameError(data.error || 'Failed to rename');
        return;
      }
      setRenameId(null);
      setRenameName('');
      fetchGroups();
      if (selectedGroup?.id === id) loadGroupProfiles({ ...selectedGroup, name: renameName.trim() } as WorkerGroup);
    } catch {
      setRenameError('Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (group: WorkerGroup) => {
    if (isSubmitting) return;
    setDeleteError(null);
    if (group.profileCount > 0) {
      setDeleteError(`Cannot delete "${group.name}" — ${group.profileCount} profile(s) still assigned.`);
      return;
    }
    if (!confirm(`Delete worker group "${group.name}"?`)) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/internal/worker-groups/${group.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setDeleteError(data.error || 'Failed to delete');
        return;
      }
      if (selectedGroup?.id === group.id) setSelectedGroup(null);
      fetchGroups();
    } catch {
      setDeleteError('Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const loadGroupProfiles = async (group: WorkerGroup) => {
    setSelectedGroup(group);
    try {
      const res = await fetch(`/api/internal/worker-groups/${group.id}/profiles`);
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setGroupProfiles(data.profiles);
    } catch {
      setGroupProfiles([]);
    }
  };

  const handleAssign = async () => {
    if (!assignProfileId || !selectedGroup || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/internal/apikeys/${assignProfileId}/worker-group`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerGroup: selectedGroup.name }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to assign');
        return;
      }
      setAssignProfileId('');
      loadGroupProfiles(selectedGroup);
      fetchGroups(); // refresh profile counts
    } catch {
      alert('Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnassign = async (profileId: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/internal/apikeys/${profileId}/worker-group`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerGroup: null }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to unassign');
        return;
      }
      if (selectedGroup) loadGroupProfiles(selectedGroup);
      fetchGroups();
    } catch {
      alert('Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Profiles available for assignment (not already in selected group)
  const availableProfiles = allProfiles.filter(
    (p) => !groupProfiles.some((gp) => gp.id === p.id)
  );

  if (loading) return <p className="text-slate-500">Loading...</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Groups list */}
      <div>
        <h2 className="text-lg font-semibold mb-4 dark:text-zinc-100">Groups</h2>

        {/* Create form */}
        <form onSubmit={handleCreate} className="flex gap-2 mb-4">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="group-name (lowercase, 2-50 chars)"
            className="flex-1 px-3 py-2 border rounded-md text-sm dark:bg-zinc-800 dark:border-zinc-700"
          />
          <button
            type="submit"
            disabled={isSubmitting || !newName.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </form>
        {createError && <p className="text-red-600 text-xs mb-3">{createError}</p>}
        {deleteError && <p className="text-red-600 text-xs mb-3">{deleteError}</p>}

        {/* Groups */}
        {groups.length === 0 ? (
          <div className="text-center py-8 border rounded-lg dark:border-zinc-700">
            <p className="text-slate-500 dark:text-zinc-400 text-sm">No worker groups yet.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {groups.map((group) => (
              <div
                key={group.id}
                className={`flex items-center justify-between p-3 border rounded-md cursor-pointer transition-colors ${
                  selectedGroup?.id === group.id
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-600'
                    : 'dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800/50'
                }`}
                onClick={() => loadGroupProfiles(group)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {renameId === group.id ? (
                    <div className="flex gap-1 items-center">
                      <input
                        type="text"
                        value={renameName}
                        onChange={(e) => setRenameName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="px-2 py-1 border rounded text-xs dark:bg-zinc-800 dark:border-zinc-700 w-32"
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRename(group.id); }}
                        disabled={isSubmitting}
                        className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setRenameId(null); setRenameError(null); }}
                        className="text-xs text-slate-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="font-mono text-sm font-medium text-slate-900 dark:text-zinc-100 truncate">{group.name}</span>
                      <span className="text-xs text-slate-400 dark:text-zinc-500 shrink-0">({group.profileCount})</span>
                    </>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); setRenameId(group.id); setRenameName(group.name); }}
                    className="text-xs text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200 px-1"
                  >
                    Rename
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(group); }}
                    disabled={isSubmitting}
                    className="text-xs text-red-500 hover:text-red-700 px-1 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {renameError && <p className="text-red-600 text-xs mt-2">{renameError}</p>}
      </div>

      {/* Right: Selected group detail + assign */}
      <div>
        {selectedGroup ? (
          <div className="border rounded-lg p-4 dark:border-zinc-700">
            <h2 className="text-lg font-semibold mb-1 dark:text-zinc-100">
              {selectedGroup.name}
            </h2>
            <p className="text-xs text-slate-400 dark:text-zinc-500 mb-4">
              Queue: <code className="bg-slate-100 dark:bg-zinc-800 px-1 rounded">pipeline.{selectedGroup.name}</code>
            </p>

            {/* Assign profile */}
            <div className="flex gap-2 mb-4">
              <select
                value={assignProfileId}
                onChange={(e) => setAssignProfileId(e.target.value)}
                className="flex-1 px-3 py-2 border rounded-md text-sm dark:bg-zinc-800 dark:border-zinc-700"
              >
                <option value="">— Assign a profile —</option>
                {availableProfiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.prefix}...)</option>
                ))}
              </select>
              <button
                onClick={handleAssign}
                disabled={!assignProfileId || isSubmitting}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Assign
              </button>
            </div>

            {/* Assigned profiles list */}
            <h3 className="text-sm font-medium text-slate-700 dark:text-zinc-300 mb-2">
              Assigned Profiles ({groupProfiles.length})
            </h3>
            {groupProfiles.length === 0 ? (
              <p className="text-slate-400 dark:text-zinc-500 text-xs">No profiles assigned.</p>
            ) : (
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {groupProfiles.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-slate-50 dark:hover:bg-zinc-800/50">
                    <div className="flex items-center gap-2">
                      <span className="dark:text-zinc-200">{p.name}</span>
                      <span className="text-xs text-slate-400">({p.prefix}...)</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        p.status === 'active'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}>
                        {p.status}
                      </span>
                    </div>
                    <button
                      onClick={() => handleUnassign(p.id)}
                      disabled={isSubmitting}
                      className="text-xs text-red-500 hover:text-red-700 hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="border rounded-lg p-8 text-center dark:border-zinc-700">
            <p className="text-slate-400 dark:text-zinc-500 text-sm">
              Select a group to view details and manage profile assignments.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2: Queue Monitor
// ═══════════════════════════════════════════════════════════════════════════════

function QueueMonitorTab() {
  const [queues, setQueues] = useState<QueueStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);
  const [selectedState, setSelectedState] = useState<string>('waiting');
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsPage, setJobsPage] = useState(1);

  const fetchQueues = useCallback(async () => {
    try {
      const res = await fetch('/api/internal/queue-monitor');
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to fetch queue stats');
        setQueues([]);
        return;
      }
      const data = await res.json();
      setQueues(data.queues);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection error');
      setQueues([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    fetchQueues();
    const interval = setInterval(fetchQueues, 10_000);
    return () => clearInterval(interval);
  }, [fetchQueues]);

  const fetchJobs = async (queueName: string, state: string, page: number) => {
    setJobsLoading(true);
    try {
      const res = await fetch(
        `/api/internal/queue-monitor/${encodeURIComponent(queueName)}/jobs?state=${state}&page=${page}&pageSize=50`
      );
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs);
    } catch {
      setJobs([]);
    } finally {
      setJobsLoading(false);
    }
  };

  const handleQueueClick = (queueName: string) => {
    setSelectedQueue(queueName);
    setSelectedState('waiting');
    setJobsPage(1);
    fetchJobs(queueName, 'waiting', 1);
  };

  const handleStateChange = (state: string) => {
    setSelectedState(state);
    setJobsPage(1);
    if (selectedQueue) fetchJobs(selectedQueue, state, 1);
  };

  const handlePageChange = (page: number) => {
    setJobsPage(page);
    if (selectedQueue) fetchJobs(selectedQueue, selectedState, page);
  };

  if (loading) return <p className="text-slate-500">Loading...</p>;

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-700 dark:text-red-300 text-sm font-medium">Connection Error</p>
          <p className="text-red-600 dark:text-red-400 text-xs">{error}</p>
        </div>
      )}

      <p className="text-xs text-slate-400 dark:text-zinc-500 mb-3">Auto-refreshes every 10s</p>

      {/* Queue table */}
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b dark:border-zinc-700">
              <th className="text-left py-2 px-3 font-medium text-slate-600 dark:text-zinc-400">Queue</th>
              <th className="text-left py-2 px-3 font-medium text-slate-600 dark:text-zinc-400">Group</th>
              <th className="text-right py-2 px-3 font-medium text-yellow-600">Waiting</th>
              <th className="text-right py-2 px-3 font-medium text-blue-600">Active</th>
              <th className="text-right py-2 px-3 font-medium text-green-600">Completed</th>
              <th className="text-right py-2 px-3 font-medium text-red-600">Failed</th>
              <th className="text-right py-2 px-3 font-medium text-orange-600">Delayed</th>
            </tr>
          </thead>
          <tbody>
            {queues.map((q) => (
              <tr
                key={q.name}
                onClick={() => handleQueueClick(q.name)}
                className={`border-b dark:border-zinc-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-zinc-800/50 ${
                  selectedQueue === q.name ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                }`}
              >
                <td className="py-2 px-3 font-mono text-xs text-slate-900 dark:text-zinc-100">{q.name}</td>
                <td className="py-2 px-3 text-xs text-slate-500 dark:text-zinc-400">{q.group ?? 'default'}</td>
                <td className="py-2 px-3 text-right text-xs">{q.counts.waiting >= 0 ? q.counts.waiting : '—'}</td>
                <td className="py-2 px-3 text-right text-xs">{q.counts.active >= 0 ? q.counts.active : '—'}</td>
                <td className="py-2 px-3 text-right text-xs">{q.counts.completed >= 0 ? q.counts.completed : '—'}</td>
                <td className="py-2 px-3 text-right text-xs">{q.counts.failed >= 0 ? q.counts.failed : '—'}</td>
                <td className="py-2 px-3 text-right text-xs">{q.counts.delayed >= 0 ? q.counts.delayed : '—'}</td>
              </tr>
            ))}
            {queues.length === 0 && !error && (
              <tr><td colSpan={7} className="py-6 text-center text-slate-400 text-sm">No queues found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Job detail panel */}
      {selectedQueue && (
        <div className="border rounded-lg p-4 dark:border-zinc-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold dark:text-zinc-100">
              Jobs in <code className="bg-slate-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-xs">{selectedQueue}</code>
            </h3>
            <div className="flex gap-1">
              {['waiting', 'active', 'completed', 'failed', 'delayed'].map((state) => (
                <button
                  key={state}
                  onClick={() => handleStateChange(state)}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                    selectedState === state
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700'
                  }`}
                >
                  {state}
                </button>
              ))}
            </div>
          </div>

          {jobsLoading ? (
            <p className="text-slate-400 dark:text-zinc-500 text-xs">Loading jobs...</p>
          ) : jobs.length === 0 ? (
            <p className="text-slate-400 dark:text-zinc-500 text-xs">No jobs in this state.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b dark:border-zinc-700">
                      <th className="text-left py-1 px-2 font-medium">Job ID</th>
                      <th className="text-left py-1 px-2 font-medium">Name</th>
                      <th className="text-left py-1 px-2 font-medium">Profile</th>
                      <th className="text-left py-1 px-2 font-medium">Created</th>
                      <th className="text-left py-1 px-2 font-medium">Processed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id} className="border-b dark:border-zinc-800">
                        <td className="py-1 px-2 font-mono">{job.id}</td>
                        <td className="py-1 px-2 max-w-[200px] truncate">{job.name}</td>
                        <td className="py-1 px-2">{job.data.profileName ?? '—'}</td>
                        <td className="py-1 px-2">{job.createdAt ? new Date(job.createdAt).toLocaleString() : '—'}</td>
                        <td className="py-1 px-2">{job.processedAt ? new Date(job.processedAt).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2 mt-3 items-center">
                <button
                  onClick={() => handlePageChange(Math.max(1, jobsPage - 1))}
                  disabled={jobsPage <= 1}
                  className="px-3 py-1 text-xs bg-slate-100 dark:bg-zinc-800 rounded disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-xs text-slate-500 dark:text-zinc-400">Page {jobsPage}</span>
                <button
                  onClick={() => handlePageChange(jobsPage + 1)}
                  disabled={jobs.length < 50}
                  className="px-3 py-1 text-xs bg-slate-100 dark:bg-zinc-800 rounded disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
