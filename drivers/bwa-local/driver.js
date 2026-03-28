const Homey = require('homey');
const BalboaLocal = require('../../lib/balboa/local');

module.exports = class driver_BWA extends Homey.Driver {
    onInit() {
        this.homey.app.log('[Driver] - init', this.id);
        this.homey.app.log(`[Driver] - version`, Homey.manifest.version);
    }

    async onPair(session) {
        this.results = [];
        this.mode = 'local';
        this.manualIp = null;

        session.setHandler('select_mode', async (data) => {
            this.homey.app.log(`[Driver] ${this.id} - select_mode:`, data);
            this.mode = 'local';
            return true;
        });

        session.setHandler('manual_ip', async (ip) => {
            this.homey.app.log(`[Driver] ${this.id} - manual_ip:`, ip);
            this.mode = 'local';
            this.manualIp = ip;
            return true;
        });

        session.setHandler("list_devices", async () => {
            this.results = [];

            this.homey.app.log(`[Driver] ${this.id} - Starting local discovery...`);
            const localIps = await BalboaLocal.discover(5000);
            this.homey.app.log(`[Driver] ${this.id} - Discovered local IPs:`, localIps);

            if (localIps.length > 0) {
                localIps.forEach((ip) => {
                    this.results.push({
                        name: `BWA Spa at ${ip}`,
                        data: {
                            id: `local-bwa-${ip.replace(/\./g, '-')}`,
                            ip: ip,
                            mode: 'local'
                        },
                        settings: {
                            ip: ip,
                            mode: 'local'
                        }
                    });
                });
            } else if (this.manualIp) {
                this.homey.app.log(`[Driver] ${this.id} - Using manual IP:`, this.manualIp);
                this.results.push({
                    name: `BWA Spa (Manual: ${this.manualIp})`,
                    data: {
                        id: `local-bwa-${this.manualIp.replace(/\./g, '-')}`,
                        ip: this.manualIp,
                        mode: 'local'
                    },
                    settings: {
                        ip: this.manualIp,
                        mode: 'local'
                    }
                });
            } else {
                this.homey.app.log(`[Driver] ${this.id} - No local devices discovered and no manual IP provided`);
            }

            this.homey.app.log(`[Driver] ${this.id} - Found devices - `, this.results);
            return this.results;
        });
    }
}