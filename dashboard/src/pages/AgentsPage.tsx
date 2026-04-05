// ─── TentaCLAW Dashboard — Agent Builder Page ───────────────────────────────

import React, { useState } from 'react';
import { useStore } from '../store';
import {
  StatCard, Badge, StatusDot, SectionHeader, formatNumber,
} from '../components/ui';
import {
  Bot, Plus, Play, Square, Settings, Wrench, Sparkles,
  Code, Globe, FileText, Database, Trash2, Copy,
  ChevronDown, ChevronRight, Pencil,
} from 'lucide-react';
import type { AgentConfig } from '../types';

const AVAILABLE_TOOLS = [
  { id: 'code_exec', name: 'Code Execution', icon: <Code size={14} />, desc: 'Run code in sandboxed environment' },
  { id: 'web_search', name: 'Web Search', icon: <Globe size={14} />, desc: 'Search the internet for information' },
  { id: 'web_browse', name: 'Web Browse', icon: <Globe size={14} />, desc: 'Navigate and read web pages' },
  { id: 'file_read', name: 'File Read', icon: <FileText size={14} />, desc: 'Read files from the workspace' },
  { id: 'file_write', name: 'File Write', icon: <FileText size={14} />, desc: 'Write and edit files' },
  { id: 'sql_query', name: 'SQL Query', icon: <Database size={14} />, desc: 'Execute database queries' },
  { id: 'summarize', name: 'Summarize', icon: <Sparkles size={14} />, desc: 'Summarize long documents' },
  { id: 'cite', name: 'Citations', icon: <FileText size={14} />, desc: 'Generate proper citations' },
  { id: 'chart_gen', name: 'Chart Generation', icon: <Sparkles size={14} />, desc: 'Create data visualizations' },
  { id: 'csv_parse', name: 'CSV Parser', icon: <Database size={14} />, desc: 'Parse and analyze CSV data' },
  { id: 'cluster_status', name: 'Cluster Status', icon: <Wrench size={14} />, desc: 'Query TentaCLAW fleet status' },
  { id: 'node_control', name: 'Node Control', icon: <Wrench size={14} />, desc: 'Issue commands to octopods' },
  { id: 'model_deploy', name: 'Model Deploy', icon: <Wrench size={14} />, desc: 'Deploy/unload models on GPUs' },
];

export function AgentsPage() {
  const { agents, models, updateAgent } = useStore();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);

  const running = agents.filter(a => a.status === 'running');
  const totalReqs = agents.reduce((s, a) => s + a.requestCount, 0);

  const loadedModels = models.filter(m => m.status === 'loaded');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Running Agents" value={running.length} sub={`${agents.length} total`} icon={<Bot size={16} />} color="text-success" />
        <StatCard label="Total Requests" value={formatNumber(totalReqs)} sub="all time" icon={<Sparkles size={16} />} color="text-accent" />
        <StatCard label="Avg Latency" value={`${Math.round(agents.reduce((s, a) => s + a.avgLatencyMs, 0) / (agents.length || 1))}ms`} sub="across agents" color="text-accent-3" />
        <StatCard label="Available Tools" value={AVAILABLE_TOOLS.length} sub="integrations" icon={<Wrench size={16} />} color="text-warning" />
      </div>

      {/* Create Agent Button */}
      <div className="flex items-center justify-between">
        <SectionHeader title="Your Agents" subtitle="Build and manage AI agents with custom tools" />
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-accent/10 text-accent border border-accent/20 rounded-lg text-sm font-medium hover:bg-accent/20 transition-colors"
        >
          <Plus size={16} /> New Agent
        </button>
      </div>

      {/* Create Agent Form */}
      {showCreate && (
        <div className="bg-bg-card border border-accent/20 rounded-xl p-5 space-y-4 animate-slide-in">
          <h3 className="text-sm font-semibold text-accent flex items-center gap-2">
            <Sparkles size={16} /> Create New Agent
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Name</label>
              <input className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm focus:outline-none focus:border-border-focus" placeholder="MyAgent" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Model</label>
              <select className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm focus:outline-none focus:border-border-focus appearance-none">
                {loadedModels.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.parameters})</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Description</label>
            <input className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm focus:outline-none focus:border-border-focus" placeholder="What does this agent do?" />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">System Prompt</label>
            <textarea
              className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm focus:outline-none focus:border-border-focus resize-none font-mono"
              rows={4}
              placeholder="You are a helpful assistant..."
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-2">Tools</label>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {AVAILABLE_TOOLS.map(tool => (
                <label key={tool.id} className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border border-border rounded-lg cursor-pointer hover:border-accent/30 transition-colors">
                  <input type="checkbox" className="rounded border-border text-accent focus:ring-accent" />
                  <span className="text-text-muted">{tool.icon}</span>
                  <span className="text-xs text-text-primary">{tool.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Temperature</label>
              <input type="range" min="0" max="100" defaultValue="70" className="w-full" />
              <div className="flex justify-between text-xs text-text-muted mt-1">
                <span>Precise</span><span>Creative</span>
              </div>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Max Tokens</label>
              <input className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm focus:outline-none focus:border-border-focus" type="number" defaultValue={8192} />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors">
              Create Agent
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-text-muted text-sm hover:text-text-primary transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Agent Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {agents.map(agent => (
          <div key={agent.id} className="bg-bg-card border border-border rounded-xl overflow-hidden card-hover">
            {/* Agent Header */}
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${agent.status === 'running' ? 'bg-success/10 text-success' : 'bg-bg-secondary text-text-muted'}`}>
                  <Bot size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{agent.name}</span>
                    <Badge variant={agent.status === 'running' ? 'success' : agent.status === 'stopped' ? 'default' : 'danger'}>
                      {agent.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-text-muted">{agent.description}</div>
                </div>
              </div>
            </div>

            {/* Agent Body */}
            <div className="px-4 py-3 space-y-3">
              {/* Model */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Model</span>
                <span className="text-accent font-medium">{agent.model}</span>
              </div>

              {/* Tools */}
              <div>
                <span className="text-xs text-text-muted block mb-1">Tools</span>
                <div className="flex flex-wrap gap-1">
                  {agent.tools.map(t => {
                    const tool = AVAILABLE_TOOLS.find(at => at.id === t);
                    return (
                      <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 bg-bg-secondary rounded text-xs text-text-secondary">
                        {tool?.icon} {tool?.name || t}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="text-center p-2 bg-bg-secondary rounded-lg">
                  <div className="text-text-primary font-bold">{formatNumber(agent.requestCount)}</div>
                  <div className="text-text-muted">requests</div>
                </div>
                <div className="text-center p-2 bg-bg-secondary rounded-lg">
                  <div className="text-text-primary font-bold">{agent.avgLatencyMs}ms</div>
                  <div className="text-text-muted">avg latency</div>
                </div>
                <div className="text-center p-2 bg-bg-secondary rounded-lg">
                  <div className="text-text-primary font-bold">T={agent.temperature}</div>
                  <div className="text-text-muted">temp</div>
                </div>
              </div>
            </div>

            {/* Agent Actions */}
            <div className="px-4 py-2 border-t border-border/50 flex items-center gap-2">
              {agent.status === 'running' ? (
                <button
                  onClick={() => updateAgent(agent.id, { status: 'stopped' })}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-danger/10 text-danger text-xs font-medium hover:bg-danger/20 transition-colors"
                >
                  <Square size={12} /> Stop
                </button>
              ) : (
                <button
                  onClick={() => updateAgent(agent.id, { status: 'running' })}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-success/10 text-success text-xs font-medium hover:bg-success/20 transition-colors"
                >
                  <Play size={12} /> Start
                </button>
              )}
              <button className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-bg-secondary text-text-muted text-xs hover:text-text-primary transition-colors">
                <Copy size={12} /> Clone
              </button>
              <button className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-bg-secondary text-text-muted text-xs hover:text-text-primary transition-colors">
                <Pencil size={12} /> Edit
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
