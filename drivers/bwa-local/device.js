const Homey = require('homey');
const { sleep, formatCommand } = require('../../lib/helpers');
const BalboaLocal = require('../../lib/balboa/local');

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
      this._locks = {};
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

      await this.setBwaClient(newSettings);
    }
  }

  // ------------- API -------------
  async setBwaClient(overrideSettings = null) {
    const settings = overrideSettings ? overrideSettings : this.getSettings();

    try {
      this.config = { ...settings };
      this._BwaClient = new BalboaLocal(this.config.ip);

      this._BwaClient.getSpa = async () => this._BwaClient.lastState;

      this._BwaClient.on('status', () => {
        if (this._pollError) {
          this._pollError = null;
          this.log('Spa responding again');
        }
        this.setCapabilityValues();
      });

      this._BwaClient.on('config', () => {
        this.setCapabilityValues(null, true);
      });

      // A poll that has no caller failed. Log it once, not again on every poll while it lasts.
      this._BwaClient.on('pollError', (err) => {
        if (this._pollError !== err.message) {
          this._pollError = err.message;
          this.error(`Polling the spa failed: ${err.message}`);
        }
      });

      this._BwaClient.on('ipChanged', async ({ oldIp, newIp }) => {
        this.log(`Spa address changed from ${oldIp} to ${newIp}`);
        try {
          this.config.ip = newIp;
          await this.setSettings({ ip: newIp });
        } catch (err) {
          this.error(`Saving the new spa address failed: ${err.message}`);
        }
      });

      const pollIntervalMs = 300000;
      this._BwaClient.connect();
      this._BwaClient.startPolling(pollIntervalMs);
      this.log(`Polling the spa at ${this.config.ip} every ${pollIntervalMs / 1000} s`);
      await this.setAvailable();
      await this.setIntervalsAndFlows(settings);
    } catch (error) {
      this.error(`Connecting to the spa failed: ${error.message}`);
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
      this.log(`Command: target_temperature ${value} °C`);

      // Lock temperature for 10 seconds (local spas can be slow to update status)
      if (!this._locks) this._locks = {};
      this._locks['target_temperature'] = {
        value: value,
        expiry: Date.now() + 10000
      };

      this.checkCommandResult(await this._BwaClient.setTemp(value));

      return Promise.resolve(true);
    } catch (e) {
      this.error(`Command failed: ${e.message}`);
      return Promise.reject(e);
    }
  }

  async onCapability_LOCKED(value) {
    try {
      this.log(`Command: locked ${value}`);

      await this._BwaClient.setPanelLock(value);

      return Promise.resolve(true);
    } catch (e) {
      this.error(`Command failed: ${e.message}`);
      return Promise.reject(e);
    }
  }

  async onCapability_ACTION(value) {
    try {
      this.log(`Command: ${formatCommand(value)}`);

      // Lock capabilities for 5 seconds to prevent UI reverts from stale status packets
      if (!this._locks) this._locks = {};
      Object.keys(value).forEach((cap) => {
        this._locks[cap] = {
          value: value[cap],
          expiry: Date.now() + 5000
        };
      });

      const client = this._BwaClient;
      const check = this.checkCommandResult.bind(this);
      if ('action_blower_state' in value) check(await client.setBlowerState(0, value.action_blower_state));
      if ('action_light_state' in value) check(await client.setLightState(0, value.action_light_state));
      if ('action_pump_state' in value) check(await client.setJetState(0, value.action_pump_state));
      if ('action_pump_state.1' in value) check(await client.setJetState(1, value['action_pump_state.1']));
      if ('action_pump_state.2' in value) check(await client.setJetState(2, value['action_pump_state.2']));
      if ('action_pump_state.3' in value) check(await client.setJetState(3, value['action_pump_state.3']));
      if ('action_pump_state.4' in value) check(await client.setJetState(4, value['action_pump_state.4']));
      if ('action_pump_state.5' in value) check(await client.setJetState(5, value['action_pump_state.5']));
      if ('action_heater_mode' in value) check(await client.setHeaterMode(value.action_heater_mode ? 'READY' : 'REST'));
      if ('action_temp_range' in value) {
        const isHighRange = value.action_temp_range === true || value.action_temp_range === 'HIGH' || value.action_temp_range === 'high';
        const targetRange = isHighRange ? 'HIGH' : 'LOW';

        this._intendedRange = targetRange;

        check(await client.setTempRange(isHighRange));
        await this._updateTargetTempLimits(targetRange);
      }

      // Wait a small amount for the spa to process the command before next poll
      // No longer calling setCapabilityValues() immediately to prevent race conditions with stale status packets
      await sleep(1000);

      return Promise.resolve(true);
    } catch (e) {
      this.error(`Command failed: ${e.message}`);
      return Promise.reject(e);
    }
  }

  async onCapability_UPDATE_DATA(value) {
    try {
      this.log('Command: update data');

      // Actually fetch fresh state from the spa (not just re-render cached state)
      if (this._BwaClient && this._BwaClient.ensureState) {
        await this._BwaClient.ensureState();
      }

      await this.setCapabilityValues();

      await this.setCapabilityValue('action_update_data', false);

      await sleep(2000);

      return Promise.resolve(true);
    } catch (e) {
      this.error(`Command failed: ${e.message}`);
      return Promise.reject(e);
    }
  }

  // A command the spa did not confirm does not fail the capability or flow card, but is logged.
  checkCommandResult(result) {
    if (result && !result.verified) {
      this.error(`Command not confirmed by the spa: ${result.description}`);
    }
  }

  async setCapabilityValues(deviceInfoOverride = null, check = false) {
    try {
      const settings = this.getSettings();

      let deviceInfo;
      const localState = this._BwaClient.lastState;
      if (!localState && !check) return;

      if (localState) {
        const pump1 = localState.components.find((c) => c.componentType === 'PUMP' && c.port === '0');
        const pump2 = localState.components.find((c) => c.componentType === 'PUMP' && c.port === '1');
        const pump3 = localState.components.find((c) => c.componentType === 'PUMP' && c.port === '2');
        const pump4 = localState.components.find((c) => c.componentType === 'PUMP' && c.port === '3');
        const pump5 = localState.components.find((c) => c.componentType === 'PUMP' && c.port === '4');
        const pump6 = localState.components.find((c) => c.componentType === 'PUMP' && c.port === '5');
        const blower = localState.components.find((c) => c.componentType === 'BLOWER');
        const heater = localState.components.find((c) => c.componentType === 'HEATER');

        deviceInfo = {
          actualTemperature: localState.currentTemp,
          targetTemperature: localState.desiredTemp,
          pumpsState: {
            Pump1: pump1 ? (pump1.value === 'OFF' ? 'off' : 'on') : 'off',
            Pump2: pump2 ? (pump2.value === 'OFF' ? 'off' : 'on') : 'off',
            Pump3: pump3 ? (pump3.value === 'OFF' ? 'off' : 'on') : 'off',
            Pump4: pump4 ? (pump4.value === 'OFF' ? 'off' : 'on') : 'off',
            Pump5: pump5 ? (pump5.value === 'OFF' ? 'off' : 'on') : 'off',
            Pump6: pump6 ? (pump6.value === 'OFF' ? 'off' : 'on') : 'off'
          },
          lightsState: {
            Light1: localState.components.find((c) => c.componentType === 'LIGHT' && c.port === '0')?.value === 'OFF' ? 'off' : 'on'
          },
          blowerState: blower ? (blower.value === 'OFF' ? 'off' : 'on') : 'off',
          temperatureRange: localState.tempRange.toLowerCase(),
          heatMode: localState.heaterMode,
          isHeating: heater ? heater.value === 'ON' : false,
          wifiState: localState.online ? 'WiFi OK' : 'Offline'
        };
      }

      // Handle capability addition (check mode)
      if (check) {
        let components = {};
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
      this._changes = [];

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
          this.log('Temperature unavailable (spa in sleep mode), keeping the last value');
        }
      } else {
        this._sleepModeTempLogged = false; // Reset flag when real temp is available again
        await this.setValue('measure_temperature', actualTemperature, check, 10, settings.round_temp);
      }

      // The spa sends status often while connected: log only when something changed.
      if (this._changes.length) {
        this.log(`${check ? 'Received' : 'Changed'}: ${this._changes.join(', ')}`);
      }
    } catch (error) {
      this.error(`Updating capabilities failed: ${error.message}`);
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
            // Ignore a stale status that would revert a value just set from Homey
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

      if (this._changes) {
        this._changes.push(`${key} ${oldVal} → ${newVal}`);
      }

      if (delay) {
        await sleep(delay);
      }

      try {
        await this.setCapabilityValue(key, newVal);
      } catch (error) {
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

  // ------------- Intervals -------------
  async setIntervalsAndFlows(settings) {
    try {
      if (this.getAvailable()) {
        await this.setCapabilityValuesInterval(settings.update_interval);
      }
    } catch (error) {
      this.error(`Starting the update interval failed: ${error.message}`);
    }
  }

  async setCapabilityValuesInterval(update_interval) {
    try {
      const REFRESH_INTERVAL = 1000 * update_interval;

      this.onPollInterval = setInterval(this.setCapabilityValues.bind(this), REFRESH_INTERVAL);
    } catch (error) {
      this.setUnavailable(error);
      this.error(`Starting the update interval failed: ${error.message}`);
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
      // Exclude dynamic capabilities (pumps, blowers) from removal - they're added based on spa config
      const dynamicCapabilities = [
        'action_pump_state',
        'action_pump_state.1',
        'action_pump_state.2',
        'action_pump_state.3',
        'action_pump_state.4',
        'action_pump_state.5',
        'action_blower_state',
        'action_blower_state.1'
      ];
      const oldC = deviceCapabilities.filter((d) => !driverCapabilities.includes(d) && !dynamicCapabilities.includes(d));

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

    this.log(`Target temperature range set to ${tempRange.toUpperCase()} (${min}–${max} °C)`);

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
      this.error(`Updating the target temperature range failed: ${err.message}`);
      this._currentLimits = null; // Reset on error
    }
  }
};
