'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar, Legend, PieChart, Pie, Cell } from 'recharts';
import { Activity, CheckCircle, Database, DollarSign, RefreshCw, AlertCircle } from 'lucide-react';

const COLORS = ['#2563eb', '#16a34a', '#8b5cf6', '#ea580c', '#eab308', '#ec4899', '#06b6d4'];

interface AnalyticsData {
  success: boolean;
  summary: {
    totalRequests: number;
    successRate: number;
    totalTokens: number;
    totalCost: number;
  };
  timeSeries: Array<{
    time: string;
    requests: number;
    tokens: number;
    cost: number;
    successRequests: number;
    failRequests: number;
    pendingRequests: number;
  }>;
  profileBreakdown: Array<{ id: string; name: string; value: number }>;
  pipelineBreakdown: Array<{ name: string; value: number }>;
}

export default function DashboardView() {
  const [timeRange, setTimeRange] = useState('24h');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/internal/analytics?timeRange=${timeRange}&resolution=${timeRange === '24h' ? 'hour' : 'day'}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to fetch analytics');
      }
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (error) {
    return (
      <div className="p-6 bg-destructive/10 text-destructive rounded-xl border border-destructive/20 flex items-center gap-3">
        <AlertCircle className="w-5 h-5" />
        <p>{error}</p>
        <button onClick={fetchAnalytics} className="ml-auto underline font-medium">Retry</button>
      </div>
    );
  }

  const { summary, timeSeries, profileBreakdown, pipelineBreakdown } = data || {};

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex bg-muted p-1 rounded-lg">
          {['24h', '7d', '30d'].map(tr => (
            <button
              key={tr}
              onClick={() => setTimeRange(tr)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${timeRange === tr ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {tr === '24h' ? 'Last 24 Hours' : tr === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
            </button>
          ))}
        </div>
        <button
          onClick={fetchAnalytics}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-muted-foreground bg-card border shadow-sm rounded-lg hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
          {[1,2,3,4].map(k => <div key={k} className="h-28 bg-muted rounded-xl"></div>)}
          <div className="lg:col-span-4 h-80 bg-muted rounded-xl mt-4"></div>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 border bg-card text-card-foreground rounded-xl shadow-sm flex flex-col gap-1">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Activity className="w-4 h-4" />
                <h3 className="text-sm font-medium">Total Requests</h3>
              </div>
              <p className="text-3xl font-bold">{summary?.totalRequests?.toLocaleString() || 0}</p>
            </div>
            
            <div className="p-5 border bg-card text-card-foreground rounded-xl shadow-sm flex flex-col gap-1">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <CheckCircle className="w-4 h-4" />
                <h3 className="text-sm font-medium">Success Rate</h3>
              </div>
              <p className="text-3xl font-bold">{summary?.successRate?.toFixed(1) || 0}%</p>
            </div>

            <div className="p-5 border bg-card text-card-foreground rounded-xl shadow-sm flex flex-col gap-1">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Database className="w-4 h-4" />
                <h3 className="text-sm font-medium">Tokens Used</h3>
              </div>
              <p className="text-3xl font-bold">{(summary?.totalTokens || 0).toLocaleString()}</p>
            </div>

            <div className="p-5 border bg-card text-card-foreground rounded-xl shadow-sm flex flex-col gap-1">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <DollarSign className="w-4 h-4" />
                <h3 className="text-sm font-medium">Est. Cost</h3>
              </div>
              <p className="text-3xl font-bold">${(summary?.totalCost || 0).toFixed(4)}</p>
            </div>
          </div>

          {/* Main Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-4">
            <div className="lg:col-span-2 p-5 border bg-card text-card-foreground rounded-xl shadow-sm">
              <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">Request Volume</h3>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={timeSeries || []} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" opacity={0.5} />
                    <XAxis 
                      dataKey="time" 
                      tickFormatter={(val) => {
                        const date = new Date(val);
                        return timeRange === '24h'
                          ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : date.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
                      }} 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.7 }} 
                      dy={10} 
                    />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.7 }} />
                    <RechartsTooltip 
                      labelFormatter={(label) => new Date(label).toLocaleString()}
                      contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--card)', color: 'var(--card-foreground)', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Bar dataKey="successRequests" stackId="a" fill="#16a34a" radius={[0, 0, 0, 0]} name="Succeeded" />
                    <Bar dataKey="failRequests" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} name="Failed" />
                    <Bar dataKey="pendingRequests" stackId="a" fill="#eab308" radius={[4, 4, 0, 0]} name="Pending" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="p-5 border bg-card text-card-foreground rounded-xl shadow-sm">
              <h3 className="text-lg font-semibold mb-6">Pipeline Distribution</h3>
              <div className="h-72 w-full flex items-center justify-center">
                {pipelineBreakdown && pipelineBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pipelineBreakdown}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {pipelineBreakdown.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--card)', color: 'var(--card-foreground)', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }}/>
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-sm">No data available</p>
                )}
              </div>
            </div>
          </div>
          
          {/* Profile Breakdown list */}
          <div className="p-5 border bg-card text-card-foreground rounded-xl shadow-sm">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">Profile Usage</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted border-b border-border">
                  <tr>
                    <th className="px-4 py-3 font-medium rounded-tl-lg">Profile Name</th>
                    <th className="px-4 py-3 font-medium">Operations</th>
                  </tr>
                </thead>
                <tbody>
                  {profileBreakdown && profileBreakdown.length > 0 ? profileBreakdown.map((item: any, i: number) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/50">
                      <td className="px-4 py-3 font-medium">{item.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.value.toLocaleString()}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">No operations found in this time range.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
