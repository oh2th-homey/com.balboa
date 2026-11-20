const Homey = require('homey');
const {
    handleDeviceConfigurationRequest,
    handlePanelUpdateRequest,
    loginAndGetToken,
    updatePumpStatus,
    updateBlowerStatus,
    updateLightStatus,
    updateTemperature,
    updateTemperatureRange,
    updateHeatMode
} = require('../../lib/balboa/bwa');
const { sleep, decrypt, encrypt, toCelsius, formatCommand } = require('../../lib/helpers');

module.exports = class device_BWA extends Homey.Device {
    // Homey prefixes device logs with the device ID: add the name to tell devices apart.
    log(...args) {
        super.log(`[${this.getName()}]`, ...args);
    }

    error(...args) {
        super.error(`[${this.getName()}]`, ...args);
    }

    async onInit() {
        try {
            this.log('Device init');
            this.setUnavailable(`Connecting to ${this.getName()}`);

            await this.checkCapabilities();
            await this.setBwaClient();
            await this.setCapabilityListeners();

            await this.setAvailable();
        } catch (error) {
            this.error(`Init failed: ${error.message}`);
        }
    }

    // ------------- Settings -------------
    async onSettings({ oldSettings, newSettings, changedKeys }) {
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

            this._BwaClient = await loginAndGetToken(this.config.username, this.config.password);

            const components = await handleDeviceConfigurationRequest(deviceObject.id);

            if (Object.keys(components).length) {
                await this.setCapabilityValues(null, true);
                await this.setAvailable();
                await this.setIntervalsAndFlows(settings);
            } else {
                this.setUnavailable(`Something went wrong with connecting to ${this.getName()}`);
            }
        } catch (error) {
            this.error(`Connecting to the BWA cloud failed: ${error.message}`);
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
                'action_heater_mode',
                'action_temp_range'
            ],
            this.onCapability_ACTION.bind(this)
        );
    }

    async onCapability_TEMPERATURE(value) {
        try {
            const deviceObject = this.getData();
            this.log(`Command: target_temperature ${value} °C`);

            await updateTemperature(deviceObject.id, value);

            return Promise.resolve(true);
        } catch (e) {
            this.error(`Command failed: ${e.message}`);
            return Promise.reject(e);
        }
    }

    async onCapability_LOCKED(value) {
        try {
            this.log(`Command: locked ${value}`);

            if (value) {
                await this._controlMySpaClient.lockPanel();
            } else {
                await this._controlMySpaClient.unlockPanel();
            }

            return Promise.resolve(true);
        } catch (e) {
            this.error(`Command failed: ${e.message}`);
            return Promise.reject(e);
        }
    }

    async onCapability_ACTION(value) {
        try {
            const deviceObject = this.getData();
            this.log(`Command: ${formatCommand(value)}`);

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
                await updateHeatMode(deviceObject.id, value.action_heater_mode);
            }

            if ('action_temp_range' in value) {
                const highRange = !!parseInt(value.action_temp_range);

                await updateTemperatureRange(deviceObject.id, highRange);
                await this.setTargetTemperatureOptions(highRange, 'onCapability_ACTION');
            }

            await this.setCapabilityValues();

            return Promise.resolve(true);
        } catch (e) {
            this.error(`Command failed: ${e.message}`);
            return Promise.reject(e);
        }
    }

    async onCapability_UPDATE_DATA(value) {
        try {
            this.log('Command: update data');

            await this.setCapabilityValues();

            await this.setCapabilityValue('action_update_data', false);

            await sleep(2000);

            return Promise.resolve(true);
        } catch (e) {
            this.error(`Command failed: ${e.message}`);
            return Promise.reject(e);
        }
    }

    async setCapabilityValues(deviceInfoOverride = null, check = false) {
        try {
            const deviceObject = this.getData();
            const settings = this.getSettings();
            let deviceInfo = deviceInfoOverride ? deviceInfoOverride : await handlePanelUpdateRequest(deviceObject.id);

            if (this._pollError) {
                this._pollError = null;
                this.log('Spa data received again');
            }

            const { actualTemperature, targetTemperature, pumpsState, lightsState, blowerState, temperatureRange, heatMode, isHeating, wifiState } = deviceInfo;
            this._changes = [];

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

                await this.setTargetTemperatureOptions(temperatureRange === 'high', 'setCapabilityValues:check');
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
            await this.setValue('action_temp_range', temperatureRange === 'high', check);

            await this.setValue('measure_heater_mode', heatMode.toUpperCase(), check);
            const online = wifiState === 'WiFi OK';
            await this.setValue('measure_online', online, check);
            await this.setValue('alarm_connectivity', !online, check);

            await this.setValue('target_temperature', targetTemperature, check, 10, settings.round_temp);

            if (actualTemperature === 127.5) {
                await this.setValue('measure_temperature', 38, check, 10, settings.round_temp);
            } else {
                await this.setValue('measure_temperature', actualTemperature, check, 10, settings.round_temp);
            }

            this.log(this._changes.length ? `${check ? 'Received' : 'Changed'}: ${this._changes.join(', ')}` : 'No changes');
        } catch (error) {
            // Log a failure once, not again on every poll while it lasts.
            if (this._pollError !== error.message) {
                this._pollError = error.message;
                this.error(`Updating spa data failed: ${error.message}`);
            }
        }
    }

    async setValue(key, value, firstRun = false, delay = 10, roundNumber = false) {
        if (this.hasCapability(key)) {
            const newKey = key.replace('.', '_');
            const oldVal = await this.getCapabilityValue(key);
            const newVal = roundNumber ? Math.round(value) : value;

            if (oldVal !== newVal && this._changes) {
                this._changes.push(`${key} ${oldVal} → ${newVal}`);
            }

            if (delay) {
                await sleep(delay);
            }

            try {
                await this.setCapabilityValue(key, newVal);
            }
            catch (error) {
                this.error(`Setting ${key} to ${newVal} failed: ${error.message}`);
            }

            if (typeof newVal === 'boolean' && oldVal !== newVal && !firstRun) {
                const triggers = this.homey.manifest.flow.triggers;
                const triggerExists = triggers.find((trigger) => trigger.id === `${newKey}_changed`);

                if (triggerExists) {
                    await this.homey.flow
                        .getDeviceTriggerCard(`${newKey}_changed`)
                        .trigger(this)
                        .catch((error) => this.error(`Trigger ${newKey}_changed failed: ${error.message}`));
                }
            }
        }
    }

    async setTargetTemperatureOptions(highRange, source = 'unknown') {
        const nextOptions = highRange
            ? {
                min: toCelsius(80),
                max: toCelsius(104)
            }
            : {
                min: toCelsius(50),
                max: toCelsius(99)
            };

        const currentOptions = this.getCapabilityOptions('target_temperature') || {};
        const optionsChanged = currentOptions.min !== nextOptions.min || currentOptions.max !== nextOptions.max;

        if (optionsChanged) {
            this.log(`Target temperature range set to ${highRange ? 'HIGH' : 'LOW'} (${nextOptions.min}–${nextOptions.max} °C)`);
            await this.setCapabilityOptions('target_temperature', nextOptions);
        }
    }

    // ------------- Intervals -------------
    async setIntervalsAndFlows(settings) {
        try {
            if (this.getAvailable()) {
                await this.setCapabilityValuesInterval(settings.update_interval);
            }
        } catch (error) {
            this.error(`Starting polling failed: ${error.message}`);
        }
    }

    async setCapabilityValuesInterval(update_interval) {
        try {
            const REFRESH_INTERVAL = 1000 * update_interval;

            this.log(`Polling every ${update_interval} s`);
            this.onPollInterval = setInterval(this.setCapabilityValues.bind(this), REFRESH_INTERVAL);
        } catch (error) {
            this.setUnavailable(error);
            this.error(`Starting polling failed: ${error.message}`);
        }
    }

    async clearIntervals() {
        await clearInterval(this.onPollInterval);
    }

    // ------------- Capabilities -------------
    async checkCapabilities() {
        const driverManifest = this.driver.manifest;
        const driverCapabilities = driverManifest.capabilities;

        const deviceCapabilities = this.getCapabilities();

        await this.updateCapabilities(driverCapabilities, deviceCapabilities);
    }

    async updateCapabilities(driverCapabilities, deviceCapabilities) {
        try {
            const newC = driverCapabilities.filter((d) => !deviceCapabilities.includes(d));
            const oldC = deviceCapabilities.filter((d) => !driverCapabilities.includes(d));

            if (oldC.length || newC.length) {
                this.log(`Updating capabilities: removing [${oldC.join(', ')}], adding [${newC.join(', ')}]`);
            }

            oldC.forEach((c) => {
                this.removeCapability(c);
            });
            await sleep(2000);
            newC.forEach((c) => {
                this.addCapability(c);
            });
            await sleep(2000);
        } catch (error) {
            this.error(`Updating capabilities failed: ${error.message}`);
        }
    }

    onDeleted() {
        this.clearIntervals();
    }
};
