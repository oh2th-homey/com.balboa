const Homey = require('homey');
const ControlMySpa = require('../../lib/balboa/cms');
const { encrypt } = require('../../lib/helpers');

module.exports = class driver_Balboa extends Homey.Driver {
    onInit() {
        this.log('Driver init');
    }

    async onPair(session) {
        session.setHandler('login', async (data) => {
            try {
                this.config = {
                    username: data.username,
                    password: data.password
                };

                this._controlMySpaClient = await new ControlMySpa(this.config.username, this.config.password);

                this.balboaData = await this._controlMySpaClient.init();

                if (!this.balboaData) {
                    return false;
                }

                return true;
            } catch (error) {
                this.error(`Pairing login failed: ${error.message}`);
                throw new Error(this.homey.__('pair.error'));
            }
        });

        session.setHandler('list_devices', async () => {
            this.results = [];

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
            }

            this.log(`Pairing found ${this.results.length} device(s)`);

            return this.results;
        });
    }
};
