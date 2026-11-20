const Homey = require('homey');
const BalboaLocal = require('../../lib/balboa/local');

module.exports = class driver_BWA extends Homey.Driver {
    onInit() {
        this.log('Driver init');
    }

    async onPair(session) {
        this.results = [];
        this.mode = 'local';
        this.manualIp = null;

        session.setHandler('select_mode', async (data) => {
            this.mode = 'local';
            return true;
        });

        session.setHandler('manual_ip', async (ip) => {
            this.mode = 'local';
            this.manualIp = ip;
            return true;
        });

        session.setHandler("list_devices", async () => {
            this.results = [];

            const localIps = await BalboaLocal.discover(5000);

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
            }

            this.log(`Pairing found ${this.results.length} device(s) (${localIps.length} discovered${this.manualIp ? ', manual IP given' : ''})`);
            return this.results;
        });
    }
}