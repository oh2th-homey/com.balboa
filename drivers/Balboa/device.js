const Homey = require('homey');
const ControlMySpa = require('../../lib/balboa/cms');
const { sleep, decrypt, encrypt, toCelsius, toFahrenheit } = require('../../lib/helpers');
const mockEnabled = false; // for debugging without API access

module.exports = class device_Balboa extends Homey.Device {
    async onInit() {
        try {
            this.homey.app.log('[Device] - onInit =>', this.getName());
            this.setUnavailable(`Connecting to ${this.getName()}`);

            await this.checkCapabilities();
            await this.setControlMySpaClient();
            await this.setCapabilityListeners();

            await this.setAvailable();
        } catch (error) {
            this.homey.app.log(`[Device] ${this.getName()} - onInit Error`, error);
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
                await this.setControlMySpaClient({ ...newSettings, password: encrypt(newSettings.password) });
            } else {
                await this.setControlMySpaClient(newSettings);
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
    async setControlMySpaClient(overrideSettings = null) {
        const settings = overrideSettings ? overrideSettings : this.getSettings();
        const deviceData = this.getData();

        try {
            this.config = { ...settings, ...deviceData, password: decrypt(settings.password) };

            this.homey.app.log(`[Device] - ${this.getName()} => setControlMySpaClient Got config`, { ...this.config, username: 'LOG', password: 'LOG' });

            this._controlMySpaClient = await new ControlMySpa(this.config.username, this.config.password, this.config.id);

            await this._controlMySpaClient.deviceInit();

            await this.setCapabilityValues(null, true);
            await this.setAvailable();
            await this.setIntervalsAndFlows(settings);
        } catch (error) {
            this.homey.app.log(`[Device] ${this.getName()} - setControlMySpaClient - error =>`, error);
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
                'action_light_state',
                'action_blower_state',
                'action_blower_state.1',
                'action_blower_state.2',
                'action_heater_mode',
                'action_temp_range'
            ],
            this.onCapability_ACTION.bind(this)
        );
    }

    async onCapability_TEMPERATURE(value) {
        try {
            this.homey.app.log(`[Device] ${this.getName()} - onCapability_TEMPERATURE ${value}C ${toFahrenheit(value)}F`);

            // Send requested temperature to the spa in Fahrenheit + 0.4 degrees.
            // This is how the Balboa ControlMySpa mobile app does it.
            const data = await this._controlMySpaClient.setTemp(toFahrenheit(value) + 0.4);

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
            this.homey.app.log(`[Device] ${this.getName()} - onCapability_ACTION`, value);

            let data = null;

            if ('action_blower_state' in value) {
                const valueString = value.action_blower_state ? 'HIGH' : 'OFF';
                data = await this._controlMySpaClient.setBlowerState(0, valueString);
            }

            if ('action_blower_state.1' in value) {
                const valueString = value['action_blower_state.1'] ? 'HIGH' : 'OFF';
                data = await this._controlMySpaClient.setBlowerState(1, valueString);
            }

            if ('action_blower_state.2' in value) {
                const valueString = value['action_blower_state.2'] ? 'HIGH' : 'OFF';
                data = await this._controlMySpaClient.setBlowerState(2, valueString);
            }

            if ('action_light_state' in value) {
                const valueString = value.action_light_state ? 'HIGH' : 'OFF';
                data = await this._controlMySpaClient.setLightState(0, valueString);
            }

            if ('action_pump_state' in value) {
                const valueString = value.action_pump_state ? 'HIGH' : 'OFF';
                data = await this._controlMySpaClient.setJetState(0, valueString);
            }

            if ('action_pump_state.1' in value) {
                const valueString = value['action_pump_state.1'] ? 'HIGH' : 'OFF';
                data = await this._controlMySpaClient.setJetState(1, valueString);
            }

            if ('action_pump_state.2' in value) {
                const valueString = value['action_pump_state.2'] ? 'HIGH' : 'OFF';
                data = await this._controlMySpaClient.setJetState(2, valueString);
            }

            if ('action_heater_mode' in value) {
                const valueString = value.action_heater_mode ? 'READY' : 'REST';
                data = await this._controlMySpaClient.setHeaterMode(valueString);
            }

            if ('action_temp_range' in value) {
                data = await this._controlMySpaClient.setTempRange(value.action_temp_range);
            }

            if ('filter' in value && 'interval' in value) {
                if (value.filter === 0 && value.interval === 0) {
                    throw new Error('Filter 1 cannot be disabled');
                }
                data = await this._controlMySpaClient.setFilterCycle(value.filter, value.interval, value.startTime);
            }

            if (data) {
                await this.setCapabilityValues(data);
            }

            return Promise.resolve(true);
        } catch (e) {
            this.homey.app.error(e);
            return Promise.reject(e);
        }
    }

    async onCapability_UPDATE_DATA(value) {
        try {
            this.homey.app.log(`[Device] ${this.getName()} - onCapability_UPDATE_DATA`, value);

            await this.setCapabilityValues();

            await this.setCapabilityValue('action_update_data', false);

            await sleep(2000);

            return Promise.resolve(true);
        } catch (e) {
            this.homey.app.error(e);
            return Promise.reject(e);
        }
    }

    async setCapabilityValues(deviceInfoOverride = null, check = false) {
        this.homey.app.log(`[Device] ${this.getName()} - setCapabilityValues`);

        try {
            const settings = this.getSettings();
            const currentState = await this._controlMySpaClient.getSpa();
            this.homey.app.log(`[Device] ${this.getName()} - deviceInfo =>`, JSON.stringify(currentState, null, 2));

            let { desiredTemp, targetDesiredTemp, currentTemp, panelLock, heaterMode, components, online, tempRange, setupParams, hour, minute, timeNotSet, military } = currentState;

            // Check for existence
            const pump0 = await this.getComponent('PUMP', components, '0');
            const pump1 = await this.getComponent('PUMP', components, '1');
            const pump2 = await this.getComponent('PUMP', components, '2');
            const blower0 = await this.getComponent('BLOWER', components, '0');
            const blower1 = await this.getComponent('BLOWER', components, '1');
            const blower2 = await this.getComponent('BLOWER', components, '2');
            const circulationPump = await this.getComponent('CIRCULATION_PUMP', components);
            const heater = await this.getComponent('HEATER', components);
            const ozone = await this.getComponent('OZONE', components);

            if (check) {
                if (pump0) await this.addCapability('action_pump_state');
                if (pump1) await this.addCapability('action_pump_state.1');
                if (pump2) await this.addCapability('action_pump_state.2');
                if (blower0) await this.addCapability('action_blower_state');
                if (blower1) await this.addCapability('action_blower_state.1');
                if (blower2) await this.addCapability('action_blower_state.2');
            }

            // ------------ Get values --------------
            const light = await this.getComponentValue('LIGHT', components);
            const tempRangeHigh = tempRange === 'HIGH';
            const tempRangeLow = tempRange === 'LOW';
            const heaterReady = heaterMode === 'READY';

            if (tempRangeHigh) {
                await this.setCapabilityOptions('target_temperature', {
                    min: toCelsius(setupParams.highRangeLow),
                    max: toCelsius(setupParams.highRangeHigh)
                });
            } else if (tempRangeLow) {
                await this.setCapabilityOptions('target_temperature', {
                    min: toCelsius(setupParams.lowRangeLow),
                    max: toCelsius(setupParams.lowRangeHigh)
                });
            }

            if (pump0) {
                const pump0_val = pump0.value === 'HIGH';
                await this.setValue('action_pump_state', pump0_val, check);
            }
            if (pump1) {
                const pump1_val = pump1.value === 'HIGH';
                await this.setValue('action_pump_state.1', pump1_val, check);
            }
            if (pump2) {
                const pump2_val = pump2.value === 'HIGH';
                await this.setValue('action_pump_state.2', pump2_val, check);
            }
            if (blower0) {
                const blower0_val = blower0.value === 'HIGH';
                await this.setValue('action_blower_state', blower0_val, check);
            }
            if (blower1) {
                const blower1_val = blower1.value === 'HIGH';
                await this.setValue('action_blower_state.1', blower1_val, check);
            }
            if (blower2) {
                const blower2_val = blower2.value === 'HIGH';
                await this.setValue('action_blower_state.2', blower2_val, check);
            }
            if (heater) {
                await this.setValue('measure_heater', heater.value, check);
            }

            if (circulationPump) {
                await this.setValue('measure_circulation_pump', circulationPump.value, check);
            }

            if (ozone) {
                await this.setValue('measure_ozone', ozone.value, check);
            }

            await this.setValue('action_update_data', false, check);
            await this.setValue('locked', panelLock, check);
            await this.setValue('action_light_state', light, check);
            await this.setValue('action_heater_mode', heaterReady, check);
            await this.setValue('action_temp_range', tempRangeHigh, check);
            await this.setValue('measure_temperature_range', tempRange, check);
            await this.setValue('measure_heater_mode', heaterMode, check);
            await this.setValue('measure_online', online, check);

            if (currentTemp) await this.setValue('measure_temperature', toCelsius(currentTemp), check, 10, settings.round_temp);

            // If desiredTemp is available, compare it to targetDesiredTemp. There should be 0.4 difference for valid value.
            // Use also desiredTemp when targetDesiredTemp is at highRangeHigh or lowRangeLow, when tempRange was changed.
            // Fallback to targetDesiredTemp if desiredTemp is not available or update is delayed in the device API.
            // Values need to be Number for the strict comparison.
            // 2023-12-19 CMS API introduced a bug in numeric values where the decimal separtor is a comma instead of a dot.

            if (typeof targetDesiredTemp !== 'undefined') targetDesiredTemp = Number(targetDesiredTemp.toString().replace(',', '.'));
            if (typeof desiredTemp !== 'undefined') desiredTemp = Number(desiredTemp.toString().replace(',', '.'));

            if (desiredTemp && (targetDesiredTemp === desiredTemp + 0.4 || targetDesiredTemp === setupParams.highRangeHigh || targetDesiredTemp == setupParams.lowRangeLow)) {
                await this.setValue('target_temperature', toCelsius(desiredTemp), check, 10, settings.round_temp);
            } else {
                await this.setValue('target_temperature', toCelsius(targetDesiredTemp - 0.4), check, 10, settings.round_temp);
            }

            // Set Spa clock if spa is online and clock_sync is enabled.
            // - timeNotSet: true if time is not set in the spa
            // - military: true if 24h clock is used in the spa
            // - settings.clock_24: true if 24h clock is set by user in Homey
            // - time difference between spa and Homey is more than 5 minutes
            const timeNow = new Date();
            const myTZ = this.homey.clock.getTimezone();
            const myTime = timeNow.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: myTZ });
            const myDate = timeNow.toLocaleString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: myTZ });
            const myTimeMinutes = Number(myTime.split(':')[0]) * 60 + Number(myTime.split(':')[1]);
            const spaTimeMinutes = hour * 60 + minute;

            if (online && settings.clock_sync && (timeNotSet || military !== settings.clock_24 || Math.abs(spaTimeMinutes - myTimeMinutes) > 5)) {
                this.homey.app.log(`[Device] ${this.getName()} - setClock ${myDate} ${myTime} ${myTZ} clock_24=${settings.clock_24}`);
                await this._controlMySpaClient.setTime(myDate, myTime, settings.clock_24);
            } else {
                this.homey.app.log(`[Device] ${this.getName()} - setClock - clock sync disabled or clock is in sync.`);
            }
        } catch (error) {
            this.homey.app.error(error);
        }
    }

    async getComponent(val, components, index = null) {
        if (index) {
            return components.find((el, id) => el.componentType === val && el.port === index);
        }
        return components.find((el, id) => el.componentType === val);
    }

    async getComponentValue(val, components) {
        const comp = components.find((el, id) => el.componentType === val);
        if (comp) {
            return comp.value === 'HIGH' || comp.value === 'ON';
        }

        return false;
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

            try {
                await this.setCapabilityValue(key, newVal);
            } catch (error) {
                this.homey.app.error(`[Device] ${this.getName()} - setValue - error =>`, error);
            }

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
