import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        env: {
            TENTACLAW_NO_AUTH: 'true',
            TENTACLAW_DB_PATH: ':memory:',
            TENTACLAW_CLUSTER_SECRET: 'test-secret',
        },
        fileParallelism: false,
        poolOptions: {
            forks: {
                singleFork: false,
            },
        },
        isolate: true,
    },
});
