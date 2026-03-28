const Homey = require('homey');
const { loginAndGetToken, handleDeviceConfigurationRequest } = require('../../lib/balboa/bwa');
const { encrypt } = require('../../lib/helpers');
const BalboaLocal = require('../../lib/balboa/local');

module.exports = class driver_BWA extends Homey.Driver {
    onInit() {
        this.homey.app.log('[Driver] - init', this.id);
        this.homey.app.log(`[Driver] - version`, Homey.manifest.version);
    }

    async onPair(session) {
        this.results = [];
        this.mode = 'local';

        session.setHandler('select_mode', async (data) => {
            this.homey.app.log(`[Driver] ${this.id} - select_mode:`, data);
            this.mode = data;
            return true;
        });

        session.setHandler('manual_ip', async (ip) => {
            this.homey.app.log(`[Driver] ${this.id} - manual_ip:`, ip);
            this.mode = 'local';
            this.manualIp = ip;
            return true;
        });

        session.setHandler('login', async (data) => {
            try {
                this.config = {
                    username: data.username,
                    password: data.password
                };

                this.homey.app.log(`[Driver] ${this.id} - got config`, { ...this.config, username: "LOG", password: 'LOG' });

                this._BwaClient = await loginAndGetToken(this.config.username, this.config.password);

                const deviceId = this._BwaClient.device && this._BwaClient.device.device_id;

                if (deviceId) {
                    this.balboaData = await handleDeviceConfigurationRequest(deviceId);
                    return true
                }


                return false;
            } catch (error) {
                console.log(error);
                throw new Error(this.homey.__('pair.error'));
            }
        });

        session.setHandler("list_devices", async () => {
            this.results = [];

            if (this.mode === 'local') {
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
                }
            } else {
                // Cloud discovery
                if (this.balboaData && Object.keys(this.balboaData).length) {
                    this.homey.app.log(`[Driver] ${this.id} - Adding cloud devices...`);
                    this.results.push({
                        name: 'Balboa BWA',
                        data: {
                            id: this.balboaData.DeviceId,
                            mode: 'cloud'
                        },
                        settings: {
                            ...this.config,
                            username: this.config.username,
                            password: encrypt(this.config.password),
                            mode: 'cloud'
                        }
                    });
                }
            }

            this.homey.app.log(`[Driver] ${this.id} - Found devices - `, this.results);
            return this.results;
        });
    }
}