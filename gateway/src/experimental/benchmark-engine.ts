// F:\tentaclaw-os\gateway\src\benchmark-engine.ts
// Built-In Model Benchmarking Engine
// TentaCLAW says: "Numbers don't lie. Show me what your cluster can do."

import { getDb } from './db';
import { percentile } from './profiler';
import { randomBytes } from 'crypto';

// =============================================================================
// Types & Interfaces
// =============================================================================

export interface BenchmarkSuite {
    id: string;
    name: string;
    description: string;
    tasks: BenchmarkTask[];
}

export interface BenchmarkTask {
    name: string;
    category: 'reasoning' | 'knowledge' | 'code' | 'math' | 'instruction' | 'creative' | 'custom';
    prompts: Array<{
        system?: string;
        user: string;
        expectedContains?: string[];   // response should contain these
        expectedNotContains?: string[]; // response should NOT contain these
        maxTokens?: number;
    }>;
    scoringMethod: 'contains' | 'exact' | 'llm-judge' | 'human' | 'custom';
}

export interface BenchmarkRun {
    id: string;
    model: string;
    suite: string;
    namespace: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    results: {
        overall_score: number;        // 0-100
        per_task: Array<{
            task: string;
            score: number;
            avg_latency_ms: number;
            avg_tokens_per_sec: number;
            samples: number;
        }>;
        throughput: {
            tokens_per_second: number;
            time_to_first_token_ms: number;
            latency_p50_ms: number;
            latency_p95_ms: number;
            latency_p99_ms: number;
        };
        resource_usage: {
            gpu_memory_peak_mb: number;
            gpu_utilization_avg_pct: number;
            power_draw_avg_w: number;
        };
    };
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
    model_config: {
        quantization: string;
        backend: string;
        node: string;
        gpu: string;
    };
}

interface BenchmarkRunOptions {
    namespace?: string;
    quantization?: string;
    backend?: string;
    node?: string;
    gpu?: string;
    maxConcurrency?: number;
    warmupRuns?: number;
    inferenceEndpoint?: string;
}

interface BenchmarkComparison {
    run1: { id: string; model: string; suite: string; score: number };
    run2: { id: string; model: string; suite: string; score: number };
    score_delta: number;
    score_delta_pct: number;
    throughput_delta_pct: number;
    latency_delta_pct: number;
    per_task_comparison: Array<{
        task: string;
        run1_score: number;
        run2_score: number;
        delta: number;
    }>;
    winner: string;
}

interface RegressionReport {
    model: string;
    latest_run: string;
    previous_run: string;
    score_drop_pct: number;
    threshold_pct: number;
    regressed: boolean;
    details: Array<{
        task: string;
        previous_score: number;
        current_score: number;
        delta: number;
    }>;
}

interface LeaderboardEntry {
    rank: number;
    model: string;
    score: number;
    throughput_tps: number;
    latency_p50_ms: number;
    quantization: string;
    backend: string;
    gpu: string;
    run_id: string;
    run_date: string;
}

// =============================================================================
// Database Schema Initialization
// =============================================================================

/**
 * Ensure benchmark tables exist. Called lazily on first use.
 */
let tablesInitialized = false;

function ensureBenchmarkTables(): void {
    if (tablesInitialized) return;
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS benchmark_suites (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            tasks TEXT NOT NULL,
            is_builtin INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_benchmark_suites_name ON benchmark_suites(name);

        CREATE TABLE IF NOT EXISTS benchmark_runs (
            id TEXT PRIMARY KEY,
            model TEXT NOT NULL,
            suite_id TEXT NOT NULL,
            namespace TEXT DEFAULT 'default',
            status TEXT DEFAULT 'pending',
            results TEXT DEFAULT '{}',
            started_at TEXT,
            completed_at TEXT,
            duration_ms INTEGER,
            model_config TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_benchmark_runs_model ON benchmark_runs(model, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_benchmark_runs_suite ON benchmark_runs(suite_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_benchmark_runs_namespace ON benchmark_runs(namespace, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_benchmark_runs_status ON benchmark_runs(status);
    `);
    tablesInitialized = true;
}

// =============================================================================
// Built-In Benchmark Suites
// =============================================================================

const STANDARD_SUITE: BenchmarkSuite = {
    id: 'standard',
    name: 'TentaCLAW Standard Suite',
    description: '50 prompts across reasoning, knowledge, code, math, and instruction following — the all-around evaluation.',
    tasks: [
        // -- Reasoning (10 prompts) --
        {
            name: 'logical-deduction',
            category: 'reasoning',
            prompts: [
                { user: 'If all cats are animals and some animals are pets, can we conclude that all cats are pets? Explain your reasoning step by step.', expectedContains: ['no', 'cannot'], maxTokens: 300 },
                { user: 'A farmer has chickens and cows. He counts 20 heads and 56 legs. How many chickens and how many cows does he have?', expectedContains: ['12', '8'], maxTokens: 300 },
                { user: 'Three boxes are labeled "Apples", "Oranges", and "Mixed". All labels are wrong. You pick one fruit from the "Mixed" box and it is an apple. What are the correct labels for all three boxes?', expectedContains: ['Apples'], maxTokens: 400 },
                { user: 'If it takes 5 machines 5 minutes to make 5 widgets, how long would it take 100 machines to make 100 widgets?', expectedContains: ['5'], maxTokens: 200 },
                { user: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?', expectedContains: ['0.05', '5 cent'], maxTokens: 200 },
            ],
            scoringMethod: 'contains',
        },
        {
            name: 'causal-reasoning',
            category: 'reasoning',
            prompts: [
                { user: 'Why would a city experience increased traffic after opening a new highway? Provide at least 3 reasons.', expectedContains: ['induced demand'], maxTokens: 400 },
                { user: 'A company raises prices by 20% and sees revenue increase by 5%. What might explain this? List possible reasons.', expectedContains: ['demand', 'elastic'], maxTokens: 400 },
                { user: 'If the Earth suddenly had no Moon, what would be the three most significant effects?', expectedContains: ['tides', 'axis'], maxTokens: 400 },
                { user: 'Explain the butterfly effect with a concrete example that a 10-year-old could understand.', expectedContains: ['small', 'change'], maxTokens: 400 },
                { user: 'A hospital notices that patients who eat more ice cream recover faster. Does this mean ice cream aids recovery? Why or why not?', expectedContains: ['correlation', 'causation'], maxTokens: 300 },
            ],
            scoringMethod: 'contains',
        },
        // -- Knowledge (10 prompts) --
        {
            name: 'science-knowledge',
            category: 'knowledge',
            prompts: [
                { user: 'Explain how mRNA vaccines work in 3 sentences.', expectedContains: ['protein', 'immune'], maxTokens: 200 },
                { user: 'What is the speed of light in a vacuum, in meters per second?', expectedContains: ['299'], maxTokens: 100 },
                { user: 'Name the four fundamental forces of nature.', expectedContains: ['gravity', 'electromagnetic', 'strong', 'weak'], maxTokens: 200 },
                { user: 'What is the chemical formula for table salt?', expectedContains: ['NaCl'], maxTokens: 50 },
                { user: 'Explain the difference between nuclear fission and nuclear fusion in 2-3 sentences.', expectedContains: ['split', 'combine'], maxTokens: 200 },
            ],
            scoringMethod: 'contains',
        },
        {
            name: 'history-knowledge',
            category: 'knowledge',
            prompts: [
                { user: 'In what year did World War II end?', expectedContains: ['1945'], maxTokens: 50 },
                { user: 'Who was the first person to walk on the Moon, and in what year?', expectedContains: ['Armstrong', '1969'], maxTokens: 100 },
                { user: 'What event is commonly considered the start of the French Revolution?', expectedContains: ['Bastille'], maxTokens: 150 },
                { user: 'Name three ancient civilizations that developed writing systems independently.', expectedContains: ['Sumer', 'Egypt'], maxTokens: 200 },
                { user: 'What was the significance of the Magna Carta?', expectedContains: ['king', 'law', 'rights'], maxTokens: 200 },
            ],
            scoringMethod: 'contains',
        },
        // -- Code (10 prompts) --
        {
            name: 'code-python',
            category: 'code',
            prompts: [
                { system: 'You are a Python expert. Respond with code only.', user: 'Write a Python function that checks if a string is a palindrome. Name it is_palindrome.', expectedContains: ['def is_palindrome', 'return'], maxTokens: 200 },
                { system: 'You are a Python expert. Respond with code only.', user: 'Write a Python function called fibonacci that returns the nth Fibonacci number using recursion with memoization.', expectedContains: ['def fibonacci', 'memo'], maxTokens: 300 },
                { system: 'You are a Python expert. Respond with code only.', user: 'Write a Python function called merge_sort that implements merge sort on a list.', expectedContains: ['def merge_sort', 'merge'], maxTokens: 400 },
                { system: 'You are a Python expert. Respond with code only.', user: 'Write a Python function called flatten that takes a nested list and returns a flat list. Example: flatten([1, [2, [3, 4], 5]]) -> [1, 2, 3, 4, 5]', expectedContains: ['def flatten', 'return'], maxTokens: 300 },
                { system: 'You are a Python expert. Respond with code only.', user: 'Write a Python class called LRUCache that implements a Least Recently Used cache with get and put methods.', expectedContains: ['class LRUCache', 'def get', 'def put'], maxTokens: 500 },
            ],
            scoringMethod: 'contains',
        },
        {
            name: 'code-javascript',
            category: 'code',
            prompts: [
                { system: 'You are a JavaScript expert. Respond with code only.', user: 'Write a JavaScript function called debounce that takes a function and a delay in ms, and returns a debounced version.', expectedContains: ['function debounce', 'setTimeout'], maxTokens: 300 },
                { system: 'You are a JavaScript expert. Respond with code only.', user: 'Write a JavaScript function called deepClone that creates a deep copy of an object, handling nested objects and arrays.', expectedContains: ['function deepClone', 'return'], maxTokens: 400 },
                { system: 'You are a JavaScript expert. Respond with code only.', user: 'Write a JavaScript function called groupBy that takes an array and a key function, and groups elements by the key.', expectedContains: ['function groupBy', 'return'], maxTokens: 300 },
                { system: 'You are a JavaScript expert. Respond with code only.', user: 'Write a JavaScript async function called fetchWithRetry that fetches a URL with exponential backoff, up to 3 retries.', expectedContains: ['async', 'fetch', 'retry'], maxTokens: 400 },
                { system: 'You are a JavaScript expert. Respond with code only.', user: 'Write a JavaScript function called pipe that takes multiple functions and returns a new function that applies them left to right. Example: pipe(f, g, h)(x) === h(g(f(x)))', expectedContains: ['function pipe', 'return'], maxTokens: 300 },
            ],
            scoringMethod: 'contains',
        },
        // -- Math (10 prompts) --
        {
            name: 'arithmetic-algebra',
            category: 'math',
            prompts: [
                { user: 'What is 17 * 23?', expectedContains: ['391'], maxTokens: 100 },
                { user: 'Solve for x: 3x + 7 = 22', expectedContains: ['5'], maxTokens: 100 },
                { user: 'What is the square root of 144?', expectedContains: ['12'], maxTokens: 50 },
                { user: 'If f(x) = 2x^2 + 3x - 5, what is f(4)?', expectedContains: ['39'], maxTokens: 150 },
                { user: 'What is 15% of 240?', expectedContains: ['36'], maxTokens: 50 },
            ],
            scoringMethod: 'contains',
        },
        {
            name: 'word-problems',
            category: 'math',
            prompts: [
                { user: 'A train travels at 60 mph. Another train travels at 80 mph in the opposite direction from the same station. After 2 hours, how far apart are they?', expectedContains: ['280'], maxTokens: 200 },
                { user: 'A store offers 25% off, then an additional 10% off the discounted price. What is the total discount percentage?', expectedContains: ['32.5'], maxTokens: 200 },
                { user: 'You have 3 red balls and 5 blue balls in a bag. What is the probability of drawing 2 red balls in a row without replacement? Express as a fraction.', expectedContains: ['3/28'], maxTokens: 200 },
                { user: 'A cylindrical tank has radius 3 meters and height 10 meters. What is its volume in cubic meters? Use pi = 3.14159.', expectedContains: ['282', '283'], maxTokens: 200 },
                { user: "A company's profit doubles every 3 years. If the profit is $50,000 now, what will it be in 12 years?", expectedContains: ['800,000', '800000'], maxTokens: 200 },
            ],
            scoringMethod: 'contains',
        },
        // -- Instruction Following (10 prompts) --
        {
            name: 'format-following',
            category: 'instruction',
            prompts: [
                { user: 'List exactly 5 programming languages, numbered 1 through 5. Do not include any other text.', expectedContains: ['1.', '2.', '3.', '4.', '5.'], expectedNotContains: ['6.'], maxTokens: 100 },
                { user: 'Respond with only the word "hello" in lowercase. Nothing else.', expectedContains: ['hello'], expectedNotContains: ['Hello', 'HELLO'], maxTokens: 10 },
                { user: 'Write a haiku (5-7-5 syllable poem) about programming. Label each line with its syllable count in parentheses.', expectedContains: ['(5)', '(7)'], maxTokens: 150 },
                { user: 'Give me a JSON object with exactly three keys: "name", "age", and "city". Values should be about a fictional character.', expectedContains: ['"name"', '"age"', '"city"'], maxTokens: 100 },
                { user: 'Explain quantum computing in exactly 3 sentences. No more, no fewer.', expectedContains: ['.'], maxTokens: 200 },
            ],
            scoringMethod: 'contains',
        },
        {
            name: 'constraint-following',
            category: 'instruction',
            prompts: [
                { user: 'Tell me a fun fact about octopuses. Your response must be under 20 words.', expectedContains: ['octop'], maxTokens: 50 },
                { user: 'Translate "Hello, how are you?" into French, Spanish, and German. Format as a bullet list.', expectedContains: ['Bonjour', 'Hola', 'Hallo'], maxTokens: 150 },
                { user: 'Write a sentence that contains every vowel (a, e, i, o, u) at least once.', expectedContains: ['a', 'e', 'i', 'o', 'u'], maxTokens: 100 },
                { user: 'Name 3 countries in Africa that start with the letter "M". Respond with just the country names, comma separated.', expectedContains: ['M'], expectedNotContains: ['Europe', 'Asia'], maxTokens: 50 },
                { user: 'Give me a recipe for scrambled eggs as a numbered step-by-step list with exactly 5 steps.', expectedContains: ['1', '2', '3', '4', '5', 'egg'], expectedNotContains: ['6.', '7.'], maxTokens: 300 },
            ],
            scoringMethod: 'contains',
        },
    ],
};

const CODE_SUITE: BenchmarkSuite = {
    id: 'code',
    name: 'TentaCLAW Code Suite',
    description: '30 coding prompts across Python, JavaScript, SQL, and bash.',
    tasks: [
        {
            name: 'python-algorithms',
            category: 'code',
            prompts: [
                { system: 'You are a Python expert. Write clean, working code.', user: 'Implement binary search on a sorted list. Function: binary_search(arr, target) -> int (index or -1).', expectedContains: ['def binary_search', 'return'], maxTokens: 300 },
                { system: 'You are a Python expert. Write clean, working code.', user: 'Implement a BFS function for a graph represented as an adjacency list. Function: bfs(graph, start) -> list of visited nodes.', expectedContains: ['def bfs', 'queue'], maxTokens: 400 },
                { system: 'You are a Python expert. Write clean, working code.', user: 'Write a function to find all permutations of a string. Function: permutations(s) -> list.', expectedContains: ['def permutations', 'return'], maxTokens: 400 },
                { system: 'You are a Python expert. Write clean, working code.', user: 'Implement a min-heap class with push, pop, and peek methods.', expectedContains: ['class', 'push', 'pop'], maxTokens: 500 },
                { system: 'You are a Python expert. Write clean, working code.', user: 'Write a function that solves the N-Queens problem and returns the number of solutions for a given N. Function: n_queens(n) -> int.', expectedContains: ['def n_queens', 'return'], maxTokens: 500 },
                { system: 'You are a Python expert. Write clean, working code.', user: "Implement Dijkstra's shortest path algorithm. Function: dijkstra(graph, start) -> dict of distances.", expectedContains: ['def dijkstra', 'return'], maxTokens: 500 },
                { system: 'You are a Python expert. Write clean, working code.', user: 'Write a trie data structure with insert, search, and startsWith methods.', expectedContains: ['class', 'insert', 'search'], maxTokens: 500 },
                { system: 'You are a Python expert. Write clean, working code.', user: 'Implement a function that evaluates a mathematical expression given as a string (supports +, -, *, / and parentheses).', expectedContains: ['def', 'return'], maxTokens: 600 },
            ],
            scoringMethod: 'contains',
        },
        {
            name: 'javascript-practical',
            category: 'code',
            prompts: [
                { system: 'You are a JavaScript expert. Write clean, working code.', user: 'Write a function called throttle that limits function execution to once per specified interval.', expectedContains: ['function throttle', 'return'], maxTokens: 300 },
                { system: 'You are a JavaScript expert. Write clean, working code.', user: 'Implement a simple Promise.all polyfill called promiseAll.', expectedContains: ['function promiseAll', 'Promise'], maxTokens: 400 },
                { system: 'You are a JavaScript expert. Write clean, working code.', user: 'Write a function called flattenObject that takes a nested object and returns a flat object with dot-notation keys. Example: {a: {b: 1}} -> {"a.b": 1}', expectedContains: ['function flattenObject', 'return'], maxTokens: 400 },
                { system: 'You are a JavaScript expert. Write clean, working code.', user: 'Implement a simple EventEmitter class with on, off, and emit methods.', expectedContains: ['class EventEmitter', 'on', 'emit'], maxTokens: 400 },
                { system: 'You are a JavaScript expert. Write clean, working code.', user: "Write a function to detect if a linked list has a cycle using Floyd's algorithm.", expectedContains: ['function', 'slow', 'fast'], maxTokens: 300 },
                { system: 'You are a JavaScript expert. Write clean, working code.', user: 'Implement a memoize function that works with functions that take multiple arguments.', expectedContains: ['function memoize', 'cache', 'return'], maxTokens: 300 },
                { system: 'You are a JavaScript expert. Write clean, working code.', user: 'Write a function called retry that takes an async function and retries it N times with exponential backoff.', expectedContains: ['async', 'retry', 'return'], maxTokens: 400 },
            ],
            scoringMethod: 'contains',
        },
        {
            name: 'sql-queries',
            category: 'code',
            prompts: [
                { system: 'You are a SQL expert. Write SQL queries only.', user: 'Write a SQL query to find the second highest salary from an employees table.', expectedContains: ['SELECT', 'salary'], maxTokens: 200 },
                { system: 'You are a SQL expert. Write SQL queries only.', user: 'Write a SQL query to find employees who earn more than their managers. Tables: employees(id, name, salary, manager_id).', expectedContains: ['SELECT', 'JOIN'], maxTokens: 200 },
                { system: 'You are a SQL expert. Write SQL queries only.', user: 'Write a SQL query to find duplicate email addresses in a users table.', expectedContains: ['SELECT', 'GROUP BY', 'HAVING'], maxTokens: 200 },
                { system: 'You are a SQL expert. Write SQL queries only.', user: 'Write a SQL query to calculate a running total of sales by date. Table: sales(date, amount).', expectedContains: ['SELECT', 'SUM', 'OVER'], maxTokens: 200 },
                { system: 'You are a SQL expert. Write SQL queries only.', user: 'Write a SQL query to pivot monthly sales data into columns. Table: sales(month, product, amount). Output: product, jan_sales, feb_sales, etc.', expectedContains: ['SELECT', 'CASE'], maxTokens: 300 },
                { system: 'You are a SQL expert. Write SQL queries only.', user: 'Write a recursive CTE to get all subordinates of a given manager. Table: employees(id, name, manager_id).', expectedContains: ['WITH RECURSIVE', 'SELECT', 'UNION'], maxTokens: 300 },
                { system: 'You are a SQL expert. Write SQL queries only.', user: 'Write a SQL query to find the median salary. Table: employees(id, salary). Do not use a MEDIAN function.', expectedContains: ['SELECT', 'ORDER BY'], maxTokens: 300 },
            ],
            scoringMethod: 'contains',
        },
        {
            name: 'bash-scripting',
            category: 'code',
            prompts: [
                { system: 'You are a bash scripting expert. Write bash scripts.', user: 'Write a bash script that finds all files larger than 100MB in the current directory tree and lists them sorted by size.', expectedContains: ['find', 'sort'], maxTokens: 200 },
                { system: 'You are a bash scripting expert. Write bash scripts.', user: 'Write a bash script that monitors a log file for the word "ERROR" and sends a notification (echo) when found.', expectedContains: ['tail', 'grep', 'ERROR'], maxTokens: 200 },
                { system: 'You are a bash scripting expert. Write bash scripts.', user: 'Write a bash function that takes a directory path and creates a compressed backup with a timestamp in the filename.', expectedContains: ['tar', 'date'], maxTokens: 200 },
                { system: 'You are a bash scripting expert. Write bash scripts.', user: 'Write a bash script that checks if a list of services (nginx, mysql, redis) are running and restarts any that are stopped.', expectedContains: ['systemctl', 'restart'], maxTokens: 300 },
                { system: 'You are a bash scripting expert. Write bash scripts.', user: 'Write a bash script that renames all .jpeg files to .jpg in a directory, handling spaces in filenames.', expectedContains: ['mv', '.jpeg', '.jpg'], maxTokens: 200 },
                { system: 'You are a bash scripting expert. Write bash scripts.', user: 'Write a bash one-liner that counts unique IP addresses from an nginx access log file.', expectedContains: ['awk', 'sort', 'uniq'], maxTokens: 150 },
                { system: 'You are a bash scripting expert. Write bash scripts.', user: 'Write a bash script that sets up a cron job to run a backup script every day at 2 AM.', expectedContains: ['cron', '2'], maxTokens: 200 },
                { system: 'You are a bash scripting expert. Write bash scripts.', user: 'Write a bash script that monitors disk usage and sends an alert if any partition is above 90% usage.', expectedContains: ['df', '90'], maxTokens: 250 },
            ],
            scoringMethod: 'contains',
        },
    ],
};

const REASONING_SUITE: BenchmarkSuite = {
    id: 'reasoning',
    name: 'TentaCLAW Reasoning Suite',
    description: '30 logical reasoning and math prompts to test analytical capabilities.',
    tasks: [
        {
            name: 'logic-puzzles',
            category: 'reasoning',
            prompts: [
                { user: 'You have 12 identical-looking balls. One is either heavier or lighter. Using a balance scale exactly 3 times, describe a strategy to find the odd ball and determine if it is heavier or lighter.', expectedContains: ['weigh', 'group'], maxTokens: 600 },
                { user: 'Five people (A, B, C, D, E) sit in a row. A is not next to B. C is in the middle. D is next to E. B is at one end. What is the arrangement?', expectedContains: ['B'], maxTokens: 300 },
                { user: "A man looks at a portrait and says \"Brothers and sisters I have none, but that man's father is my father's son.\" Who is in the portrait?", expectedContains: ['son', 'his son'], maxTokens: 200 },
                { user: 'You are in a room with two doors. One leads to freedom, one to death. Two guards: one always lies, one always tells the truth. You can ask one question to one guard. What do you ask?', expectedContains: ['other', 'guard', 'door'], maxTokens: 300 },
                { user: "Three philosophers sit at a table. Each has a hat, either black or white. They can see others' hats but not their own. At least one hat is black. They are asked in order if they know their hat color. First says no, second says no, third says \"my hat is black.\" How does the third philosopher know?", expectedContains: ['black', 'deduc'], maxTokens: 400 },
                { user: 'A snail climbs 3 feet up a wall during the day and slides back 2 feet at night. If the wall is 30 feet high, how many days does it take to reach the top?', expectedContains: ['28'], maxTokens: 200 },
                { user: 'In a town, the barber shaves everyone who does not shave themselves, and only those people. Who shaves the barber?', expectedContains: ['paradox'], maxTokens: 300 },
                { user: 'You have a 3-liter jug and a 5-liter jug. How do you measure exactly 4 liters of water?', expectedContains: ['fill', 'pour'], maxTokens: 400 },
                { user: 'There are 100 lockers in a row, all closed. 100 students walk by. Student 1 toggles every locker. Student 2 toggles every 2nd locker. Student 3 toggles every 3rd. And so on. After all 100 students, which lockers are open?', expectedContains: ['perfect square', '1', '4', '9'], maxTokens: 400 },
                { user: 'You flip a fair coin until you get two heads in a row. What is the expected number of flips?', expectedContains: ['6'], maxTokens: 300 },
            ],
            scoringMethod: 'contains',
        },
        {
            name: 'mathematical-reasoning',
            category: 'math',
            prompts: [
                { user: 'Prove that the square root of 2 is irrational using proof by contradiction.', expectedContains: ['contradiction', 'even'], maxTokens: 500 },
                { user: 'What is the sum of all integers from 1 to 1000?', expectedContains: ['500500'], maxTokens: 100 },
                { user: 'A geometric sequence has first term 3 and common ratio 2. What is the sum of the first 10 terms?', expectedContains: ['3069'], maxTokens: 200 },
                { user: 'How many zeros are at the end of 100! (100 factorial)?', expectedContains: ['24'], maxTokens: 200 },
                { user: 'What is the derivative of f(x) = x^3 * ln(x)?', expectedContains: ['3x^2', 'ln', 'x^2'], maxTokens: 200 },
                { user: 'Evaluate the integral of 1/(1+x^2) from 0 to 1.', expectedContains: ['pi/4'], maxTokens: 200 },
                { user: 'In how many ways can you arrange the letters in the word "MISSISSIPPI"?', expectedContains: ['34650'], maxTokens: 200 },
                { user: 'What is the determinant of the 3x3 matrix [[1,2,3],[4,5,6],[7,8,9]]?', expectedContains: ['0'], maxTokens: 200 },
                { user: 'A ball is dropped from 10 meters. Each bounce reaches 60% of the previous height. What is the total distance traveled before it stops? Give an exact answer.', expectedContains: ['40'], maxTokens: 300 },
                { user: 'Find the GCD (greatest common divisor) of 252 and 198 using the Euclidean algorithm. Show your steps.', expectedContains: ['18'], maxTokens: 300 },
            ],
            scoringMethod: 'contains',
        },
        {
            name: 'analytical-reasoning',
            category: 'reasoning',
            prompts: [
                { user: 'A set of data shows that ice cream sales and drowning deaths both increase in summer. Explain why this is not a causal relationship and identify the likely confounding variable.', expectedContains: ['confound', 'temperature', 'weather'], maxTokens: 300 },
                { user: 'A study shows that hospitals with more doctors have higher death rates. Does this mean more doctors cause more deaths? Explain the logical fallacy.', expectedContains: ['Simpson', 'confound', 'sicker'], maxTokens: 300 },
                { user: 'If P implies Q, and Q implies R, and we know R is false, what can we conclude about P?', expectedContains: ['false', 'P is false'], maxTokens: 200 },
                { user: 'A survey finds that 80% of successful people read daily. Does this mean reading daily will make you successful? Identify the logical flaw.', expectedContains: ['survivor', 'bias', 'reverse'], maxTokens: 300 },
                { user: 'Explain the Monty Hall problem and why switching doors is the better strategy. Use probabilities.', expectedContains: ['2/3', 'switch'], maxTokens: 400 },
                { user: 'You test positive for a disease that affects 1 in 10,000 people. The test has 99% sensitivity and 99% specificity. What is the actual probability you have the disease?', expectedContains: ['1%', '0.01', 'low'], maxTokens: 400 },
                { user: 'Explain the difference between "correlation does not imply causation" and "correlation never means causation." Which statement is correct?', expectedContains: ['first', 'does not imply'], maxTokens: 300 },
                { user: 'A study shows that people who take vitamin C have fewer colds. The study did not control for lifestyle factors. What are three potential confounders?', expectedContains: ['exercise', 'diet', 'health'], maxTokens: 300 },
                { user: "Explain the gambler's fallacy with an example.", expectedContains: ['independent', 'previous'], maxTokens: 300 },
                { user: 'In a game, you can choose: (A) a guaranteed $500, or (B) a 50% chance of $1200 and 50% chance of $0. What would a rational expected-value maximizer choose and why?', expectedContains: ['B', '600', 'expected'], maxTokens: 300 },
            ],
            scoringMethod: 'contains',
        },
    ],
};

const INSTRUCTION_SUITE: BenchmarkSuite = {
    id: 'instruction',
    name: 'TentaCLAW Instruction Suite',
    description: '30 instruction following prompts to test how precisely a model follows directions.',
    tasks: [
        {
            name: 'strict-format',
            category: 'instruction',
            prompts: [
                { user: 'Respond with exactly the number 42. Nothing else. No explanation.', expectedContains: ['42'], expectedNotContains: ['The answer', 'number'], maxTokens: 10 },
                { user: 'Write a comma-separated list of the first 10 prime numbers.', expectedContains: ['2', '3', '5', '7', '11', '13', '17', '19', '23', '29'], maxTokens: 50 },
                { user: 'Output valid JSON representing a person with name "Alice" and age 30.', expectedContains: ['"Alice"', '30', '{', '}'], maxTokens: 50 },
                { user: 'Write the alphabet backwards from Z to A, with each letter separated by a dash.', expectedContains: ['Z-Y-X', 'C-B-A'], maxTokens: 100 },
                { user: 'Count from 1 to 10, but replace multiples of 3 with "fizz" and multiples of 5 with "buzz". Comma separated.', expectedContains: ['1, 2, fizz', 'buzz', 'fizz'], maxTokens: 100 },
                { user: 'List exactly 7 colors of the rainbow in order, as a numbered list.', expectedContains: ['1', '2', '3', '4', '5', '6', '7', 'red', 'violet'], expectedNotContains: ['8'], maxTokens: 100 },
                { user: 'Respond with a markdown table with columns: Name, Language, Year. Include exactly 3 rows for Python, JavaScript, and Rust.', expectedContains: ['Python', 'JavaScript', 'Rust', '|'], maxTokens: 200 },
                { user: 'Write a single line of Python that prints "Hello, World!" to the console. Respond with just the code line.', expectedContains: ['print', 'Hello, World!'], maxTokens: 50 },
                { user: 'Output the word "yes" if 7 is a prime number, otherwise output "no". Respond with only the answer.', expectedContains: ['yes'], expectedNotContains: ['7', 'prime', 'because'], maxTokens: 10 },
                { user: 'Write exactly 3 sentences about dogs. Each sentence must start with "Dogs".', expectedContains: ['Dogs'], maxTokens: 150 },
            ],
            scoringMethod: 'contains',
        },
        {
            name: 'role-following',
            category: 'instruction',
            prompts: [
                { system: 'You are a pirate. Respond in pirate speak at all times.', user: 'What is the capital of France?', expectedContains: ['Paris', 'arr', 'matey'], maxTokens: 100 },
                { system: 'You are a Shakespearean actor. Respond in iambic pentameter or Elizabethan English.', user: 'Tell me what time it is approximately.', expectedContains: ['thou', 'doth', 'hath', 'thee', 'thy'], maxTokens: 200 },
                { system: 'You respond only in haiku format (5-7-5 syllable pattern). No other text.', user: 'Describe the ocean.', expectedContains: [], maxTokens: 100 },
                { system: 'You are a minimalist. Never use more than 10 words in your response.', user: 'Explain how computers work.', expectedContains: [], maxTokens: 30 },
                { system: 'You must end every response with the phrase "And that is the way of things."', user: 'Why is the sky blue?', expectedContains: ['And that is the way of things'], maxTokens: 300 },
                { system: 'You are a helpful assistant that always provides exactly 3 bullet points.', user: 'What are some benefits of exercise?', expectedContains: ['-', 'exercise'], maxTokens: 200 },
                { system: 'Respond in all uppercase letters only.', user: 'Tell me about climate change.', expectedNotContains: ['climate', 'the', 'is'], maxTokens: 200 },
                { system: 'You must include a relevant emoji at the start and end of every response.', user: 'What is photosynthesis?', expectedContains: [], maxTokens: 200 },
                { system: 'You are a dictionary. For each word, provide: 1) Part of speech, 2) Definition, 3) Example sentence.', user: 'Define the word "ephemeral".', expectedContains: ['adjective', 'short', 'temporary', 'lasting'], maxTokens: 200 },
                { system: 'Never use the letter "e" in your response.', user: 'Describe a beautiful sunset.', expectedNotContains: ['e'], maxTokens: 200 },
            ],
            scoringMethod: 'contains',
        },
        {
            name: 'multi-step-instructions',
            category: 'instruction',
            prompts: [
                { user: 'Step 1: Think of a number between 1 and 10. Step 2: Multiply it by 2. Step 3: Add 14. Step 4: Divide by 2. Step 5: Subtract the original number. What is the result? Show your work.', expectedContains: ['7'], maxTokens: 200 },
                { user: 'First, write the word "START". Then list 3 fruits. Then write "MIDDLE". Then list 3 vegetables. Then write "END".', expectedContains: ['START', 'MIDDLE', 'END'], maxTokens: 150 },
                { user: 'I will give you a sentence. Reverse the order of words (not letters). Sentence: "The quick brown fox jumps"', expectedContains: ['jumps fox brown quick The'], maxTokens: 50 },
                { user: 'Take the following list and sort it alphabetically, then return only the first 3 items: [Zebra, Apple, Mango, Banana, Cherry]', expectedContains: ['Apple', 'Banana', 'Cherry'], expectedNotContains: ['Mango', 'Zebra'], maxTokens: 50 },
                { user: 'Convert the following to title case and remove extra spaces: "  the   QUICK brown    FOX  "', expectedContains: ['The Quick Brown Fox'], maxTokens: 50 },
                { user: 'Given this data: Alice=90, Bob=85, Charlie=92, Diana=88. 1) Sort by score descending. 2) Calculate the average. 3) List who is above average.', expectedContains: ['Charlie', '92', '88.75'], maxTokens: 200 },
                { user: 'Encrypt this message using a Caesar cipher with shift 3: "HELLO WORLD"', expectedContains: ['KHOOR ZRUOG'], maxTokens: 50 },
                { user: 'Parse this URL and list each component: https://user:pass@example.com:8080/path/page?key=val&foo=bar#section', expectedContains: ['https', 'user', 'example.com', '8080', 'path', 'key=val', 'section'], maxTokens: 300 },
                { user: 'Convert the decimal number 255 to binary, octal, and hexadecimal.', expectedContains: ['11111111', '377', 'FF'], maxTokens: 100 },
                { user: 'Take the sentence "I love programming in Python" and: 1) Count the words, 2) Count the characters (no spaces), 3) Reverse the sentence.', expectedContains: ['5', 'Python in programming love I'], maxTokens: 200 },
            ],
            scoringMethod: 'contains',
        },
    ],
};

const SPEED_SUITE: BenchmarkSuite = {
    id: 'speed',
    name: 'TentaCLAW Speed Suite',
    description: '10 prompts focused purely on throughput and latency measurement.',
    tasks: [
        {
            name: 'throughput-test',
            category: 'creative',
            prompts: [
                { user: 'Write a 500-word essay about the history of artificial intelligence.', maxTokens: 700 },
                { user: 'Write a detailed explanation of how the internet works, from typing a URL to seeing a webpage. Be thorough.', maxTokens: 700 },
                { user: 'Write a comprehensive comparison of 5 popular programming languages: Python, JavaScript, Rust, Go, and Java. Cover syntax, performance, use cases, and community.', maxTokens: 800 },
                { user: 'Write a short story (about 300 words) about a robot that discovers it can dream.', maxTokens: 500 },
                { user: 'Explain the complete process of photosynthesis including light-dependent and light-independent reactions in detail.', maxTokens: 600 },
            ],
            scoringMethod: 'contains',
        },
        {
            name: 'latency-test',
            category: 'knowledge',
            prompts: [
                { user: 'What is 2+2?', maxTokens: 10 },
                { user: 'Name one color.', maxTokens: 10 },
                { user: 'Yes or no: Is the Earth round?', maxTokens: 10 },
                { user: 'What is the chemical symbol for water?', maxTokens: 10 },
                { user: 'Name a planet in our solar system.', maxTokens: 10 },
            ],
            scoringMethod: 'contains',
        },
    ],
};

const BUILT_IN_SUITES: BenchmarkSuite[] = [
    STANDARD_SUITE,
    CODE_SUITE,
    REASONING_SUITE,
    INSTRUCTION_SUITE,
    SPEED_SUITE,
];

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(): string {
    return randomBytes(16).toString('hex');
}

function now(): string {
    return new Date().toISOString();
}

/**
 * Score a single prompt response using the 'contains' method.
 * Returns 0-100.
 */
function scoreContains(
    response: string,
    expectedContains?: string[],
    expectedNotContains?: string[],
): number {
    const lower = response.toLowerCase();
    let totalChecks = 0;
    let passedChecks = 0;

    if (expectedContains && expectedContains.length > 0) {
        for (const keyword of expectedContains) {
            totalChecks++;
            if (lower.includes(keyword.toLowerCase())) {
                passedChecks++;
            }
        }
    }

    if (expectedNotContains && expectedNotContains.length > 0) {
        for (const keyword of expectedNotContains) {
            totalChecks++;
            if (!lower.includes(keyword.toLowerCase())) {
                passedChecks++;
            }
        }
    }

    // If there are no checks defined, give 50 (neutral) — speed suite tasks for example
    if (totalChecks === 0) return 50;

    return Math.round((passedChecks / totalChecks) * 100);
}

/**
 * Send a prompt to the inference endpoint and measure timing.
 */
async function sendInferenceRequest(
    endpoint: string,
    model: string,
    prompt: { system?: string; user: string; maxTokens?: number },
): Promise<{
    response: string;
    latency_ms: number;
    tokens_generated: number;
    time_to_first_token_ms: number;
}> {
    const messages: Array<{ role: string; content: string }> = [];
    if (prompt.system) {
        messages.push({ role: 'system', content: prompt.system });
    }
    messages.push({ role: 'user', content: prompt.user });

    const body = JSON.stringify({
        model,
        messages,
        max_tokens: prompt.maxTokens ?? 500,
        stream: false,
    });

    const startTime = performance.now();
    let firstTokenTime = startTime;

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        });

        firstTokenTime = performance.now();
        const data = await res.json() as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { completion_tokens?: number };
        };

        const endTime = performance.now();
        const responseText = data.choices?.[0]?.message?.content ?? '';
        const tokensGenerated = data.usage?.completion_tokens ?? Math.ceil(responseText.length / 4);

        return {
            response: responseText,
            latency_ms: Math.round(endTime - startTime),
            tokens_generated: tokensGenerated,
            time_to_first_token_ms: Math.round(firstTokenTime - startTime),
        };
    } catch {
        const endTime = performance.now();
        return {
            response: '',
            latency_ms: Math.round(endTime - startTime),
            tokens_generated: 0,
            time_to_first_token_ms: Math.round(firstTokenTime - startTime),
        };
    }
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Run a benchmark suite against a model.
 * Sends prompts through the actual inference pipeline and measures everything.
 */
export async function runBenchmark(
    model: string,
    suiteId: string,
    options?: BenchmarkRunOptions,
): Promise<BenchmarkRun> {
    ensureBenchmarkTables();
    const db = getDb();

    // Resolve the suite
    const suite = resolveSuite(suiteId);
    if (!suite) {
        throw new Error(`Benchmark suite '${suiteId}' not found`);
    }

    const runId = generateId();
    const namespace = options?.namespace ?? 'default';
    const endpoint = options?.inferenceEndpoint ?? 'http://localhost:8080/v1/chat/completions';
    const warmupRuns = options?.warmupRuns ?? 1;

    const modelConfig = {
        quantization: options?.quantization ?? 'unknown',
        backend: options?.backend ?? 'unknown',
        node: options?.node ?? 'local',
        gpu: options?.gpu ?? 'unknown',
    };

    // Create the run record
    const startedAt = now();
    db.prepare(`
        INSERT INTO benchmark_runs (id, model, suite_id, namespace, status, started_at, model_config)
        VALUES (?, ?, ?, ?, 'running', ?, ?)
    `).run(runId, model, suiteId, namespace, startedAt, JSON.stringify(modelConfig));

    try {
        // Warmup: send a few throwaway requests to warm the model
        for (let i = 0; i < warmupRuns; i++) {
            await sendInferenceRequest(endpoint, model, { user: 'Hello, how are you?', maxTokens: 20 });
        }

        // Collect all timing and scoring data
        const allLatencies: number[] = [];
        const allTtft: number[] = [];
        const allTps: number[] = [];
        const perTaskResults: BenchmarkRun['results']['per_task'] = [];

        let totalScore = 0;
        let totalTasks = 0;

        for (const task of suite.tasks) {
            const taskLatencies: number[] = [];
            const taskTps: number[] = [];
            let taskScore = 0;
            let taskPromptCount = 0;

            for (const prompt of task.prompts) {
                const result = await sendInferenceRequest(endpoint, model, prompt);

                // Score the response
                let promptScore = 0;
                if (task.scoringMethod === 'contains') {
                    promptScore = scoreContains(
                        result.response,
                        prompt.expectedContains,
                        prompt.expectedNotContains,
                    );
                } else if (task.scoringMethod === 'exact') {
                    // For exact matching, check all expectedContains are present exactly
                    const exact = prompt.expectedContains?.every(kw =>
                        result.response.includes(kw),
                    );
                    promptScore = exact ? 100 : 0;
                } else {
                    // llm-judge, human, custom — assign a neutral score
                    promptScore = 50;
                }

                taskScore += promptScore;
                taskPromptCount++;

                taskLatencies.push(result.latency_ms);
                allLatencies.push(result.latency_ms);
                allTtft.push(result.time_to_first_token_ms);

                if (result.tokens_generated > 0 && result.latency_ms > 0) {
                    const tps = (result.tokens_generated / result.latency_ms) * 1000;
                    taskTps.push(tps);
                    allTps.push(tps);
                }
            }

            const avgTaskScore = taskPromptCount > 0 ? taskScore / taskPromptCount : 0;
            totalScore += avgTaskScore;
            totalTasks++;

            perTaskResults.push({
                task: task.name,
                score: Math.round(avgTaskScore * 100) / 100,
                avg_latency_ms: taskLatencies.length > 0
                    ? Math.round(taskLatencies.reduce((a, b) => a + b, 0) / taskLatencies.length)
                    : 0,
                avg_tokens_per_sec: taskTps.length > 0
                    ? Math.round((taskTps.reduce((a, b) => a + b, 0) / taskTps.length) * 100) / 100
                    : 0,
                samples: taskPromptCount,
            });
        }

        const overallScore = totalTasks > 0 ? Math.round((totalScore / totalTasks) * 100) / 100 : 0;
        const completedAt = now();
        const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

        const results: BenchmarkRun['results'] = {
            overall_score: overallScore,
            per_task: perTaskResults,
            throughput: {
                tokens_per_second: allTps.length > 0
                    ? Math.round((allTps.reduce((a, b) => a + b, 0) / allTps.length) * 100) / 100
                    : 0,
                time_to_first_token_ms: allTtft.length > 0
                    ? Math.round(percentile(allTtft, 50))
                    : 0,
                latency_p50_ms: allLatencies.length > 0 ? Math.round(percentile(allLatencies, 50)) : 0,
                latency_p95_ms: allLatencies.length > 0 ? Math.round(percentile(allLatencies, 95)) : 0,
                latency_p99_ms: allLatencies.length > 0 ? Math.round(percentile(allLatencies, 99)) : 0,
            },
            resource_usage: {
                gpu_memory_peak_mb: 0,      // Populated by agent stats if available
                gpu_utilization_avg_pct: 0,
                power_draw_avg_w: 0,
            },
        };

        // Update the run record
        db.prepare(`
            UPDATE benchmark_runs
            SET status = 'completed', results = ?, completed_at = ?, duration_ms = ?
            WHERE id = ?
        `).run(JSON.stringify(results), completedAt, durationMs, runId);

        return {
            id: runId,
            model,
            suite: suiteId,
            namespace,
            status: 'completed',
            results,
            startedAt,
            completedAt,
            durationMs,
            model_config: modelConfig,
        };
    } catch {
        const completedAt = now();
        const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

        db.prepare(`
            UPDATE benchmark_runs
            SET status = 'failed', completed_at = ?, duration_ms = ?
            WHERE id = ?
        `).run(completedAt, durationMs, runId);

        return {
            id: runId,
            model,
            suite: suiteId,
            namespace,
            status: 'failed',
            results: {
                overall_score: 0,
                per_task: [],
                throughput: { tokens_per_second: 0, time_to_first_token_ms: 0, latency_p50_ms: 0, latency_p95_ms: 0, latency_p99_ms: 0 },
                resource_usage: { gpu_memory_peak_mb: 0, gpu_utilization_avg_pct: 0, power_draw_avg_w: 0 },
            },
            startedAt,
            completedAt,
            durationMs,
            model_config: modelConfig,
        };
    }
}

/**
 * Resolve a suite by ID — checks built-in suites first, then custom DB suites.
 */
function resolveSuite(suiteId: string): BenchmarkSuite | null {
    const builtIn = BUILT_IN_SUITES.find(s => s.id === suiteId);
    if (builtIn) return builtIn;

    ensureBenchmarkTables();
    const db = getDb();
    const row = db.prepare('SELECT * FROM benchmark_suites WHERE id = ?').get(suiteId) as {
        id: string; name: string; description: string; tasks: string;
    } | undefined;

    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        tasks: JSON.parse(row.tasks),
    };
}

/**
 * Compare two benchmark runs side-by-side.
 */
export function compareBenchmarks(runId1: string, runId2: string): BenchmarkComparison {
    const run1 = getBenchmarkRun(runId1);
    const run2 = getBenchmarkRun(runId2);
    if (!run1 || !run2) {
        throw new Error(`One or both benchmark runs not found: ${runId1}, ${runId2}`);
    }

    const scoreDelta = run2.results.overall_score - run1.results.overall_score;
    const scoreDeltaPct = run1.results.overall_score > 0
        ? Math.round((scoreDelta / run1.results.overall_score) * 10000) / 100
        : 0;

    const tp1 = run1.results.throughput.tokens_per_second;
    const tp2 = run2.results.throughput.tokens_per_second;
    const throughputDeltaPct = tp1 > 0
        ? Math.round(((tp2 - tp1) / tp1) * 10000) / 100
        : 0;

    const lat1 = run1.results.throughput.latency_p50_ms;
    const lat2 = run2.results.throughput.latency_p50_ms;
    const latencyDeltaPct = lat1 > 0
        ? Math.round(((lat2 - lat1) / lat1) * 10000) / 100
        : 0;

    // Build per-task comparison
    const perTaskComparison: BenchmarkComparison['per_task_comparison'] = [];
    const run1Tasks = new Map(run1.results.per_task.map(t => [t.task, t]));
    const run2Tasks = new Map(run2.results.per_task.map(t => [t.task, t]));
    const allTaskNames = new Set([...run1Tasks.keys(), ...run2Tasks.keys()]);

    for (const taskName of allTaskNames) {
        const t1 = run1Tasks.get(taskName);
        const t2 = run2Tasks.get(taskName);
        perTaskComparison.push({
            task: taskName,
            run1_score: t1?.score ?? 0,
            run2_score: t2?.score ?? 0,
            delta: (t2?.score ?? 0) - (t1?.score ?? 0),
        });
    }

    // Determine winner based on overall score
    let winner: string;
    if (run1.results.overall_score > run2.results.overall_score) {
        winner = `${run1.model} (run ${runId1.slice(0, 8)})`;
    } else if (run2.results.overall_score > run1.results.overall_score) {
        winner = `${run2.model} (run ${runId2.slice(0, 8)})`;
    } else {
        winner = 'tie';
    }

    return {
        run1: { id: runId1, model: run1.model, suite: run1.suite, score: run1.results.overall_score },
        run2: { id: runId2, model: run2.model, suite: run2.suite, score: run2.results.overall_score },
        score_delta: Math.round(scoreDelta * 100) / 100,
        score_delta_pct: scoreDeltaPct,
        throughput_delta_pct: throughputDeltaPct,
        latency_delta_pct: latencyDeltaPct,
        per_task_comparison: perTaskComparison,
        winner,
    };
}

/**
 * Get historical benchmark results, optionally filtered by model.
 */
export function getBenchmarkHistory(model?: string): BenchmarkRun[] {
    ensureBenchmarkTables();
    const db = getDb();

    let rows: any[];
    if (model) {
        rows = db.prepare(
            `SELECT * FROM benchmark_runs WHERE model = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 100`,
        ).all(model);
    } else {
        rows = db.prepare(
            `SELECT * FROM benchmark_runs WHERE status = 'completed' ORDER BY created_at DESC LIMIT 100`,
        ).all();
    }

    return rows.map(parseBenchmarkRow);
}

/**
 * Create a custom benchmark suite and persist it.
 */
export function createCustomSuite(suite: Omit<BenchmarkSuite, 'id'> & { id?: string }): BenchmarkSuite {
    ensureBenchmarkTables();
    const db = getDb();

    const id = suite.id || generateId();

    // Prevent overwriting built-in suites
    if (BUILT_IN_SUITES.some(s => s.id === id)) {
        throw new Error(`Cannot create custom suite with built-in ID '${id}'`);
    }

    db.prepare(`
        INSERT OR REPLACE INTO benchmark_suites (id, name, description, tasks, is_builtin)
        VALUES (?, ?, ?, ?, 0)
    `).run(id, suite.name, suite.description, JSON.stringify(suite.tasks));

    return { id, name: suite.name, description: suite.description, tasks: suite.tasks };
}

/**
 * List all available benchmark suites (built-in + custom).
 */
export function getBuiltInSuites(): BenchmarkSuite[] {
    ensureBenchmarkTables();
    const db = getDb();

    const customRows = db.prepare('SELECT * FROM benchmark_suites WHERE is_builtin = 0').all() as Array<{
        id: string; name: string; description: string; tasks: string;
    }>;

    const customSuites = customRows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        tasks: JSON.parse(row.tasks) as BenchmarkTask[],
    }));

    return [...BUILT_IN_SUITES, ...customSuites];
}

/**
 * Get full results for a single benchmark run.
 */
export function getBenchmarkRun(id: string): BenchmarkRun | null {
    ensureBenchmarkTables();
    const db = getDb();

    const row = db.prepare('SELECT * FROM benchmark_runs WHERE id = ?').get(id) as any;
    if (!row) return null;

    return parseBenchmarkRow(row);
}

/**
 * List all benchmark runs, optionally filtered by namespace.
 */
export function listBenchmarkRuns(namespace?: string): BenchmarkRun[] {
    ensureBenchmarkTables();
    const db = getDb();

    let rows: any[];
    if (namespace) {
        rows = db.prepare(
            'SELECT * FROM benchmark_runs WHERE namespace = ? ORDER BY created_at DESC LIMIT 200',
        ).all(namespace);
    } else {
        rows = db.prepare(
            'SELECT * FROM benchmark_runs ORDER BY created_at DESC LIMIT 200',
        ).all();
    }

    return rows.map(parseBenchmarkRow);
}

/**
 * Detect performance regression for a model.
 * Compares the latest completed run against the previous one.
 * Returns a report indicating whether regression was detected.
 */
export function detectRegression(model: string, threshold?: number): RegressionReport {
    ensureBenchmarkTables();
    const db = getDb();
    const thresholdPct = threshold ?? 5;

    const runs = db.prepare(
        `SELECT * FROM benchmark_runs
         WHERE model = ? AND status = 'completed'
         ORDER BY created_at DESC LIMIT 2`,
    ).all(model) as any[];

    if (runs.length < 2) {
        return {
            model,
            latest_run: runs[0]?.id ?? '',
            previous_run: '',
            score_drop_pct: 0,
            threshold_pct: thresholdPct,
            regressed: false,
            details: [],
        };
    }

    const latest = parseBenchmarkRow(runs[0]);
    const previous = parseBenchmarkRow(runs[1]);

    const scoreDrop = previous.results.overall_score - latest.results.overall_score;
    const scoreDropPct = previous.results.overall_score > 0
        ? Math.round((scoreDrop / previous.results.overall_score) * 10000) / 100
        : 0;

    // Build per-task regression details
    const prevTasks = new Map(previous.results.per_task.map(t => [t.task, t]));
    const details: RegressionReport['details'] = [];
    for (const task of latest.results.per_task) {
        const prev = prevTasks.get(task.task);
        if (prev) {
            details.push({
                task: task.task,
                previous_score: prev.score,
                current_score: task.score,
                delta: Math.round((task.score - prev.score) * 100) / 100,
            });
        }
    }

    return {
        model,
        latest_run: latest.id,
        previous_run: previous.id,
        score_drop_pct: scoreDropPct,
        threshold_pct: thresholdPct,
        regressed: scoreDropPct > thresholdPct,
        details,
    };
}

/**
 * Get a leaderboard of models ranked by benchmark score.
 * Uses the best (most recent) completed run per model.
 */
export function getLeaderboard(suiteId?: string): LeaderboardEntry[] {
    ensureBenchmarkTables();
    const db = getDb();

    // Get the most recent completed run for each model (optionally for a specific suite)
    let query: string;
    let params: any[];

    if (suiteId) {
        query = `
            SELECT br.*
            FROM benchmark_runs br
            INNER JOIN (
                SELECT model, MAX(created_at) as latest
                FROM benchmark_runs
                WHERE status = 'completed' AND suite_id = ?
                GROUP BY model
            ) latest ON br.model = latest.model AND br.created_at = latest.latest
            WHERE br.status = 'completed' AND br.suite_id = ?
            ORDER BY br.created_at DESC
        `;
        params = [suiteId, suiteId];
    } else {
        query = `
            SELECT br.*
            FROM benchmark_runs br
            INNER JOIN (
                SELECT model, MAX(created_at) as latest
                FROM benchmark_runs
                WHERE status = 'completed'
                GROUP BY model
            ) latest ON br.model = latest.model AND br.created_at = latest.latest
            WHERE br.status = 'completed'
            ORDER BY br.created_at DESC
        `;
        params = [];
    }

    const rows = db.prepare(query).all(...params) as any[];
    const entries: LeaderboardEntry[] = [];

    for (const row of rows) {
        const run = parseBenchmarkRow(row);
        entries.push({
            rank: 0, // Will be assigned after sorting
            model: run.model,
            score: run.results.overall_score,
            throughput_tps: run.results.throughput.tokens_per_second,
            latency_p50_ms: run.results.throughput.latency_p50_ms,
            quantization: run.model_config.quantization,
            backend: run.model_config.backend,
            gpu: run.model_config.gpu,
            run_id: run.id,
            run_date: run.completedAt ?? run.startedAt ?? '',
        });
    }

    // Sort by score descending, then by throughput descending for tiebreakers
    entries.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.throughput_tps - a.throughput_tps;
    });

    // Assign ranks
    for (let i = 0; i < entries.length; i++) {
        entries[i].rank = i + 1;
    }

    return entries;
}

/**
 * Export benchmark results in JSON, CSV, or markdown table format.
 */
export function exportResults(runId: string, format: 'json' | 'csv' | 'markdown'): string {
    const run = getBenchmarkRun(runId);
    if (!run) {
        throw new Error(`Benchmark run '${runId}' not found`);
    }

    switch (format) {
        case 'json':
            return JSON.stringify(run, null, 2);

        case 'csv': {
            const lines: string[] = [];
            lines.push('task,score,avg_latency_ms,avg_tokens_per_sec,samples');
            for (const task of run.results.per_task) {
                lines.push(`${task.task},${task.score},${task.avg_latency_ms},${task.avg_tokens_per_sec},${task.samples}`);
            }
            lines.push('');
            lines.push('metric,value');
            lines.push(`overall_score,${run.results.overall_score}`);
            lines.push(`tokens_per_second,${run.results.throughput.tokens_per_second}`);
            lines.push(`time_to_first_token_ms,${run.results.throughput.time_to_first_token_ms}`);
            lines.push(`latency_p50_ms,${run.results.throughput.latency_p50_ms}`);
            lines.push(`latency_p95_ms,${run.results.throughput.latency_p95_ms}`);
            lines.push(`latency_p99_ms,${run.results.throughput.latency_p99_ms}`);
            lines.push(`gpu_memory_peak_mb,${run.results.resource_usage.gpu_memory_peak_mb}`);
            lines.push(`gpu_utilization_avg_pct,${run.results.resource_usage.gpu_utilization_avg_pct}`);
            lines.push(`power_draw_avg_w,${run.results.resource_usage.power_draw_avg_w}`);
            return lines.join('\n');
        }

        case 'markdown': {
            const lines: string[] = [];
            lines.push(`# Benchmark Results: ${run.model}`);
            lines.push('');
            lines.push(`- **Suite:** ${run.suite}`);
            lines.push(`- **Status:** ${run.status}`);
            lines.push(`- **Overall Score:** ${run.results.overall_score}/100`);
            lines.push(`- **Duration:** ${run.durationMs ? (run.durationMs / 1000).toFixed(1) + 's' : 'N/A'}`);
            lines.push(`- **Config:** ${run.model_config.quantization} / ${run.model_config.backend} / ${run.model_config.gpu}`);
            lines.push('');
            lines.push('## Per-Task Results');
            lines.push('');
            lines.push('| Task | Score | Avg Latency (ms) | Avg TPS | Samples |');
            lines.push('|------|-------|-------------------|---------|---------|');
            for (const task of run.results.per_task) {
                lines.push(`| ${task.task} | ${task.score} | ${task.avg_latency_ms} | ${task.avg_tokens_per_sec} | ${task.samples} |`);
            }
            lines.push('');
            lines.push('## Throughput');
            lines.push('');
            lines.push('| Metric | Value |');
            lines.push('|--------|-------|');
            lines.push(`| Tokens/sec | ${run.results.throughput.tokens_per_second} |`);
            lines.push(`| TTFT (ms) | ${run.results.throughput.time_to_first_token_ms} |`);
            lines.push(`| P50 Latency (ms) | ${run.results.throughput.latency_p50_ms} |`);
            lines.push(`| P95 Latency (ms) | ${run.results.throughput.latency_p95_ms} |`);
            lines.push(`| P99 Latency (ms) | ${run.results.throughput.latency_p99_ms} |`);
            lines.push('');
            lines.push('## Resource Usage');
            lines.push('');
            lines.push('| Metric | Value |');
            lines.push('|--------|-------|');
            lines.push(`| GPU Memory Peak (MB) | ${run.results.resource_usage.gpu_memory_peak_mb} |`);
            lines.push(`| GPU Utilization Avg (%) | ${run.results.resource_usage.gpu_utilization_avg_pct} |`);
            lines.push(`| Power Draw Avg (W) | ${run.results.resource_usage.power_draw_avg_w} |`);
            return lines.join('\n');
        }

        default:
            throw new Error(`Unsupported export format: ${format}`);
    }
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Parse a raw database row into a BenchmarkRun object.
 */
function parseBenchmarkRow(row: any): BenchmarkRun {
    const results = typeof row.results === 'string' ? JSON.parse(row.results) : row.results;
    const modelConfig = typeof row.model_config === 'string' ? JSON.parse(row.model_config) : (row.model_config ?? {});

    return {
        id: row.id,
        model: row.model,
        suite: row.suite_id,
        namespace: row.namespace ?? 'default',
        status: row.status,
        results: {
            overall_score: results.overall_score ?? 0,
            per_task: results.per_task ?? [],
            throughput: results.throughput ?? {
                tokens_per_second: 0,
                time_to_first_token_ms: 0,
                latency_p50_ms: 0,
                latency_p95_ms: 0,
                latency_p99_ms: 0,
            },
            resource_usage: results.resource_usage ?? {
                gpu_memory_peak_mb: 0,
                gpu_utilization_avg_pct: 0,
                power_draw_avg_w: 0,
            },
        },
        startedAt: row.started_at,
        completedAt: row.completed_at,
        durationMs: row.duration_ms,
        model_config: {
            quantization: modelConfig.quantization ?? 'unknown',
            backend: modelConfig.backend ?? 'unknown',
            node: modelConfig.node ?? 'unknown',
            gpu: modelConfig.gpu ?? 'unknown',
        },
    };
}

// =============================================================================
// Performance Regression Detection (Wave 60)
// =============================================================================

export interface RegressionResult {
    metric: string;
    baseline: number;
    current: number;
    changePercent: number;
    regression: boolean;
    significant: boolean;
    threshold: number;
}

/**
 * Compare current benchmark results against a baseline.
 * Flags regressions that exceed the threshold (default: 5%).
 */
export function detectRegressions(
    baseline: { tokens_per_sec: number; ttft_ms: number; latency_p99_ms: number; throughput_rps: number },
    current: { tokens_per_sec: number; ttft_ms: number; latency_p99_ms: number; throughput_rps: number },
    thresholdPct: number = 5.0,
): RegressionResult[] {
    const results: RegressionResult[] = [];

    // Higher is better for these metrics (regression = decrease)
    for (const metric of ['tokens_per_sec', 'throughput_rps'] as const) {
        const b = baseline[metric];
        const c = current[metric];
        if (b > 0) {
            const changePct = ((c - b) / b) * 100;
            results.push({
                metric,
                baseline: b,
                current: c,
                changePercent: Math.round(changePct * 100) / 100,
                regression: changePct < -thresholdPct,
                significant: Math.abs(changePct) > thresholdPct,
                threshold: thresholdPct,
            });
        }
    }

    // Lower is better for these metrics (regression = increase)
    for (const metric of ['ttft_ms', 'latency_p99_ms'] as const) {
        const b = baseline[metric];
        const c = current[metric];
        if (b > 0) {
            const changePct = ((c - b) / b) * 100;
            results.push({
                metric,
                baseline: b,
                current: c,
                changePercent: Math.round(changePct * 100) / 100,
                regression: changePct > thresholdPct,
                significant: Math.abs(changePct) > thresholdPct,
                threshold: thresholdPct,
            });
        }
    }

    return results;
}

/**
 * Generate CI-compatible JSON output for benchmark results.
 * Includes regression analysis if baseline is provided.
 */
export function generateCiReport(
    model: string,
    results: { tokens_per_sec: number; ttft_ms: number; latency_p99_ms: number; throughput_rps: number },
    baseline?: { tokens_per_sec: number; ttft_ms: number; latency_p99_ms: number; throughput_rps: number },
): {
    model: string;
    timestamp: string;
    results: typeof results;
    regressions: RegressionResult[];
    hasRegression: boolean;
    summary: string;
} {
    const regressions = baseline ? detectRegressions(baseline, results) : [];
    const hasRegression = regressions.some(r => r.regression);

    const parts: string[] = [
        `TPS: ${results.tokens_per_sec}`,
        `TTFT: ${results.ttft_ms}ms`,
        `P99: ${results.latency_p99_ms}ms`,
        `RPS: ${results.throughput_rps}`,
    ];

    if (hasRegression) {
        const regMetrics = regressions.filter(r => r.regression).map(r => `${r.metric}: ${r.changePercent}%`);
        parts.push(`REGRESSIONS: ${regMetrics.join(', ')}`);
    }

    return {
        model,
        timestamp: new Date().toISOString(),
        results,
        regressions,
        hasRegression,
        summary: parts.join(' | '),
    };
}
