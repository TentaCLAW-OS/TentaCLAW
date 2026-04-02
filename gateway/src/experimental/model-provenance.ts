/**
 * TentaCLAW Gateway — Model Provenance Tracking (Wave 92)
 *
 * Track full lineage of every model from download to deployment:
 *   - SHA-256 hash verification on model load
 *   - Provenance chain: source -> download -> quantize -> deploy
 *   - Trust policies (allow_all, warn_unsigned, reject_unsigned, require_signed)
 *   - AI SBOM generation per model (CycloneDX 1.6)
 *
 * TentaCLAW says: "Trust but verify. Every model. Every weight. Every time."
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getDb } from './db';

// =============================================================================
// Types
// =============================================================================

export interface ModelProvenance {
    model: string;
    hash_sha256: string;
    source: string;
    source_url: string | null;
    format: string;
    size_bytes: number;
    verified: boolean;
    signed: boolean;
    signature: string | null;
    quantization: string | null;
    parent_model: string | null;
    metadata: Record<string, unknown>;
}

export type TrustPolicy = 'allow_all' | 'warn_unsigned' | 'reject_unsigned' | 'require_signed';

// =============================================================================
// Schema
// =============================================================================

let schemaInit = false;

function ensureSchema(): void {
    if (schemaInit) return;
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS model_provenance (
            model TEXT PRIMARY KEY,
            hash_sha256 TEXT NOT NULL,
            source TEXT DEFAULT 'unknown',
            source_url TEXT,
            format TEXT DEFAULT 'unknown',
            size_bytes INTEGER DEFAULT 0,
            downloaded_at TEXT DEFAULT (datetime('now')),
            verified INTEGER DEFAULT 0,
            signed INTEGER DEFAULT 0,
            signature TEXT,
            quantization TEXT,
            parent_model TEXT,
            metadata TEXT DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS provenance_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model TEXT NOT NULL,
            event TEXT NOT NULL,
            detail TEXT DEFAULT '',
            actor TEXT DEFAULT 'system',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_prov_events ON provenance_events(model, created_at DESC);
    `);
    schemaInit = true;
}

// =============================================================================
// Hash Verification
// =============================================================================

/** Compute SHA-256 of file content (sync) */
export function hashFileSync(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
}

/** Hash model directory (all weight files combined) */
export function hashModelDir(dirPath: string): string {
    const hash = createHash('sha256');
    const files = fs.readdirSync(dirPath)
        .filter(f => f.endsWith('.safetensors') || f.endsWith('.bin') || f.endsWith('.gguf') || f.endsWith('.pt'))
        .sort();
    for (const file of files) {
        const fileHash = hashFileSync(path.join(dirPath, file));
        hash.update(file + ':' + fileHash);
    }
    return hash.digest('hex');
}

// =============================================================================
// Registry
// =============================================================================

/** Register model provenance */
export function registerProvenance(model: string, hash: string, source: string = 'unknown', opts: Partial<ModelProvenance> = {}): void {
    ensureSchema();
    const db = getDb();
    db.prepare(`
        INSERT INTO model_provenance (model, hash_sha256, source, source_url, format, size_bytes, verified, signed, signature, quantization, parent_model, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(model) DO UPDATE SET hash_sha256=excluded.hash_sha256, verified=excluded.verified, signed=excluded.signed
    `).run(model, hash, source, opts.source_url || null, opts.format || 'unknown', opts.size_bytes || 0,
        opts.verified ? 1 : 0, opts.signed ? 1 : 0, opts.signature || null, opts.quantization || null,
        opts.parent_model || null, JSON.stringify(opts.metadata || {}));
    logEvent(model, 'downloaded', `Source: ${source}, Hash: ${hash.slice(0, 16)}...`);
}

/** Get provenance */
export function getProvenance(model: string): ModelProvenance | null {
    ensureSchema();
    const row = getDb().prepare('SELECT * FROM model_provenance WHERE model = ?').get(model) as any;
    if (!row) return null;
    return { ...row, verified: !!row.verified, signed: !!row.signed, metadata: JSON.parse(row.metadata || '{}') };
}

/** List all provenances */
export function listProvenances(): ModelProvenance[] {
    ensureSchema();
    return (getDb().prepare('SELECT * FROM model_provenance ORDER BY downloaded_at DESC').all() as any[])
        .map(r => ({ ...r, verified: !!r.verified, signed: !!r.signed, metadata: JSON.parse(r.metadata || '{}') }));
}

/** Verify model hash against registry */
export function verifyModelIntegrity(model: string, currentHash: string): { valid: boolean; expected: string; actual: string } {
    const prov = getProvenance(model);
    if (!prov) return { valid: false, expected: 'not_registered', actual: currentHash };
    const valid = prov.hash_sha256 === currentHash;
    if (!valid) logEvent(model, 'tampered', `Expected: ${prov.hash_sha256.slice(0, 16)}, Got: ${currentHash.slice(0, 16)}`);
    else logEvent(model, 'verified', 'Hash matches');
    return { valid, expected: prov.hash_sha256, actual: currentHash };
}

// =============================================================================
// Trust Policy
// =============================================================================

let trustPolicy: TrustPolicy = 'warn_unsigned';

export function setTrustPolicy(policy: TrustPolicy): void { trustPolicy = policy; }
export function getTrustPolicy(): TrustPolicy { return trustPolicy; }

/** Check if model load should be allowed */
export function checkTrustPolicy(model: string): { allowed: boolean; reason: string } {
    const prov = getProvenance(model);
    switch (trustPolicy) {
        case 'allow_all': return { allowed: true, reason: 'Policy: allow_all' };
        case 'warn_unsigned':
            if (!prov || !prov.signed) console.warn(`[provenance] Model "${model}" is unsigned`);
            return { allowed: true, reason: prov?.signed ? 'Signed' : 'Unsigned (warn mode)' };
        case 'reject_unsigned':
            if (!prov) return { allowed: false, reason: 'No provenance record' };
            if (!prov.verified) return { allowed: false, reason: 'Not verified' };
            return { allowed: true, reason: 'Registered and verified' };
        case 'require_signed':
            if (!prov?.signed) return { allowed: false, reason: 'Not signed' };
            return { allowed: true, reason: 'Signed' };
    }
}

// =============================================================================
// AI SBOM
// =============================================================================

/** Generate CycloneDX AI SBOM */
export function generateAiSbom(model: string): Record<string, unknown> {
    const prov = getProvenance(model);
    const events = getProvenanceEvents(model);
    return {
        bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
        metadata: { timestamp: new Date().toISOString(), tools: [{ vendor: 'TentaCLAW', name: 'model-provenance' }] },
        components: [{
            type: 'machine-learning-model', name: model,
            hashes: prov ? [{ alg: 'SHA-256', content: prov.hash_sha256 }] : [],
            properties: [
                { name: 'source', value: prov?.source || 'unknown' },
                { name: 'format', value: prov?.format || 'unknown' },
                { name: 'quantization', value: prov?.quantization || 'none' },
                { name: 'signed', value: String(prov?.signed || false) },
            ],
            evidence: { provenance: events.map(e => ({ event: e.event, detail: e.detail, timestamp: e.created_at })) },
        }],
    };
}

// =============================================================================
// Events
// =============================================================================

function logEvent(model: string, event: string, detail: string, actor: string = 'system'): void {
    ensureSchema();
    getDb().prepare('INSERT INTO provenance_events (model, event, detail, actor) VALUES (?, ?, ?, ?)').run(model, event, detail, actor);
}

export function getProvenanceEvents(model: string, limit: number = 50): any[] {
    ensureSchema();
    return getDb().prepare('SELECT * FROM provenance_events WHERE model = ? ORDER BY created_at DESC LIMIT ?').all(model, limit);
}

export function logDeployment(model: string, nodeId: string): void { logEvent(model, 'deployed', `Node: ${nodeId}`); }
export function logUndeployment(model: string, nodeId: string): void { logEvent(model, 'undeployed', `Node: ${nodeId}`); }

export function _resetProvenance(): void {
    schemaInit = false; trustPolicy = 'warn_unsigned';
    try { getDb().exec('DELETE FROM model_provenance; DELETE FROM provenance_events;'); } catch {}
}
