/**
 * TentaCLAW Gateway — Command Operations
 */

import type {
    GatewayCommand,
    FlightSheet,
    FlightSheetTarget,
    CommandAction,
} from '../../../shared/types';
import { getDb, generateId } from './init';
import { getAllNodes } from './nodes';
import { safeJsonParse } from './safe-json';

// =============================================================================
// Command Operations
// =============================================================================

export function queueCommand(nodeId: string, action: CommandAction, params?: Record<string, unknown> & {
    model?: string;
    gpu?: number;
    profile?: string;
    priority?: string;
}): GatewayCommand {
    const d = getDb();
    const id = generateId();
    const payload = params ? JSON.stringify(params) : null;

    d.prepare(`
        INSERT INTO commands (id, node_id, action, payload, status)
        VALUES (?, ?, ?, ?, 'pending')
    `).run(id, nodeId, action, payload);

    return {
        id,
        action,
        ...(params || {}),
    };
}

export function getPendingCommands(nodeId: string): GatewayCommand[] {
    const d = getDb();
    const rows = d.prepare(
        "SELECT * FROM commands WHERE node_id = ? AND status = 'pending' ORDER BY created_at"
    ).all(nodeId) as { id: string; action: string; payload: string | null }[];

    return rows.map(row => {
        const params = row.payload ? safeJsonParse(row.payload, {}) : {};
        return {
            id: row.id,
            action: row.action as CommandAction,
            ...params,
        };
    });
}

export function ackCommand(commandId: string): void {
    const d = getDb();
    d.prepare("UPDATE commands SET status = 'sent', sent_at = datetime('now') WHERE id = ?").run(commandId);
}

export function completeCommand(commandId: string): void {
    const d = getDb();
    d.prepare(
        "UPDATE commands SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
    ).run(commandId);
}

// =============================================================================
// Flight Sheet Operations
// =============================================================================

export function createFlightSheet(name: string, description: string, targets: FlightSheetTarget[]): FlightSheet {
    const d = getDb();
    const id = generateId();

    d.prepare(`
        INSERT INTO flight_sheets (id, name, description, targets)
        VALUES (?, ?, ?, ?)
    `).run(id, name, description, JSON.stringify(targets));

    const row = d.prepare('SELECT * FROM flight_sheets WHERE id = ?').get(id) as Omit<FlightSheet, 'targets'> & { targets: string };
    return { ...row, targets: safeJsonParse(row.targets, []) };
}

export function getAllFlightSheets(): FlightSheet[] {
    const d = getDb();
    const rows = d.prepare('SELECT * FROM flight_sheets ORDER BY created_at DESC').all() as (Omit<FlightSheet, 'targets'> & { targets: string })[];
    return rows.map(r => ({ ...r, targets: safeJsonParse(r.targets, []) }));
}

export function getFlightSheet(id: string): FlightSheet | null {
    const d = getDb();
    const row = d.prepare('SELECT * FROM flight_sheets WHERE id = ?').get(id) as (Omit<FlightSheet, 'targets'> & { targets: string }) | undefined;
    if (!row) return null;
    return { ...row, targets: safeJsonParse(row.targets, []) };
}

export function deleteFlightSheet(id: string): boolean {
    const d = getDb();
    const result = d.prepare('DELETE FROM flight_sheets WHERE id = ?').run(id);
    return result.changes > 0;
}

/**
 * Apply a flight sheet: queue install_model commands for each target node.
 */
export function applyFlightSheet(id: string): GatewayCommand[] {
    const sheet = getFlightSheet(id);
    if (!sheet) return [];

    const commands: GatewayCommand[] = [];
    const allNodes = getAllNodes();

    for (const target of sheet.targets) {
        const targetNodes = target.node_id === '*'
            ? allNodes
            : allNodes.filter(n => n.id === target.node_id);

        for (const node of targetNodes) {
            const cmd = queueCommand(node.id, 'install_model', {
                model: target.model,
                gpu: target.gpu,
            });
            commands.push(cmd);
        }
    }

    return commands;
}
