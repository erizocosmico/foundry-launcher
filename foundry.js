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

    async getAdminCookie() {
        const params = new URLSearchParams({ action: 'adminAuth', adminPassword: this.config.adminPassword });
        const res = await axios.post(`${this.url}/auth`, params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10_000,
            maxRedirects: 0,
            validateStatus: s => s < 400,
        });
        const cookies = res.headers['set-cookie'];
        if (!cookies?.length) throw new Error('No session cookie returned — check adminPassword in config.json');
        return cookies.map(c => c.split(';')[0]).join('; ');
    }

    async launchWorld(worldId) {
        const cookie = await this.getAdminCookie();
        const res = await axios.post(`${this.url}/setup`, {
            action: 'launchWorld',
            world: worldId,
        }, { headers: { Cookie: cookie }, timeout: 30_000 });
        return res.data;
    }

    async shutdownWorld() {
        const cookie = await this.getAdminCookie();
        await axios.post(`${this.url}/join`, {
            action: 'shutdown',
        }, { headers: { Cookie: cookie }, timeout: 15_000 });
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
