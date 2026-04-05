/**
 * CLAWHub Registry Server
 *
 * The backend for the TentaCLAW package marketplace.
 * Serves packages: agents, skills, model configs, integrations, themes.
 *
 * TentaCLAW says: "Every tentacle deserves the right tool."
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PackageVersion {
    version: string;
    manifest: Record<string, unknown>;
    digest: string;
    size: number;
    published_at: string;
}

export interface Package {
    name: string;           // @ns/package-name
    type: string;
    title: string;
    description: string;
    versions: Map<string, PackageVersion>;
    latest: string;
    stars: number;
    starredBy: Set<string>;
    downloads: number;
    publisher: string;
    category?: string;
    tags: string[];
    featured: boolean;
    created_at: string;
    updated_at: string;
}

// ---------------------------------------------------------------------------
// In-memory storage
// ---------------------------------------------------------------------------

const packages = new Map<string, Package>();

/** Helper: parse @ns/name from route params */
function pkgKey(ns: string, name: string): string {
    return `@${ns}/${name}`;
}

/** SHA-256 hex digest of an object */
function sha256(obj: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

/** Serialise a Package for JSON responses (Maps/Sets -> plain objects) */
function serialisePkg(pkg: Package) {
    const versions: Record<string, PackageVersion> = {};
    for (const [v, pv] of pkg.versions) {
        versions[v] = pv;
    }
    return {
        name: pkg.name,
        type: pkg.type,
        title: pkg.title,
        description: pkg.description,
        versions,
        latest: pkg.latest,
        stars: pkg.stars,
        downloads: pkg.downloads,
        publisher: pkg.publisher,
        category: pkg.category,
        tags: pkg.tags,
        featured: pkg.featured,
        created_at: pkg.created_at,
        updated_at: pkg.updated_at,
    };
}

/** Serialise a Package in a compact list format (no full version map) */
function serialisePkgSummary(pkg: Package) {
    return {
        name: pkg.name,
        type: pkg.type,
        title: pkg.title,
        description: pkg.description,
        latest: pkg.latest,
        stars: pkg.stars,
        downloads: pkg.downloads,
        publisher: pkg.publisher,
        category: pkg.category,
        tags: pkg.tags,
        featured: pkg.featured,
        created_at: pkg.created_at,
        updated_at: pkg.updated_at,
    };
}

/** Simple semver-ish comparison (major.minor.patch) */
function semverCompare(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/** Paginate an array */
function paginate<T>(items: T[], page: number, limit: number): { items: T[]; total: number; page: number; limit: number; pages: number } {
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    return {
        items: items.slice(start, start + limit),
        total,
        page,
        limit,
        pages,
    };
}

// ---------------------------------------------------------------------------
// Valid package types
// ---------------------------------------------------------------------------

const VALID_TYPES = new Set(['agent', 'skill', 'model-config', 'integration', 'theme']);

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

export function createRegistry(): Hono {
    const app = new Hono();

    // ── Middleware ──────────────────────────────────────────────────────
    app.use('/*', cors());

    // ── Health ─────────────────────────────────────────────────────────
    app.get('/health', (c) => {
        return c.json({ status: 'ok', service: 'clawhub-registry', timestamp: new Date().toISOString() });
    });

    // ── Root ───────────────────────────────────────────────────────────
    app.get('/', (c) => {
        return c.json({
            service: 'CLAWHub Registry',
            version: '0.1.0',
            endpoints: {
                packages: '/v1/packages',
                search: '/v1/search',
                categories: '/v1/categories',
                trending: '/v1/trending',
                featured: '/v1/featured',
                stats: '/v1/stats',
                publishers: '/v1/publishers/:username',
            },
        });
    });

    // ====================================================================
    // Package CRUD
    // ====================================================================

    // ── POST /v1/packages — publish a new package ──────────────────────
    app.post('/v1/packages', async (c) => {
        let body: Record<string, unknown>;
        try {
            body = await c.req.json() as Record<string, unknown>;
        } catch {
            return c.json({ error: 'Invalid JSON body' }, 400);
        }

        const name = body.name as string | undefined;
        const type = body.type as string | undefined;
        const title = body.title as string | undefined;
        const description = body.description as string | undefined;
        const version = body.version as string | undefined;
        const publisher = body.publisher as string | undefined;
        const category = body.category as string | undefined;
        const tags = (body.tags as string[] | undefined) || [];

        if (!name || !type || !version || !publisher) {
            return c.json({ error: 'Missing required fields: name, type, version, publisher' }, 400);
        }

        // Validate name format: @namespace/package-name
        if (!/^@[\w-]+\/[\w-]+$/.test(name)) {
            return c.json({ error: 'Invalid package name — must match @namespace/package-name' }, 400);
        }

        if (!VALID_TYPES.has(type)) {
            return c.json({ error: `Invalid type — must be one of: ${[...VALID_TYPES].join(', ')}` }, 400);
        }

        // Version format check
        if (!/^\d+\.\d+\.\d+/.test(version)) {
            return c.json({ error: 'Invalid version — must be semver (e.g. 1.0.0)' }, 400);
        }

        const now = new Date().toISOString();
        const digest = sha256(body);
        const size = Buffer.byteLength(JSON.stringify(body), 'utf8');

        const pkgVersion: PackageVersion = {
            version,
            manifest: body,
            digest,
            size,
            published_at: now,
        };

        let pkg = packages.get(name);

        if (pkg) {
            // Existing package — add version
            if (pkg.versions.has(version)) {
                return c.json({ error: `Version ${version} already exists for ${name}` }, 409);
            }
            pkg.versions.set(version, pkgVersion);
            // Update latest if this version is newer
            if (semverCompare(version, pkg.latest) > 0) {
                pkg.latest = version;
            }
            pkg.updated_at = now;
            // Allow updating mutable metadata on publish
            if (title) pkg.title = title;
            if (description) pkg.description = description;
            if (category) pkg.category = category;
            if (tags.length > 0) pkg.tags = tags;
        } else {
            // New package
            pkg = {
                name,
                type,
                title: title || name,
                description: description || '',
                versions: new Map([[version, pkgVersion]]),
                latest: version,
                stars: 0,
                starredBy: new Set(),
                downloads: 0,
                publisher,
                category,
                tags,
                featured: false,
                created_at: now,
                updated_at: now,
            };
            packages.set(name, pkg);
        }

        return c.json({
            ok: true,
            package: name,
            version,
            digest,
        }, 201);
    });

    // ── GET /v1/packages — list packages ───────────────────────────────
    app.get('/v1/packages', (c) => {
        const typeFilter = c.req.query('type');
        const query = (c.req.query('q') || '').toLowerCase();
        const sort = c.req.query('sort') || 'updated';
        const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20));

        let results = [...packages.values()];

        // Filter by type
        if (typeFilter) {
            results = results.filter((p) => p.type === typeFilter);
        }

        // Search filter
        if (query) {
            results = results.filter((p) =>
                p.name.toLowerCase().includes(query) ||
                p.title.toLowerCase().includes(query) ||
                p.description.toLowerCase().includes(query) ||
                p.tags.some((t) => t.toLowerCase().includes(query))
            );
        }

        // Sort
        switch (sort) {
            case 'stars':
                results.sort((a, b) => b.stars - a.stars);
                break;
            case 'downloads':
                results.sort((a, b) => b.downloads - a.downloads);
                break;
            case 'name':
                results.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'created':
                results.sort((a, b) => b.created_at.localeCompare(a.created_at));
                break;
            case 'updated':
            default:
                results.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
                break;
        }

        const paged = paginate(results.map(serialisePkgSummary), page, limit);
        return c.json(paged);
    });

    // ── GET /v1/packages/@:ns/:name — full package detail ──────────────
    app.get('/v1/packages/@:ns/:name', (c) => {
        const key = pkgKey(c.req.param('ns')!, c.req.param('name')!);
        const pkg = packages.get(key);
        if (!pkg) {
            return c.json({ error: 'Package not found' }, 404);
        }
        // Increment downloads on detail fetch
        pkg.downloads++;
        return c.json(serialisePkg(pkg));
    });

    // ── GET /v1/packages/@:ns/:name/:version — specific version ────────
    app.get('/v1/packages/@:ns/:name/:version', (c) => {
        const key = pkgKey(c.req.param('ns')!, c.req.param('name')!);
        const pkg = packages.get(key);
        if (!pkg) {
            return c.json({ error: 'Package not found' }, 404);
        }
        const version = c.req.param('version')!;
        const pv = pkg.versions.get(version);
        if (!pv) {
            return c.json({ error: `Version ${version} not found` }, 404);
        }
        pkg.downloads++;
        return c.json({
            name: pkg.name,
            type: pkg.type,
            title: pkg.title,
            description: pkg.description,
            publisher: pkg.publisher,
            ...pv,
        });
    });

    // ── DELETE /v1/packages/@:ns/:name/:version — unpublish ────────────
    app.delete('/v1/packages/@:ns/:name/:version', (c) => {
        const key = pkgKey(c.req.param('ns')!, c.req.param('name')!);
        const pkg = packages.get(key);
        if (!pkg) {
            return c.json({ error: 'Package not found' }, 404);
        }
        const version = c.req.param('version')!;
        if (!pkg.versions.has(version)) {
            return c.json({ error: `Version ${version} not found` }, 404);
        }
        pkg.versions.delete(version);

        if (pkg.versions.size === 0) {
            // No versions left — remove entire package
            packages.delete(key);
            return c.json({ ok: true, deleted: key, version, remaining_versions: 0 });
        }

        // Recalculate latest
        const remaining = [...pkg.versions.keys()].sort(semverCompare);
        pkg.latest = remaining[remaining.length - 1];
        pkg.updated_at = new Date().toISOString();

        return c.json({ ok: true, deleted: key, version, remaining_versions: pkg.versions.size, latest: pkg.latest });
    });

    // ── PUT /v1/packages/@:ns/:name/:version/star ──────────────────────
    app.put('/v1/packages/@:ns/:name/:version/star', async (c) => {
        const key = pkgKey(c.req.param('ns')!, c.req.param('name')!);
        const pkg = packages.get(key);
        if (!pkg) {
            return c.json({ error: 'Package not found' }, 404);
        }

        let user = 'anonymous';
        try {
            const body = await c.req.json() as Record<string, unknown>;
            if (body.user && typeof body.user === 'string') user = body.user;
        } catch {
            // No body is fine — default to anonymous
        }

        if (pkg.starredBy.has(user)) {
            return c.json({ ok: true, stars: pkg.stars, already_starred: true });
        }

        pkg.starredBy.add(user);
        pkg.stars = pkg.starredBy.size;
        return c.json({ ok: true, stars: pkg.stars });
    });

    // ── DELETE /v1/packages/@:ns/:name/:version/star ───────────────────
    app.delete('/v1/packages/@:ns/:name/:version/star', async (c) => {
        const key = pkgKey(c.req.param('ns')!, c.req.param('name')!);
        const pkg = packages.get(key);
        if (!pkg) {
            return c.json({ error: 'Package not found' }, 404);
        }

        let user = 'anonymous';
        try {
            const body = await c.req.json() as Record<string, unknown>;
            if (body.user && typeof body.user === 'string') user = body.user;
        } catch {
            // No body is fine
        }

        pkg.starredBy.delete(user);
        pkg.stars = pkg.starredBy.size;
        return c.json({ ok: true, stars: pkg.stars });
    });

    // ====================================================================
    // Discovery
    // ====================================================================

    // ── GET /v1/search — full-text search with filters ─────────────────
    app.get('/v1/search', (c) => {
        const q = (c.req.query('q') || '').toLowerCase();
        const typeFilter = c.req.query('type');
        const categoryFilter = c.req.query('category');
        const tagFilter = c.req.query('tag');
        const sort = c.req.query('sort') || 'relevance';
        const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20));

        let results = [...packages.values()];

        // Filter by type
        if (typeFilter) {
            results = results.filter((p) => p.type === typeFilter);
        }

        // Filter by category
        if (categoryFilter) {
            results = results.filter((p) => p.category === categoryFilter);
        }

        // Filter by tag
        if (tagFilter) {
            results = results.filter((p) => p.tags.includes(tagFilter));
        }

        // Text search
        if (q) {
            results = results.map((p) => {
                let score = 0;
                const lName = p.name.toLowerCase();
                const lTitle = p.title.toLowerCase();
                const lDesc = p.description.toLowerCase();
                if (lName.includes(q)) score += 10;
                if (lName === q || lName === `@${q}`) score += 20;
                if (lTitle.includes(q)) score += 5;
                if (lDesc.includes(q)) score += 2;
                for (const tag of p.tags) {
                    if (tag.toLowerCase().includes(q)) score += 3;
                }
                return { pkg: p, score };
            }).filter((r) => r.score > 0)
              .sort((a, b) => b.score - a.score)
              .map((r) => r.pkg);
        }

        // Secondary sort
        if (sort === 'stars') {
            results.sort((a, b) => b.stars - a.stars);
        } else if (sort === 'downloads') {
            results.sort((a, b) => b.downloads - a.downloads);
        } else if (sort === 'updated') {
            results.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        }
        // 'relevance' keeps the text-search order

        const paged = paginate(results.map(serialisePkgSummary), page, limit);
        return c.json(paged);
    });

    // ── GET /v1/categories — all categories per type ───────────────────
    app.get('/v1/categories', (c) => {
        const cats: Record<string, Set<string>> = {};
        for (const pkg of packages.values()) {
            if (!cats[pkg.type]) cats[pkg.type] = new Set();
            if (pkg.category) cats[pkg.type].add(pkg.category);
        }
        const result: Record<string, string[]> = {};
        for (const [type, set] of Object.entries(cats)) {
            result[type] = [...set].sort();
        }
        return c.json(result);
    });

    // ── GET /v1/categories/:type — packages in a category type ─────────
    app.get('/v1/categories/:type', (c) => {
        const type = c.req.param('type')!;
        const category = c.req.query('category');
        const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20));

        let results = [...packages.values()].filter((p) => p.type === type);

        if (category) {
            results = results.filter((p) => p.category === category);
        }

        results.sort((a, b) => b.downloads - a.downloads);

        const paged = paginate(results.map(serialisePkgSummary), page, limit);
        return c.json(paged);
    });

    // ── GET /v1/trending — trending by recent downloads ────────────────
    app.get('/v1/trending', (c) => {
        const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20));
        const type = c.req.query('type');

        let results = [...packages.values()];
        if (type) {
            results = results.filter((p) => p.type === type);
        }

        // Trending score: downloads weighted towards recent updates
        results.sort((a, b) => {
            const aAge = (Date.now() - new Date(a.updated_at).getTime()) / (1000 * 60 * 60 * 24);
            const bAge = (Date.now() - new Date(b.updated_at).getTime()) / (1000 * 60 * 60 * 24);
            const aScore = a.downloads / Math.max(1, aAge);
            const bScore = b.downloads / Math.max(1, bAge);
            return bScore - aScore;
        });

        return c.json({
            items: results.slice(0, limit).map(serialisePkgSummary),
            total: results.length,
            limit,
        });
    });

    // ── GET /v1/featured — editor's picks ──────────────────────────────
    app.get('/v1/featured', (c) => {
        const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20));
        const type = c.req.query('type');

        let results = [...packages.values()].filter((p) => p.featured);
        if (type) {
            results = results.filter((p) => p.type === type);
        }

        results.sort((a, b) => b.stars - a.stars);

        return c.json({
            items: results.slice(0, limit).map(serialisePkgSummary),
            total: results.length,
            limit,
        });
    });

    // ── GET /v1/stats — registry statistics ────────────────────────────
    app.get('/v1/stats', (c) => {
        let totalDownloads = 0;
        let totalVersions = 0;
        const publishers = new Set<string>();
        const typeCounts: Record<string, number> = {};

        for (const pkg of packages.values()) {
            totalDownloads += pkg.downloads;
            totalVersions += pkg.versions.size;
            publishers.add(pkg.publisher);
            typeCounts[pkg.type] = (typeCounts[pkg.type] || 0) + 1;
        }

        return c.json({
            total_packages: packages.size,
            total_versions: totalVersions,
            total_downloads: totalDownloads,
            total_publishers: publishers.size,
            packages_by_type: typeCounts,
            timestamp: new Date().toISOString(),
        });
    });

    // ====================================================================
    // User / Publisher
    // ====================================================================

    // ── GET /v1/publishers/:username — publisher profile ───────────────
    app.get('/v1/publishers/:username', (c) => {
        const username = c.req.param('username')!;
        const userPkgs = [...packages.values()].filter((p) => p.publisher === username);

        if (userPkgs.length === 0) {
            return c.json({ error: 'Publisher not found or has no packages' }, 404);
        }

        const totalDownloads = userPkgs.reduce((sum, p) => sum + p.downloads, 0);
        const totalStars = userPkgs.reduce((sum, p) => sum + p.stars, 0);

        return c.json({
            username,
            total_packages: userPkgs.length,
            total_downloads: totalDownloads,
            total_stars: totalStars,
            packages: userPkgs.map(serialisePkgSummary),
        });
    });

    // ── GET /v1/publishers/:username/packages — all packages by user ───
    app.get('/v1/publishers/:username/packages', (c) => {
        const username = c.req.param('username')!;
        const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10) || 20));

        const userPkgs = [...packages.values()]
            .filter((p) => p.publisher === username)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

        if (userPkgs.length === 0) {
            return c.json({ error: 'Publisher not found or has no packages' }, 404);
        }

        const paged = paginate(userPkgs.map(serialisePkgSummary), page, limit);
        return c.json(paged);
    });

    // ── 404 fallback ───────────────────────────────────────────────────
    app.notFound((c) => {
        return c.json({ error: 'Not found', path: c.req.path }, 404);
    });

    // ── Error handler ──────────────────────────────────────────────────
    app.onError((err, c) => {
        console.error('[clawhub] Unhandled error:', err);
        return c.json({ error: 'Internal server error' }, 500);
    });

    return app;
}
