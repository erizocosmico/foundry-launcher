import axios from 'axios';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export default class FoundryClient {
    constructor(config) {
        this.config = config;
        this.url = (config.foundryUrl || 'http://localhost:30000').replace(/\/$/, '');

    }

    async getStatus() {
        const res = await axios.get(`${this.url}/api/status`, { timeout: 5000 });
        return res.data;
    }

    // v14 rejects state-changing requests without a same-origin Origin/Referer (400 "could not be processed")
    originHeaders(path) {
        return { Origin: this.url, Referer: `${this.url}${path}` };
    }

    async getSessionCookie() {
        const res = await axios.get(`${this.url}/auth`, {
            timeout: 10_000,
            maxRedirects: 0,
            validateStatus: s => s < 400,
        });
        return (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    }

    async getAdminCookie() {
        const initial = await this.getSessionCookie();

        const params = new URLSearchParams({ action: 'adminAuth', adminPassword: this.config.adminPassword });
        const res = await axios.post(`${this.url}/auth`, params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(initial && { Cookie: initial }),
                ...this.originHeaders('/auth'),
            },
            timeout: 10_000,
            maxRedirects: 0,
            validateStatus: s => s < 400,
        });
        const cookies = res.headers['set-cookie']?.map(c => c.split(';')[0]).join('; ') || initial;
        if (!cookies) throw new Error('No session cookie returned — check adminPassword in config.json');
        return cookies;
    }

    async launchWorld(worldId) {
        const cookie = await this.getAdminCookie();
        const res = await axios.post(`${this.url}/setup`, {
            action: 'launchWorld',
            world: worldId,
        }, { headers: { Cookie: cookie, ...this.originHeaders('/setup') }, timeout: 30_000 });
        return res.data;
    }

    // While a world is active, the /auth admin session isn't honoured; the password must be in the shutdown body
    async shutdownWorld() {
        const cookie = await this.getSessionCookie();
        const params = new URLSearchParams({ action: 'worldShutdown', adminPassword: this.config.adminPassword });
        const res = await axios.post(`${this.url}/setup`, params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(cookie && { Cookie: cookie }),
                ...this.originHeaders('/setup'),
            },
            timeout: 15_000,
            maxRedirects: 0,
            validateStatus: s => s < 400,
        });
        if (/\/join$/.test(res.headers.location || '')) {
            throw new Error('Foundry rejected the shutdown — check adminPassword in config.json');
        }
    }

    getWorldBackground(worldId) {
        const worldJson = join(this.config.foundryDataPath, 'Data', 'worlds', worldId, 'world.json');
        if (!existsSync(worldJson)) return null;
        try {
            const data = JSON.parse(readFileSync(worldJson, 'utf8'));
            if (!data.background) return null;
            const imgPath = join(this.config.foundryDataPath, 'Data', data.background);
            return existsSync(imgPath) ? imgPath : null;
        } catch {
            return null;
        }
    }

    listWorlds() {
        const worldsDir = join(this.config.foundryDataPath, 'Data', 'worlds');
        if (!existsSync(worldsDir)) return [];

        return readdirSync(worldsDir, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => {
                const jsonPath = join(worldsDir, e.name, 'world.json');
                if (!existsSync(jsonPath)) return null;
                try {
                    const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
                    const cfg = this.config.worlds?.[e.name] || {};
                    return {
                        id: e.name,
                        name: cfg.name || data.title || data.name || e.name,
                        system: data.system || 'unknown',
                        lastPlayed: data.lastPlayed || null,
                        passwordProtected: !!cfg.password,
                    };
                } catch { return null; }
            })
            .filter(w => w !== null && !!this.config.worlds?.[w.id]);
    }
}
