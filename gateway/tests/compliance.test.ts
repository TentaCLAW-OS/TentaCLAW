/**
 * EU AI Act Compliance Engine Tests (Wave 83)
 */

import { describe, it, expect, beforeEach } from 'vitest';

process.env.TENTACLAW_DB_PATH = ':memory:';

import {
    logComplianceEvent, getComplianceLog,
    classifyModelRisk, getModelRiskLevel, getAllRiskClassifications,
    recordHumanOverride, getHumanOverrides,
    generateComplianceReport, _resetCompliance,
} from '../src/compliance';
import { getDb } from '../src/db';

beforeEach(() => {
    _resetCompliance();
    const db = getDb();
    try {
        db.exec('DELETE FROM compliance_log; DELETE FROM model_risk_classifications; DELETE FROM human_overrides;');
    } catch { /* tables may not exist yet */ }
});

describe('Article 12: Compliance Logging', () => {
    it('logs an inference event', () => {
        logComplianceEvent({ model: 'llama-8b', inputTokens: 100, outputTokens: 50, latencyMs: 200 });
        const logs = getComplianceLog();
        expect(logs).toHaveLength(1);
        expect(logs[0].model).toBe('llama-8b');
        expect(logs[0].input_token_count).toBe(100);
    });

    it('logs with risk level and transparency', () => {
        logComplianceEvent({
            model: 'medical-llm', inputTokens: 200, outputTokens: 100, latencyMs: 500,
            riskLevel: 'high', transparencyDisclosed: true, userHash: 'abc123',
        });
        const logs = getComplianceLog({ model: 'medical-llm' });
        expect(logs[0].risk_level).toBe('high');
    });

    it('filters logs by model', () => {
        logComplianceEvent({ model: 'llama-8b', inputTokens: 10, outputTokens: 5, latencyMs: 100 });
        logComplianceEvent({ model: 'phi-4', inputTokens: 20, outputTokens: 10, latencyMs: 150 });
        expect(getComplianceLog({ model: 'llama-8b' })).toHaveLength(1);
    });
});

describe('Risk Classification', () => {
    it('classifies model risk', () => {
        classifyModelRisk('medical-llm', 'high', 'Clinical decisions', 'admin');
        const risk = getModelRiskLevel('medical-llm');
        expect(risk?.risk_level).toBe('high');
    });

    it('updates on re-classify', () => {
        classifyModelRisk('model-a', 'minimal', 'Chat');
        classifyModelRisk('model-a', 'limited', 'Upgraded');
        expect(getModelRiskLevel('model-a')?.risk_level).toBe('limited');
    });

    it('lists all classifications', () => {
        classifyModelRisk('a', 'minimal', 'Chat');
        classifyModelRisk('b', 'high', 'Healthcare');
        expect(getAllRiskClassifications()).toHaveLength(2);
    });

    it('returns null/undefined for unclassified', () => {
        expect(getModelRiskLevel('nonexistent')).toBeFalsy();
    });
});

describe('Article 14: Human Oversight', () => {
    it('records override', () => {
        recordHumanOverride('emergency_stop', 'admin', 'llama-70b', 'Harmful content');
        const overrides = getHumanOverrides();
        expect(overrides).toHaveLength(1);
        expect(overrides[0].action).toBe('emergency_stop');
    });
});

describe('Compliance Report', () => {
    it('generates report with no data', () => {
        const report = generateComplianceReport(30);
        expect(report.framework).toBe('eu-ai-act');
        expect(report.summary.total_requests).toBe(0);
        expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('generates report with logged events', () => {
        logComplianceEvent({ model: 'llama-8b', inputTokens: 100, outputTokens: 50, latencyMs: 200, transparencyDisclosed: true });
        logComplianceEvent({ model: 'llama-8b', inputTokens: 150, outputTokens: 75, latencyMs: 300, transparencyDisclosed: true });
        const report = generateComplianceReport(30);
        expect(report.summary.total_requests).toBe(2);
        expect(report.summary.transparency_rate).toBe(100);
        expect(report.articles.article_12_logging.status).toBe('compliant');
    });

    it('flags low transparency rate', () => {
        logComplianceEvent({ model: 'llama-8b', inputTokens: 100, outputTokens: 50, latencyMs: 200, transparencyDisclosed: false });
        const report = generateComplianceReport(30);
        expect(report.summary.transparency_rate).toBe(0);
        expect(report.articles.article_50_disclosure.status).toBe('partial');
    });

    it('cybersecurity always compliant', () => {
        const report = generateComplianceReport(30);
        expect(report.articles.article_15_cybersecurity.status).toBe('compliant');
    });
});
