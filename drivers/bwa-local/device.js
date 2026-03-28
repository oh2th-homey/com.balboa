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
const { sleep, decrypt, encrypt, toCelsius, toFahrenheit } = require('../../lib/helpers');
const BalboaLocal = require('../../lib/balboa/local');

module.exports = class device_BWA extends Homey.Device {
    async onInit() {
        try {
            this.homey.app.log('[Device] - init =>', this.getName());
            this._locks = {};
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
        const deviceData = this.getData();

        try {
            this.config = { ...settings };
            if (this.config.password) {
                this.config.password = decrypt(this.config.password);
            }

            this.homey.app.log(`[Device] - ${this.getName()} => setBwaClient Got config`, { ...this.config, username: 'LOG', password: 'LOG' });

            if (this.config.mode === 'local') {
                this.homey.app.log(`[Device] - ${this.getName()} => Using LOCAL mode at ${this.config.ip}`);
                this._BwaClient = new BalboaLocal(this.config.ip);

                // Polyfill for BWA interface
                this._BwaClient.getSpa = async () => {
                    // Adapt local state to BWA format if needed, but setCapabilityValues handles it
                    return this._BwaClient.lastState;
                };

                this._BwaClient.on('status', (state) => {
                    this.setCapabilityValues();
                });

                this._BwaClient.on('config', (config) => {
                    this.homey.app.log(`[Device] ${this.getName()} - Received local config:`, config);
                    this.setCapabilityValues(null, true);
                });

                this._BwaClient.on('error', (err) => {
                    this.homey.app.error(`[Device] ${this.getName()} - Local Client Error:`, err);
                });

                this._BwaClient.on('commandFailed', (info) => {
                    this.homey.app.error(`[Device] ${this.getName()} - COMMAND FAILED: ${info.description}`);
                });

                this._BwaClient.on('ipChanged', async ({ oldIp, newIp }) => {
                    this.homey.app.log(`[Device] ${this.getName()} - 🔄 Spa IP changed: ${oldIp} → ${newIp}`);
                    try {
                        // Persist the new IP to device settings so it survives restarts
                        this.config.ip = newIp;
                        await this.setSettings({ ip: newIp });
                        this.homey.app.log(`[Device] ${this.getName()} - New IP saved to settings`);
                    } catch (err) {
                        this.homey.app.error(`[Device] ${this.getName()} - Failed to save new IP:`, err);
                    }
                });

                this._BwaClient.connect();
                // Start periodic polling so we always have fresh state for commands and UI
                this._BwaClient.startPolling(300000); // Every 5 minutes
                await this.setAvailable();
                await this.setIntervalsAndFlows(settings);
            } else {
                this.homey.app.log(`[Device] - ${this.getName()} => Using CLOUD mode`);
                this._BwaClient = await loginAndGetToken(this.config.username, this.config.password);
                const components = await handleDeviceConfigurationRequest(deviceData.id);

                if (Object.keys(components).length) {
                    await this.setCapabilityValues(null, true);
                    await this.setAvailable();
                    await this.setIntervalsAndFlows(settings);
                } else {
                    this.setUnavailable(`Something went wrong with connecting to ${this.getName()}`);
                }
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
                'action_heater_mode',
                'action_temp_range'
            ],
            this.onCapability_ACTION.bind(this)
        );
    }

    async onCapability_TEMPERATURE(value) {
        try {
            const deviceObject = this.getData();
            this.homey.app.log(`[Device] ${this.getName()} - onCapability_TEMPERATURE ${value}C`);

            // Lock temperature for 10 seconds (local spas can be slow to update status)
            if (!this._locks) this._locks = {};
            this._locks['target_temperature'] = {
                value: value,
                expiry: Date.now() + 10000
            };

            if (this.config.mode === 'local') {
                await this._BwaClient.setTemp(value);
            } else {
                await updateTemperature(deviceObject.id, value);
            }

            return Promise.resolve(true);
        } catch (e) {
            this.homey.app.error(e);
            return Promise.reject(e);
        }
    }

    async onCapability_LOCKED(value) {
        try {
            this.homey.app.log(`[Device] ${this.getName()} - onCapability_LOCKED`, value);

            if (this.config.mode === 'local') {
                await this._BwaClient.setPanelLock(value);
            } else {
                if (value) {
                    await this._BwaClient.lockPanel();
                } else {
                    await this._BwaClient.unlockPanel();
                }
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

            // Lock capabilities for 5 seconds to prevent UI reverts from stale status packets
            if (!this._locks) this._locks = {};
            Object.keys(value).forEach(cap => {
                this._locks[cap] = {
                    value: value[cap],
                    expiry: Date.now() + 5000
                };
            });

            if (this.config.mode === 'local') {
                if ('action_blower_state' in value) await this._BwaClient.setBlowerState(0, value.action_blower_state);
                if ('action_light_state' in value) await this._BwaClient.setLightState(0, value.action_light_state);
                if ('action_pump_state' in value) await this._BwaClient.setJetState(0, value.action_pump_state);
                if ('action_pump_state.1' in value) await this._BwaClient.setJetState(1, value['action_pump_state.1']);
                if ('action_pump_state.2' in value) await this._BwaClient.setJetState(2, value['action_pump_state.2']);
                if ('action_pump_state.3' in value) await this._BwaClient.setJetState(3, value['action_pump_state.3']);
                if ('action_pump_state.4' in value) await this._BwaClient.setJetState(4, value['action_pump_state.4']);
                if ('action_pump_state.5' in value) await this._BwaClient.setJetState(5, value['action_pump_state.5']);
                if ('action_heater_mode' in value) await this._BwaClient.setHeaterMode(value.action_heater_mode ? 'READY' : 'REST');
                if ('action_temp_range' in value) await this._BwaClient.setTempRange(value.action_temp_range);
            } else {
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

                if ('action_temp_range' in value) {
                    const isHighRange = value.action_temp_range === true || value.action_temp_range === 'HIGH' || value.action_temp_range === 'high';
                    const targetRange = isHighRange ? 'HIGH' : 'LOW';

                    // Lock the intended range to prevent polling from reverting UI limits
                    this._intendedRange = targetRange;

                    await this._BwaClient.setTempRange(isHighRange);
                    await this._updateTargetTempLimits(targetRange);
                }
            }

            // Wait a small amount for the spa to process the command before next poll
            // No longer calling setCapabilityValues() immediately to prevent race conditions with stale status packets
            await sleep(1000);

            return Promise.resolve(true);
        } catch (e) {
            this.homey.app.error(e);
            return Promise.reject(e);
        }
    }

    async onCapability_UPDATE_DATA(value) {
        try {
            this.homey.app.log(`[Device] ${this.getName()} - onCapability_UPDATE_DATA`, value);

            // Actually fetch fresh state from the spa (not just re-render cached state)
            if (this._BwaClient && this._BwaClient.ensureState) {
                await this._BwaClient.ensureState();
            }

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
        // this.homey.app.log(`[Device] ${this.getName()} - setCapabilityValues`);

        try {
            const deviceObject = this.getData();
            const settings = this.getSettings();

            let deviceInfo;
            if (this.config.mode === 'local') {
                const localState = this._BwaClient.lastState;
                // Only skip status updates, not capability checks (which use lastConfig)
                if (!localState && !check) return;

                if (localState) {
                    // Map local state to BWA format
                    const pump1 = localState.components.find(c => c.componentType === 'PUMP' && c.port === '0');
                    const pump2 = localState.components.find(c => c.componentType === 'PUMP' && c.port === '1');
                    const pump3 = localState.components.find(c => c.componentType === 'PUMP' && c.port === '2');
                    const pump4 = localState.components.find(c => c.componentType === 'PUMP' && c.port === '3');
                    const pump5 = localState.components.find(c => c.componentType === 'PUMP' && c.port === '4');
                    const pump6 = localState.components.find(c => c.componentType === 'PUMP' && c.port === '5');
                    const blower = localState.components.find(c => c.componentType === 'BLOWER');
                    const heater = localState.components.find(c => c.componentType === 'HEATER');

                    deviceInfo = {
                        actualTemperature: localState.currentTemp,
                        targetTemperature: localState.desiredTemp,
                        pumpsState: {
                            Pump1: pump1 ? (pump1.value === 'OFF' ? 'off' : 'on') : 'off',
                            Pump2: pump2 ? (pump2.value === 'OFF' ? 'off' : 'on') : 'off',
                            Pump3: pump3 ? (pump3.value === 'OFF' ? 'off' : 'on') : 'off',
                            Pump4: pump4 ? (pump4.value === 'OFF' ? 'off' : 'on') : 'off',
                            Pump5: pump5 ? (pump5.value === 'OFF' ? 'off' : 'on') : 'off',
                            Pump6: pump6 ? (pump6.value === 'OFF' ? 'off' : 'on') : 'off',
                        },
                        lightsState: {
                            Light1: localState.components.find(c => c.componentType === 'LIGHT' && c.port === '0')?.value === 'OFF' ? 'off' : 'on'
                        },
                        blowerState: blower ? (blower.value === 'OFF' ? 'off' : 'on') : 'off',
                        temperatureRange: localState.tempRange.toLowerCase(),
                        heatMode: localState.heaterMode,
                        isHeating: heater ? heater.value === 'ON' : false,
                        wifiState: localState.online ? 'WiFi OK' : 'Offline'
                    };
                }
            } else {
                deviceInfo = deviceInfoOverride ? deviceInfoOverride : await handlePanelUpdateRequest(deviceObject.id);
            }

            // Handle capability addition (check mode)
            if (check) {
                let components = {};
                if (this.config.mode === 'local') {
                    const localConfig = this._BwaClient.lastConfig;

                    if (localConfig) {
                        components = {
                            Pumps: {
                                Pump1: { present: localConfig.pumps.Pump1 },
                                Pump2: { present: localConfig.pumps.Pump2 },
                                Pump3: { present: localConfig.pumps.Pump3 },
                                Pump4: { present: localConfig.pumps.Pump4 },
                                Pump5: { present: localConfig.pumps.Pump5 },
                                Pump6: { present: localConfig.pumps.Pump6 }
                            },
                            Blower: { present: localConfig.blower },
                            Lights: { Light1: { present: localConfig.lights.Light1 } }
                        };

                    }
                } else {
                    components = await handleDeviceConfigurationRequest(deviceObject.id);
                }

                if (components && components.Pumps) {
                    const { Pumps: pumps } = components;

                    if (pumps.Pump1 && pumps.Pump1.present) await this.addCapability('action_pump_state');
                    if (pumps.Pump2 && pumps.Pump2.present) await this.addCapability('action_pump_state.1');
                    if (pumps.Pump3 && pumps.Pump3.present) await this.addCapability('action_pump_state.2');
                    if (pumps.Pump4 && pumps.Pump4.present) await this.addCapability('action_pump_state.3');
                    if (pumps.Pump5 && pumps.Pump5.present) await this.addCapability('action_pump_state.4');
                    if (pumps.Pump6 && pumps.Pump6.present) await this.addCapability('action_pump_state.5');
                    if (components.Blower && components.Blower.present) await this.addCapability('action_blower_state');
                }
            }

            // If no deviceInfo (only ran check mode), return early
            if (!deviceInfo) return;

            const { actualTemperature, targetTemperature, pumpsState, lightsState, blowerState, temperatureRange, heatMode, isHeating, wifiState } = deviceInfo;

            // this.homey.app.log(`[Device] ${this.getName()} - deviceInfo =>`, deviceInfo);

            await this._updateTargetTempLimits();

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
            await this.setValue('action_temp_range', temperatureRange.toLowerCase() === 'high', check);

            await this.setValue('measure_heater_mode', heatMode.toUpperCase(), check);
            const online = wifiState === 'WiFi OK';
            await this.setValue('alarm_connectivity', !online, check);

            await this.setValue('target_temperature', targetTemperature, check, 10, settings.round_temp);

            if (actualTemperature === 127.5) {
                // Spa is in sleep mode — temperature sensor is off (raw 0xFF = 127.5°C).
                // Skip update so Homey keeps showing the last real temperature reading.
                // Only log once to avoid spamming the log on every poll.
                if (!this._sleepModeTempLogged) {
                    this._sleepModeTempLogged = true;
                    this.homey.app.log(`[Device] ${this.getName()} - Temperature unavailable (spa in sleep mode), keeping last known value`);
                }
            } else {
                this._sleepModeTempLogged = false; // Reset flag when real temp is available again
                await this.setValue('measure_temperature', actualTemperature, check, 10, settings.round_temp);
            }
        } catch (error) {
            this.homey.app.error(error);
        }
    }

    async setValue(key, value, firstRun = false, delay = 10, roundNumber = false) {
        if (this.hasCapability(key)) {
            // Check if capability is locked
            if (this._locks && this._locks[key]) {
                const lock = this._locks[key];
                if (Date.now() < lock.expiry) {
                    const isDifferent = typeof lock.value === 'number' ? Math.abs(lock.value - value) > 0.1 : lock.value !== value;
                    if (isDifferent) {
                        this.homey.app.log(`[Device] ${this.getName()} - Ignoring revert for ${key} (locked to ${lock.value}, got ${value})`);
                        return;
                    } else {
                        // Value matches, we can unlock early
                        delete this._locks[key];
                    }
                } else {
                    delete this._locks[key];
                }
            }

            const newKey = key.replace('.', '_');
            const oldVal = this.getCapabilityValue(key);
            const newVal = roundNumber ? Math.round(value) : value;

            if (oldVal === newVal) return;

            this.homey.app.log(`[Device] ${this.getName()} - setValue => ${key} => `, newVal, `(was ${oldVal})`);

            if (delay) {
                await sleep(delay);
            }

            try {
                await this.setCapabilityValue(key, newVal);
            }
            catch (error) {
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
            // Exclude dynamic capabilities (pumps, blowers) from removal - they're added based on spa config
            const dynamicCapabilities = ['action_pump_state', 'action_pump_state.1', 'action_pump_state.2',
                'action_pump_state.3', 'action_pump_state.4', 'action_pump_state.5',
                'action_blower_state', 'action_blower_state.1'];
            const oldC = deviceCapabilities.filter((d) => !driverCapabilities.includes(d) && !dynamicCapabilities.includes(d));

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
        if (this._BwaClient && this._BwaClient.stopPolling) {
            this._BwaClient.stopPolling();
        }
        if (this._BwaClient && this._BwaClient.disconnect) {
            this._BwaClient.disconnect();
        }
    }
    async _updateTargetTempLimits(forcedRange = null) {
        if (!this._BwaClient || !this._BwaClient.lastState) return;

        const { setupParams, tempRange: stateRange } = this._BwaClient.lastState;
        if (!setupParams) return;

        // Prioritize: 1. Forced range argument, 2. Intended range (from user click), 3. Current reported state
        const tempRange = forcedRange || this._intendedRange || stateRange;

        // If state matches intended range, we can clear the lock
        if (stateRange.toUpperCase() === (this._intendedRange || '').toUpperCase()) {
            this._intendedRange = null;
        }

        const isHigh = tempRange.toUpperCase() === 'HIGH';
        const min = isHigh ? setupParams.highRangeLow : setupParams.lowRangeLow;
        const max = isHigh ? setupParams.highRangeHigh : setupParams.lowRangeHigh;

        // Only update if limits have actually changed to avoid UI flickering/glitching
        if (this._currentLimits && this._currentLimits.min === min && this._currentLimits.max === max) {
            return;
        }

        this.homey.app.log(`[Device] ${this.getName()} - Updating target_temperature limits: min=${min}, max=${max} (range=${tempRange})`);

        try {
            this._currentLimits = { min, max };
            await this.setCapabilityOptions('target_temperature', {
                min: min,
                max: max,
                step: 0.5
            });

            // Force UI refresh by re-asserting the current target temperature.
            // This makes the Homey app slider snap to the new min/max bounds.
            const currentTarget = this.getCapabilityValue('target_temperature');
            if (currentTarget !== null) {
                const snappedTarget = Math.min(max, Math.max(min, Number(currentTarget)));
                await this.setCapabilityValue('target_temperature', snappedTarget);
            }
        } catch (err) {
            this.homey.app.error(`[Device] ${this.getName()} - Failed to update target_temperature options: ${err.message}`);
            this._currentLimits = null; // Reset on error
        }
    }
};
