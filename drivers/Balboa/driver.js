const Homey = require('homey');
const ControlMySpa = require('../../lib/balboa/cms');
const { encrypt } = require('../../lib/helpers');

module.exports = class driver_Balboa extends Homey.Driver {
    onInit() {
        this.homey.app.log('[Driver] - init', this.id);
        this.homey.app.log(`[Driver] - version`, Homey.manifest.version);
    }

    async onPair(session) {
        session.setHandler('login', async (data) => {
            try {
                this.config = {
                    username: data.username,
                    password: data.password
                };

                this.homey.app.log(`[Driver] ${this.id} - got config`, { ...this.config, username: 'LOG', password: 'LOG' });

                this._controlMySpaClient = await new ControlMySpa(this.config.username, this.config.password);

                this.balboaData = await this._controlMySpaClient.init();

                if (!this.balboaData) {
                    return false;
                }

                return true;
            } catch (error) {
                console.log(error);
                throw new Error(this.homey.__('pair.error'));
            }
        });

        session.setHandler('list_devices', async () => {
            this.results = [];
            this.homey.app.log(`[Driver] ${this.id} - this.balboaData`, this.balboaData);

            if (Array.isArray(this.balboaData)) {
                this.balboaData.forEach((device) => {
                    this.results.push({
                        name: device.serialNumber, // Use the serialNumber from the object
                        data: {
                            id: device._id // Use the _id from the object
                        },
                        settings: {
                            ...this.config,
                            username: this.config.username,
                            password: encrypt(this.config.password)
                        }
                    });
                });
            } else {
                this.homey.app.log(`[Driver] ${this.id} - balboaData is not an array.`);
            }

            this.homey.app.log(`[Driver] ${this.id} - Found devices - `, this.results);

            return this.results;
        });
    }
};
