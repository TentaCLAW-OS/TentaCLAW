/**
 * TentaCLAW Gateway — Data Residency Controls (Wave 91)
 *
 * Region-constrained inference routing for regulatory compliance:
 *   - Tag nodes with geographic regions
 *   - Route inference data only to nodes in the permitted region
 *   - Verification endpoint for compliance audits
 *   - Region compliance reporting
 *
 * Required for: EU GDPR, EU AI Act, China data localization, HIPAA data residency.
 *
 * TentaCLAW says: "Your data stays where you tell it to. No tentacle crosses borders without permission."
 */

import { getAllNodes } from './db';

// =============================================================================
// Types
// =============================================================================

export type Region = 'us-east' | 'us-west' | 'eu-west' | 'eu-central' | 'ap-southeast' | 'ap-northeast' | 'ap-south' | string;

export interface NodeRegionTag {
    node_id: string;
    hostname: string;
    region: Region;
    country_code?: string;
    tagged_at: string;
}

export interface ResidencyPolicy {
    namespace: string;
    allowed_regions: Region[];
    denied_regions: Region[];
    enforce: boolean;
    created_at: string;
}

export interface ResidencyVerification {
    namespace: string;
    policy: ResidencyPolicy | null;
    nodes_in_scope: Array<{ node_id: string; hostname: string; region: Region; compliant: boolean }>;
    all_compliant: boolean;
    violations: string[];
}

// =============================================================================
// State (in production, this would be in DB)
// =============================================================================

const regionTags = new Map<string, { region: Region; country_code?: string; tagged_at: string }>();
const policies = new Map<string, ResidencyPolicy>();

// =============================================================================
// Region Tagging
// =============================================================================

/** Tag a node with a geographic region */
export function tagNodeRegion(nodeId: string, region: Region, countryCode?: string): void {
    regionTags.set(nodeId, { region, country_code: countryCode, tagged_at: new Date().toISOString() });
}

/** Get a node's region tag */
export function getNodeRegion(nodeId: string): { region: Region; country_code?: string } | null {
    return regionTags.get(nodeId) || null;
}

/** List all region tags */
export function listRegionTags(): NodeRegionTag[] {
    const nodes = getAllNodes();
    const tags: NodeRegionTag[] = [];
    for (const node of nodes) {
        const tag = regionTags.get(node.id);
        if (tag) {
            tags.push({ node_id: node.id, hostname: node.hostname, region: tag.region, country_code: tag.country_code, tagged_at: tag.tagged_at });
        }
    }
    return tags;
}

/** Remove a node's region tag */
export function removeNodeRegion(nodeId: string): boolean {
    return regionTags.delete(nodeId);
}

// =============================================================================
// Residency Policies
// =============================================================================

/** Set a data residency policy for a namespace */
export function setResidencyPolicy(namespace: string, allowedRegions: Region[], deniedRegions: Region[] = [], enforce: boolean = true): ResidencyPolicy {
    const policy: ResidencyPolicy = {
        namespace,
        allowed_regions: allowedRegions,
        denied_regions: deniedRegions,
        enforce,
        created_at: new Date().toISOString(),
    };
    policies.set(namespace, policy);
    return policy;
}

/** Get residency policy for a namespace */
export function getResidencyPolicy(namespace: string): ResidencyPolicy | null {
    return policies.get(namespace) || null;
}

/** List all policies */
export function listResidencyPolicies(): ResidencyPolicy[] {
    return Array.from(policies.values());
}

/** Delete a policy */
export function deleteResidencyPolicy(namespace: string): boolean {
    return policies.delete(namespace);
}

// =============================================================================
// Routing Filter
// =============================================================================

/** Check if a node is allowed for a namespace based on residency policy */
export function isNodeAllowedForNamespace(nodeId: string, namespace: string): { allowed: boolean; reason: string } {
    const policy = policies.get(namespace);
    if (!policy || !policy.enforce) {
        return { allowed: true, reason: 'No residency policy or enforcement disabled' };
    }

    const tag = regionTags.get(nodeId);
    if (!tag) {
        return { allowed: false, reason: `Node ${nodeId} has no region tag. Tag it before routing.` };
    }

    // Check denied list first
    if (policy.denied_regions.length > 0 && policy.denied_regions.includes(tag.region)) {
        return { allowed: false, reason: `Region ${tag.region} is denied by policy for namespace ${namespace}` };
    }

    // Check allowed list
    if (policy.allowed_regions.length > 0 && !policy.allowed_regions.includes(tag.region)) {
        return { allowed: false, reason: `Region ${tag.region} is not in allowed list [${policy.allowed_regions.join(',')}] for namespace ${namespace}` };
    }

    return { allowed: true, reason: `Region ${tag.region} is allowed for namespace ${namespace}` };
}

/** Filter nodes by residency policy */
export function filterNodesByResidency(nodeIds: string[], namespace: string): { allowed: string[]; denied: Array<{ node_id: string; reason: string }> } {
    const allowed: string[] = [];
    const denied: Array<{ node_id: string; reason: string }> = [];

    for (const nodeId of nodeIds) {
        const check = isNodeAllowedForNamespace(nodeId, namespace);
        if (check.allowed) {
            allowed.push(nodeId);
        } else {
            denied.push({ node_id: nodeId, reason: check.reason });
        }
    }

    return { allowed, denied };
}

// =============================================================================
// Verification
// =============================================================================

/** Verify data residency compliance for a namespace */
export function verifyResidency(namespace: string): ResidencyVerification {
    const policy = policies.get(namespace) || null;
    const nodes = getAllNodes().filter(n => n.status === 'online');
    const violations: string[] = [];

    const nodesInScope = nodes.map(n => {
        const tag = regionTags.get(n.id);
        const region = tag?.region || 'untagged';
        const check = isNodeAllowedForNamespace(n.id, namespace);
        if (!check.allowed) violations.push(`${n.hostname}: ${check.reason}`);
        return { node_id: n.id, hostname: n.hostname, region, compliant: check.allowed };
    });

    return {
        namespace,
        policy,
        nodes_in_scope: nodesInScope,
        all_compliant: violations.length === 0,
        violations,
    };
}

/** Generate residency compliance report for all namespaces */
export function generateResidencyReport(): Array<ResidencyVerification & { region_distribution: Record<string, number> }> {
    const results: Array<ResidencyVerification & { region_distribution: Record<string, number> }> = [];

    for (const [namespace] of policies) {
        const verification = verifyResidency(namespace);
        const distribution: Record<string, number> = {};
        for (const node of verification.nodes_in_scope) {
            distribution[node.region] = (distribution[node.region] || 0) + 1;
        }
        results.push({ ...verification, region_distribution: distribution });
    }

    return results;
}

/** Reset state (for testing) */
export function _resetResidency(): void {
    regionTags.clear();
    policies.clear();
}
