/**
 * Flight sheet routes
 */
import { Hono } from 'hono';
import {
    createFlightSheet,
    getAllFlightSheets,
    getFlightSheet,
    deleteFlightSheet,
    applyFlightSheet,
} from '../db';
import { broadcastSSE } from '../shared';

const routes = new Hono();

routes.get('/api/v1/flight-sheets', (c) => {
    const sheets = getAllFlightSheets();
    return c.json({ flight_sheets: sheets });
});

routes.post('/api/v1/flight-sheets', async (c) => {
    const body = await c.req.json();

    if (!body.name || !body.targets || !Array.isArray(body.targets)) {
        return c.json({ error: 'Missing required fields: name, targets[]' }, 400);
    }

    const sheet = createFlightSheet(body.name, body.description || '', body.targets);
    console.log(`[tentaclaw] Flight sheet created: ${sheet.name} (${sheet.id})`);
    return c.json({ status: 'created', flight_sheet: sheet });
});

routes.get('/api/v1/flight-sheets/:id', (c) => {
    const id = c.req.param('id');
    const sheet = getFlightSheet(id);
    if (!sheet) {
        return c.json({ error: 'Flight sheet not found' }, 404);
    }
    return c.json({ flight_sheet: sheet });
});

routes.delete('/api/v1/flight-sheets/:id', (c) => {
    const id = c.req.param('id');
    const deleted = deleteFlightSheet(id);
    if (!deleted) {
        return c.json({ error: 'Flight sheet not found' }, 404);
    }
    return c.json({ status: 'deleted', id });
});

routes.post('/api/v1/flight-sheets/:id/apply', (c) => {
    const id = c.req.param('id');
    const commands = applyFlightSheet(id);

    if (commands.length === 0) {
        return c.json({ error: 'Flight sheet not found or no matching nodes' }, 404);
    }

    broadcastSSE('flight_sheet_applied', {
        flight_sheet_id: id,
        commands_queued: commands.length,
        timestamp: new Date().toISOString(),
    });

    console.log(`[tentaclaw] Flight sheet applied: ${id} — ${commands.length} commands queued`);

    return c.json({ status: 'applied', commands_queued: commands.length, commands });
});

export default routes;
