/**
 * TentaCLAW SDK — Basic Usage Example
 *
 * Run: npx tsx examples/basic-usage.ts
 * Requires: gateway running on localhost:8080
 */

import { TentaCLAW } from '../sdk/src/index';

async function main() {
    const tc = new TentaCLAW('http://localhost:8080');

    // Check if gateway is reachable
    const alive = await tc.ping();
    console.log('Gateway reachable:', alive);
    if (!alive) {
        console.log('Start the gateway first: cd gateway && npm run dev');
        process.exit(1);
    }

    // Get cluster summary
    const summary = await tc.cluster.summary();
    console.log('\nCluster Summary:');
    console.log('  Nodes:', summary.online_nodes, '/', summary.total_nodes);
    console.log('  GPUs:', summary.total_gpus);
    console.log('  VRAM:', Math.round(summary.total_vram_mb / 1024), 'GB');
    console.log('  Models:', summary.loaded_models.join(', ') || 'none');

    // Get health score
    const health = await tc.cluster.health();
    console.log('\nHealth:', health.score + '/100', '(' + health.grade + ')');

    // List nodes
    const nodes = await tc.nodes.list();
    console.log('\nNodes:');
    for (const node of nodes) {
        console.log('  -', node.hostname, '(' + node.status + ')', node.gpu_count, 'GPUs');
    }

    // List models
    const models = await tc.models.list();
    console.log('\nModels:');
    for (const m of models.models) {
        console.log('  -', m.model, 'on', m.node_count, 'nodes');
    }

    // Chat with a model (if any are loaded)
    if (summary.loaded_models.length > 0) {
        const model = summary.loaded_models[0];
        console.log('\nChatting with', model + '...');
        const response = await tc.inference.chat(model, 'Hello! What are you?');
        console.log('Response:', response.choices[0].message.content);
    }
}

main().catch(console.error);
