/**
 * TentaCLAW SDK — Deploy a Model Example
 *
 * Run: npx tsx examples/deploy-model.ts llama3.1:8b
 */

import { TentaCLAW } from '../sdk/src/index';

async function main() {
    const model = process.argv[2] || 'llama3.1:8b';
    const tc = new TentaCLAW('http://localhost:8080');

    console.log('Deploying', model, 'to cluster...');

    // Check if model fits anywhere
    const fit = await tc.models.checkFit(model);
    console.log('Fit check:', JSON.stringify(fit, null, 2));

    // Smart deploy — picks the best node automatically
    const result = await tc.models.smartDeploy(model);
    console.log('Deploy result:', JSON.stringify(result, null, 2));

    // Wait and check
    console.log('\nWaiting 5s for deployment...');
    await new Promise(r => setTimeout(r, 5000));

    const models = await tc.models.list();
    const deployed = models.models.find(m => m.model === model);
    if (deployed) {
        console.log('Model', model, 'deployed to', deployed.node_count, 'nodes');
    } else {
        console.log('Model not yet visible — check dashboard for progress');
    }
}

main().catch(console.error);
