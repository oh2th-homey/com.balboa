const Homey = require('homey');
const {
    handleDeviceConfigurationRequest,
    handlePanelUpdateRequest,
    loginAndGetToken,
    updatePumpStatus,
    updateBlowerStatus,
    updateLightStatus,
    updateTemperature,
    updateHeatMode
} = require('../../lib/balboa/bwa');
const { sleep, decrypt, encrypt, toCelsius, toFahrenheit } = require('../../lib/helpers');

module.exports = class device_BWA extends Homey.Device {
    async onInit() {
        try {
            this.homey.app.log('[Device] - init =>', this.getName());
            this.setUnavailable(`Connecting to ${this.getName()}`);

            await this.checkCapabilities();
            await this.setBwaClient();
            await this.setCapabilityListeners();

            await this.setAvailable();
        } catch (error) {
            this.homey.app.log(`[Device] ${this.getName()} - OnInit Error`, error);
        }
    }

    // ------------- Settings -------------
    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.homey.app.log(`[Device] ${this.getName()} - oldSettings`, { ...oldSettings, username: 'LOG', password: 'LOG' });
        this.homey.app.log(`[Device] ${this.getName()} - newSettings`, { ...newSettings, username: 'LOG', password: 'LOG' });

        if (changedKeys.length) {
            if (this.onPollInterval) {
                this.clearIntervals();
            }

            if (newSettings.password !== oldSettings.password) {
                await this.setBwaClient({ ...newSettings, password: encrypt(newSettings.password) });
            } else {
                await this.setBwaClient(newSettings);
            }

            if (newSettings.password !== oldSettings.password) {
                this.savePassword(newSettings, 2000);
            }
        }
    }

    async savePassword(settings, delay = 0) {
        this.homey.app.log(`[Device] ${this.getName()} - savePassword - encrypted`);

        if (delay > 0) {
            await sleep(delay);
        }

        await this.setSettings({ ...settings, password: encrypt(settings.password) });
    }

    // ------------- API -------------
    async setBwaClient(overrideSettings = null) {
        const settings = overrideSettings ? overrideSettings : this.getSettings();
        const deviceObject = this.getData();

        try {
            this.config = { ...settings, password: decrypt(settings.password) };

            this.homey.app.log(`[Device] - ${this.getName()} => setBwaClient Got config`, { ...this.config, username: 'LOG', password: 'LOG' });

            this._BwaClient = await loginAndGetToken(this.config.username, this.config.password);
console.log(deviceObject.id);
            const components = await handleDeviceConfigurationRequest(deviceObject.id);
            
            if (Object.keys(components).length) {
                await this.setCapabilityValues(null, true);
                await this.setAvailable();
                await this.setIntervalsAndFlows(settings);
            } else {
                this.setUnavailable(`Something went wrong with connecting to ${this.getName()}`);
            }
        } catch (error) {
            this.homey.app.log(`[Device] ${this.getName()} - setBwaClient - error =>`, error);
        }
    }

    // ------------- CapabilityListeners -------------
    async setCapabilityListeners() {
        await this.registerCapabilityListener('locked', this.onCapability_LOCKED.bind(this));
        await this.registerCapabilityListener('target_temperature', this.onCapability_TEMPERATURE.bind(this));
        await this.registerCapabilityListener('action_update_data', this.onCapability_UPDATE_DATA.bind(this));
        await this.registerMultipleCapabilityListener(
            [
                'action_pump_state',
                'action_pump_state.1',
                'action_pump_state.2',
                'action_pump_state.3',
                'action_pump_state.4',
                'action_pump_state.5',
                'action_light_state',
                'action_blower_state',
                ,
                'action_heater_mode',
                'action_temp_range'
            ],
            this.onCapability_ACTION.bind(this)
        );
    }

    async onCapability_TEMPERATURE(value) {
        try {
            const deviceObject = this.getData();
            this.homey.app.log(`[Device] ${this.getName()} - onCapability_TEMPERATURE ${value}C ${toFahrenheit(value)}F`);

            await updateTemperature(deviceObject.id, value);

            return Promise.resolve(true);
        } catch (e) {
            this.homey.app.error(e);
            return Promise.reject(e);
        }
    }

    async onCapability_LOCKED(value) {
        try {
            this.homey.app.log(`[Device] ${this.getName()} - onCapability_LOCKED`, value);

            if (value) {
                await this._controlMySpaClient.lockPanel();
            } else {
                await this._controlMySpaClient.unlockPanel();
            }

            return Promise.resolve(true);
        } catch (e) {
            this.homey.app.error(e);
            return Promise.reject(e);
        }
    }

    async onCapability_ACTION(value) {
        try {
            const deviceObject = this.getData();
            this.homey.app.log(`[Device] ${this.getName()} - onCapability_ACTION`, value);

            if ('action_blower_state' in value) {
                await updateBlowerStatus(deviceObject.id, value.action_blower_state);
            }

            if ('action_light_state' in value) {
                await updateLightStatus(deviceObject.id, 1, value.action_light_state);
            }

            if ('action_pump_state' in value) {
                await updatePumpStatus(deviceObject.id, 1, value['action_pump_state']);
            }

            if ('action_pump_state.1' in value) {
                await updatePumpStatus(deviceObject.id, 2, value['action_pump_state.1']);
            }

            if ('action_pump_state.2' in value) {
                await updatePumpStatus(deviceObject.id, 3, value['action_pump_state.2']);
            }

            if ('action_pump_state.3' in value) {
                await updatePumpStatus(deviceObject.id, 4, value['action_pump_state.3']);
            }

            if ('action_pump_state.4' in value) {
                await updatePumpStatus(deviceObject.id, 5, value['action_pump_state.4']);
            }

            if ('action_pump_state.5' in value) {
                await updatePumpStatus(deviceObject.id, 6, value['action_pump_state.5']);
            }

            if ('action_heater_mode' in value) {
                updateHeatMode(deviceObject.id, value.action_heater_mode);
            }

            await this.setCapabilityValues();

            return Promise.resolve(true);
        } catch (e) {
            this.homey.app.error(e);
            return Promise.reject(e);
        }
    }

    async onCapability_UPDATE_DATA(value) {
        try {
            this.homey.app.log(`[Device] ${this.getName()} - onCapability_UPDATE_DATA`, value);

            this.setCapabilityValue('action_update_data', false);

            await this.setCapabilityValues();

            return Promise.resolve(true);
        } catch (e) {
            this.homey.app.error(e);
            return Promise.reject(e);
        }
    }

    async setCapabilityValues(deviceInfoOverride = null, check = false) {
        this.homey.app.log(`[Device] ${this.getName()} - setCapabilityValues`);

        try {
            const deviceObject = this.getData();
            const settings = this.getSettings();
            let deviceInfo = deviceInfoOverride ? deviceInfoOverride : await handlePanelUpdateRequest(deviceObject.id);

            const { actualTemperature, targetTemperature, pumpsState, lightsState, blowerState, heatingMode, heatMode, isHeating, wifiState } = deviceInfo;

            this.homey.app.log(`[Device] ${this.getName()} - deviceInfo =>`, deviceInfo);

            if (check) {
                const components = await handleDeviceConfigurationRequest(deviceObject.id);

                const { Pumps: pumps } = components;

                if (pumps.Pump1.present) await this.addCapability('action_pump_state');
                if (pumps.Pump2.present) await this.addCapability('action_pump_state.1');
                if (pumps.Pump3.present) await this.addCapability('action_pump_state.2');
                if (pumps.Pump4.present) await this.addCapability('action_pump_state.3');
                if (pumps.Pump5.present) await this.addCapability('action_pump_state.4');
                if (pumps.Pump6.present) await this.addCapability('action_pump_state.5');
                if (components.Blower.present) await this.addCapability('action_blower_state');

                if (heatingMode === 'high') {
                    this.setCapabilityOptions('target_temperature', {
                        min: toCelsius(80),
                        max: toCelsius(104)
                    });
                } else {
                    this.setCapabilityOptions('target_temperature', {
                        min: toCelsius(50),
                        max: toCelsius(99)
                    });
                }
            }

            // ------------ Get values --------------
            const light = lightsState.Light1 === 'on';
            const heaterReady = heatMode.toUpperCase() === 'READY';

            if (this.hasCapability('action_pump_state')) {
                const pump0_val = pumpsState.Pump1 === 'on';
                await this.setValue('action_pump_state', pump0_val, check);
            }

            if (this.hasCapability('action_pump_state.1')) {
                const pump1_val = pumpsState.Pump2 === 'on';
                await this.setValue('action_pump_state.1', pump1_val, check);
            }

            if (this.hasCapability('action_pump_state.2')) {
                const pump2_val = pumpsState.Pump3 === 'on';
                await this.setValue('action_pump_state.2', pump2_val, check);
            }

            if (this.hasCapability('action_pump_state.3')) {
                const pump3_val = pumpsState.Pump4 === 'on';
                await this.setValue('action_pump_state.3', pump3_val, check);
            }

            if (this.hasCapability('action_pump_state.4')) {
                const pump4_val = pumpsState.Pump5 === 'on';
                await this.setValue('action_pump_state.4', pump4_val, check);
            }

            if (this.hasCapability('action_pump_state.5')) {
                const pump5_val = pumpsState.Pump6 === 'on';
                await this.setValue('action_pump_state.5', pump5_val, check);
            }

            if (this.hasCapability('action_blower_state')) {
                await this.setValue('action_blower_state', blowerState === 'on', check);
            }

            await this.setValue('measure_heater', isHeating ? 'ON' : 'OFF', check);

            await this.setValue('action_update_data', false, check);
            await this.setValue('action_light_state', light, check);
            await this.setValue('action_heater_mode', heaterReady, check);

            await this.setValue('measure_heater_mode', heatMode.toUpperCase(), check);
            await this.setValue('measure_online', wifiState === 'WiFi OK', check);

            await this.setValue('target_temperature', targetTemperature, check, 10, settings.round_temp);

            if (actualTemperature === 127.5) {
                await this.setValue('measure_temperature', 38, check, 10, settings.round_temp);
            } else {
                await this.setValue('measure_temperature', actualTemperature, check, 10, settings.round_temp);
            }
        } catch (error) {
            this.homey.app.error(error);
        }
    }

    async setValue(key, value, firstRun = false, delay = 10, roundNumber = false) {
        this.homey.app.log(`[Device] ${this.getName()} - setValue => ${key} => `, value);

        if (this.hasCapability(key)) {
            const newKey = key.replace('.', '_');
            const oldVal = await this.getCapabilityValue(key);
            const newVal = roundNumber ? Math.round(value) : value;

            this.homey.app.log(`[Device] ${this.getName()} - setValue - oldValue => ${key} => `, oldVal, newVal);

            if (delay) {
                await sleep(delay);
            }

            await this.setCapabilityValue(key, newVal);

            if (typeof newVal === 'boolean' && oldVal !== newVal && !firstRun) {
                const triggers = this.homey.manifest.flow.triggers;
                const triggerExists = triggers.find((trigger) => trigger.id === `${newKey}_changed`);

                if (triggerExists) {
                    await this.homey.flow
                        .getDeviceTriggerCard(`${newKey}_changed`)
                        .trigger(this)
                        .catch(this.error)
                        .then(this.homey.app.log(`[Device] ${this.getName()} - setValue ${newKey}_changed - Triggered: "${newKey} | ${newVal}"`));
                }
            } else if (oldVal !== newVal && !firstRun) {
                this.homey.app.log(`[Device] ${this.getName()} - setValue ${newKey}_changed - Triggered: "${newKey} | ${newVal}"`);
            }
        }
    }

    // ------------- Intervals -------------
    async setIntervalsAndFlows(settings) {
        try {
            if (this.getAvailable()) {
                await this.setCapabilityValuesInterval(settings.update_interval);
            }
        } catch (error) {
            this.homey.app.log(`[Device] ${this.getName()} - OnInit Error`, error);
        }
    }

    async setCapabilityValuesInterval(update_interval) {
        try {
            const REFRESH_INTERVAL = 1000 * update_interval;

            this.homey.app.log(`[Device] ${this.getName()} - onPollInterval =>`, REFRESH_INTERVAL, update_interval);
            this.onPollInterval = setInterval(this.setCapabilityValues.bind(this), REFRESH_INTERVAL);
        } catch (error) {
            this.setUnavailable(error);
            this.homey.app.log(error);
        }
    }

    async clearIntervals() {
        this.homey.app.log(`[Device] ${this.getName()} - clearIntervals`);
        await clearInterval(this.onPollInterval);
    }

    // ------------- Capabilities -------------
    async checkCapabilities() {
        const driverManifest = this.driver.manifest;
        const driverCapabilities = driverManifest.capabilities;

        const deviceCapabilities = this.getCapabilities();

        this.homey.app.log(`[Device] ${this.getName()} - Device capabilities =>`, deviceCapabilities);
        this.homey.app.log(`[Device] ${this.getName()} - Driver capabilities =>`, driverCapabilities);

        await this.updateCapabilities(driverCapabilities, deviceCapabilities);
    }

    async updateCapabilities(driverCapabilities, deviceCapabilities) {
        try {
            const newC = driverCapabilities.filter((d) => !deviceCapabilities.includes(d));
            const oldC = deviceCapabilities.filter((d) => !driverCapabilities.includes(d));

            this.homey.app.log(`[Device] ${this.getName()} - Got old capabilities =>`, oldC);
            this.homey.app.log(`[Device] ${this.getName()} - Got new capabilities =>`, newC);

            oldC.forEach((c) => {
                this.homey.app.log(`[Device] ${this.getName()} - updateCapabilities => Remove `, c);
                this.removeCapability(c);
            });
            await sleep(2000);
            newC.forEach((c) => {
                this.homey.app.log(`[Device] ${this.getName()} - updateCapabilities => Add `, c);
                this.addCapability(c);
            });
            await sleep(2000);
        } catch (error) {
            this.homey.app.log(error);
        }
    }

    onDeleted() {
        this.clearIntervals();
    }
};
