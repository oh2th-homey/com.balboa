const Homey = require('homey');
const { loginAndGetToken, handleDeviceConfigurationRequest } = require('../../lib/balboa/bwa');
const { encrypt } = require('../../lib/helpers');

module.exports = class driver_BWA extends Homey.Driver {
    onInit() {
        this.homey.app.log('[Driver] - init', this.id);
        this.homey.app.log(`[Driver] - version`, Homey.manifest.version);
    }

    async onPair(session) {
        session.setHandler("login", async (data) => {
            try {
                this.config = {
                    username: data.username,
                    password: data.password
                };

                this.homey.app.log(`[Driver] ${this.id} - got config`, {...this.config, username: "LOG", password: 'LOG'});
    
                this._BwaClient = await loginAndGetToken(this.config.username, this.config.password);
                
                const deviceId = this._BwaClient.device && this._BwaClient.device.device_id;
                this.balboaData = await handleDeviceConfigurationRequest(deviceId);

                return true;
            } catch (error) {
                console.log(error);
                throw new Error(this.homey.__('pair.error'));
            }
        });

        session.setHandler("list_devices", async () => {
            this.results = [];
            this.homey.app.log(`[Driver] ${this.id} - this.balboaData`, this.balboaData);

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
            

            this.homey.app.log(`[Driver] ${this.id} - Found devices - `, this.results);

            return this.results;
        });
    }
}