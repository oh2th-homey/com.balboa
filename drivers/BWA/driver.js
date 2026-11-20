const Homey = require('homey');
const { loginAndGetToken, handleDeviceConfigurationRequest } = require('../../lib/balboa/bwa');
const { encrypt } = require('../../lib/helpers');

module.exports = class driver_BWA extends Homey.Driver {
    onInit() {
        this.log('Driver init');
    }

    async onPair(session) {
        session.setHandler("login", async (data) => {
            try {
                this.config = {
                    username: data.username,
                    password: data.password
                };

                this._BwaClient = await loginAndGetToken(this.config.username, this.config.password);
                
                const deviceId = this._BwaClient.device && this._BwaClient.device.device_id;

                if(deviceId) {
                    this.balboaData = await handleDeviceConfigurationRequest(deviceId);
                    return true
                }
                

                return false;
            } catch (error) {
                this.error(`Pairing login failed: ${error.message}`);
                throw new Error(this.homey.__('pair.error'));
            }
        });

        session.setHandler("list_devices", async () => {
            this.results = [];

            if(Object.keys(this.balboaData).length) {
                this.results.push({
                    name: 'Balbo BWA',
                    data: {
                        id: this.balboaData.DeviceId
                    },
                    settings: {
                        ...this.config,
                        username: this.config.username,
                        password: encrypt(this.config.password)
                    }
                });
            }
            

            this.log(`Pairing found ${this.results.length} device(s)`);

            return this.results;
        });
    }
}