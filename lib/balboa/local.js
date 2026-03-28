const net = require('net');
const EventEmitter = require('events');

/**
 * BalboaLocal - Reliable local implementation for Balboa (BWA)
 * Communication on port 4257 (TCP)
 *
 * Uses a connect-on-demand pattern with:
 * - ensureState(): guarantees fresh state before any command
 * - Command verification + retry for toggle commands
 * - Periodic polling for up-to-date UI state
 */
class BalboaLocal extends EventEmitter {
    constructor(host) {
        super();
        this.host = host;
        this.port = 4257;
        this.client = null;
        this.lastState = null;
        this.lastConfig = null;
        this.reconnectTimeout = null;
        this.connected = false;

        // Connect-on-demand for energy saving
        this.pollIntervalMs = 300000; // 5 minutes between polls
        this.pollTimer = null;
        this.disconnectTimeout = null;
        this.pendingCommand = false; // If we're waiting for command confirmation
        this.disconnectDelayMs = 5000; // Disconnect 5 seconds after last activity

        // Command mutex to prevent concurrent command sequences
        this._commandLock = false;
    }

    async connect() {
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);

        console.log(`[BalboaLocal] Connecting to ${this.host}:${this.port}...`);

        this.client = new net.Socket();

        this.client.connect(this.port, this.host, () => {
            console.log(`[BalboaLocal] Connected to ${this.host}`);
            this.connected = true;
            this.emit('connected');
            // Request configuration
            this._writeRaw(0x04, []);
        });

        this.client.on('data', (data) => {
            this._handleData(data);
        });

        this.client.on('error', (err) => {
            console.error(`[BalboaLocal] Socket Error: ${err.message}`);
            this.connected = false;
            this.emit('connectError', err);
        });

        this.client.on('close', () => {
            console.log(`[BalboaLocal] Connection closed`);
            this.connected = false;
        });
    }

    /**
     * Disconnect from spa (for energy saving)
     */
    disconnect() {
        if (this.disconnectTimeout) {
            clearTimeout(this.disconnectTimeout);
            this.disconnectTimeout = null;
        }
        if (this.client) {
            console.log(`[BalboaLocal] Disconnecting for energy saving...`);
            this.client.end();
            setTimeout(() => {
                if (this.client) {
                    this.client.destroy();
                    this.client = null;
                }
            }, 500);
            this.connected = false;
        }
    }

    /**
     * Schedule disconnect after receiving status (for energy saving).
     * Resets timer on each call so new activity extends the window.
     */
    _scheduleDisconnect() {
        // Don't disconnect if we have a pending command
        if (this.pendingCommand) return;

        // Reset timer on each call — new activity extends the disconnect window
        if (this.disconnectTimeout) clearTimeout(this.disconnectTimeout);

        this.disconnectTimeout = setTimeout(() => {
            this.disconnectTimeout = null;
            this.disconnect();
        }, this.disconnectDelayMs);
    }

    /**
     * Ensure connected to spa. Retries up to 3 times to handle Wi-Fi module sleep mode.
     * If all attempts fail, runs auto-discovery to find the spa at a new IP (DHCP change).
     * Emits 'ipChanged' event if the spa is found at a different IP.
     */
    async ensureConnected() {
        if (this.connected && this.client) return Promise.resolve();

        // Cancel any scheduled disconnect
        if (this.disconnectTimeout) {
            clearTimeout(this.disconnectTimeout);
            this.disconnectTimeout = null;
        }

        // Phase 1: Try the configured IP (handles sleep mode with retries)
        const connected = await this._tryConnectWithRetries(this.host, 3);
        if (connected) return;

        // Phase 2: Configured IP failed — spa may have a new IP from DHCP
        console.log(`[BalboaLocal] Configured IP ${this.host} unreachable — scanning network for spa...`);
        const discoveredIps = await BalboaLocal.discover(10000, this.host);

        if (discoveredIps.length === 0) {
            throw new Error(`Spa not found at ${this.host} and no Balboa spas discovered on the network`);
        }

        // Filter out the old IP that already failed
        const newIps = discoveredIps.filter(ip => ip !== this.host);
        const targetIp = newIps.length > 0 ? newIps[0] : discoveredIps[0];

        console.log(`[BalboaLocal] 🔄 Spa discovered at new IP: ${targetIp} (was ${this.host})`);
        const oldHost = this.host;
        this.host = targetIp;

        // Try connecting to the new IP
        const connectedNew = await this._tryConnectWithRetries(this.host, 2);
        if (connectedNew) {
            // Notify the device layer so it can save the new IP to settings
            this.emit('ipChanged', { oldIp: oldHost, newIp: this.host });
            return;
        }

        throw new Error(`Spa discovered at ${targetIp} but connection failed`);
    }

    /**
     * Try connecting to a specific host with retries.
     * @returns {Promise<boolean>} true if connected, false if all attempts failed
     */
    async _tryConnectWithRetries(host, maxAttempts) {
        const perAttemptTimeoutMs = 8000;
        const delayBetweenAttemptsMs = 2000;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`[BalboaLocal] Connection attempt ${attempt}/${maxAttempts} to ${host}...`);

                // Clean up any stale socket from previous attempt
                if (this.client) {
                    this.client.destroy();
                    this.client = null;
                    this.connected = false;
                }

                const savedHost = this.host;
                this.host = host; // Temporarily set for connect()

                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error(`Connection timeout (attempt ${attempt})`));
                    }, perAttemptTimeoutMs);

                    this.once('connected', () => {
                        clearTimeout(timeout);
                        resolve();
                    });

                    const onError = (err) => {
                        clearTimeout(timeout);
                        this.removeAllListeners('connected');
                        reject(new Error(`Connection error (attempt ${attempt}): ${err.message}`));
                    };
                    this.once('connectError', onError);

                    this.connect();
                });

                console.log(`[BalboaLocal] Connected to ${host} on attempt ${attempt}`);
                return true;

            } catch (err) {
                console.warn(`[BalboaLocal] ${err.message}`);

                if (attempt < maxAttempts) {
                    console.log(`[BalboaLocal] Retrying in ${delayBetweenAttemptsMs}ms...`);
                    await new Promise(r => setTimeout(r, delayBetweenAttemptsMs));
                }
            }
        }

        return false; // All attempts failed
    }

    /**
     * Connect, request fresh status, wait for response, return fresh state.
     * This is the KEY method that prevents silent command drops.
     * Handles sleep mode: if the first status request gets no response (common when
     * the Wi-Fi module just woke up), it retries once.
     * @param {number} timeoutMs - How long to wait for each status request
     * @returns {Promise<object>} Fresh state object
     */
    async ensureState(timeoutMs = 8000) {
        // Connect if needed (with sleep-mode retry)
        await this.ensureConnected();

        // Try to get status, retry once if the freshly-woken module drops the first request
        for (let attempt = 1; attempt <= 2; attempt++) {
            // Request fresh status
            this._writeRaw(0x12, []);

            const result = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    this.removeListener('status', onStatus);
                    resolve(null); // Timed out
                }, timeoutMs);

                const onStatus = (state) => {
                    clearTimeout(timeout);
                    resolve(state);
                };

                this.once('status', onStatus);
            });

            if (result) {
                return result; // Got fresh state
            }

            if (attempt === 1) {
                console.warn(`[BalboaLocal] No status response (module may still be waking up) — retrying...`);
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // All attempts failed — use stale state as last resort, or throw
        if (this.lastState) {
            console.warn(`[BalboaLocal] ensureState: using stale state as fallback after retries`);
            return this.lastState;
        }
        throw new Error('Timeout waiting for spa status response after retries (spa may be offline)');
    }

    /**
     * Wait for the next status update from the spa.
     * Used to verify commands took effect.
     */
    _waitForStatus(timeoutMs = 5000) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.removeListener('status', onStatus);
                resolve(this.lastState); // Resolve with whatever we have
            }, timeoutMs);

            const onStatus = (state) => {
                clearTimeout(timeout);
                resolve(state);
            };

            this.once('status', onStatus);
        });
    }

    // ==================== POLLING ====================

    /**
     * Start periodic polling for fresh state.
     * Connects, fetches status, disconnects on each cycle.
     * @param {number} intervalMs - Polling interval (default: 5 minutes)
     */
    startPolling(intervalMs) {
        if (intervalMs) this.pollIntervalMs = intervalMs;
        this.stopPolling(); // Clear any existing timer

        console.log(`[BalboaLocal] Starting periodic polling every ${this.pollIntervalMs / 1000}s`);

        this.pollTimer = setInterval(async () => {
            try {
                await this.ensureState();
                // ensureState connected and got status; _scheduleDisconnect will handle cleanup
            } catch (err) {
                console.error(`[BalboaLocal] Poll failed: ${err.message}`);
            }
        }, this.pollIntervalMs);
    }

    /**
     * Stop periodic polling.
     */
    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    // ==================== DATA HANDLING ====================

    _handleData(data) {
        // Balboa messages are framed: 7E LEN PAYLOAD CRC 7E
        let offset = 0;
        while (offset < data.length) {
            if (data[offset] === 0x7E) {
                const len = data[offset + 1];
                if (offset + len + 2 <= data.length) {
                    const message = data.slice(offset, offset + len + 2);
                    this._processMessage(message);
                    offset += len + 2;
                    continue;
                }
            }
            offset++;
        }
    }

    _processMessage(message) {
        // Status update: 0xFF 0xAF 0x13
        if (message[2] === 0xff && message[3] === 0xaf && message[4] === 0x13) {
            const data = message.slice(2, message.length - 2);
            this.lastState = this._parseStatus(data);
            this.emit('status', this.lastState);
            this._scheduleDisconnect();
        }
        // Configuration response: 0x0a 0xbf 0x94
        else if (message[2] === 0x0a && message[3] === 0xbf && message[4] === 0x94) {
            const configPayload = message.slice(5, message.length - 2);
            this.lastConfig = this._parseConfig(configPayload);
            this.emit('config', this.lastConfig);
            this._scheduleDisconnect();
        }
    }

    _parseConfig(data) {
        return {
            pumps: {
                Pump1: (data[4] & 0x03) !== 0,
                Pump2: (data[4] & 0x0c) !== 0,
                Pump3: false,
                Pump4: false,
                Pump5: false,
                Pump6: false
            },
            lights: {
                Light1: (data[6] & 0x03) !== 0,
                Light2: (data[6] & 0x0c) !== 0
            },
            blower: (data[7] & 0x0c) !== 0,
            aux: {
                Aux1: (data[8] & 0x01) !== 0,
                Aux2: (data[8] & 0x02) !== 0
            },
            mister: (data[8] & 0x10) !== 0
        };
    }

    _parseStatus(data) {
        // VERIFIED offsets from raw hex dump:
        // Full msg: 7e 20 ff af 13 [5]00 [6]00 [7]22 [8]14 [9]21 [10]00 [11]00 [12]48 [13]49 [14]03 [15]1c [16]00 [17]00 [18]02 ... [25]50 ...
        // data = message.slice(2), so data[N] = fullmsg[N+2]
        // data[5] = fullmsg[7] = 0x22 = 34 → 17°C  ← actual temperature
        // data[6] = fullmsg[8] = hour
        // data[7] = fullmsg[9] = minute
        // data[8] = fullmsg[10] = heater mode (0=READY,1=REST)
        // data[12] = fullmsg[14] = temp scale (bit 0: 0=F, 1=C)
        // data[13] = fullmsg[15] = heating status (bits 4-5) + temp range (bit 2)
        // data[14] = fullmsg[16] = pump states
        // data[16] = fullmsg[18] = blower
        // data[17] = fullmsg[19] = lights
        // data[23] = fullmsg[25] = target temperature

        const currentTimeHour = data[6];
        const currentTimeMinute = data[7];
        const temperatureScale = (data[12] & 0x01) === 0 ? 'F' : 'C';
        const temperatureRange = (data[13] & 0x04) === 0x04 ? 'HIGH' : 'LOW';
        const isHeating = (data[13] & 0x30) !== 0;

        let actualTemperature = data[5];
        let targetTemperature = data[23];

        if (temperatureScale === 'C') {
            actualTemperature = actualTemperature / 2;
            targetTemperature = targetTemperature / 2;
        }

        let heaterMode;
        const modeBits = data[8] & 0x03;
        switch (modeBits) {
            case 0: heaterMode = 'READY'; break;
            case 1: heaterMode = 'REST'; break;
            case 3: heaterMode = 'READY_REST'; break;
            default: heaterMode = 'READY';
        }



        const components = [];

        // Pumps (data[14]) - 2 bits per pump: 0=OFF, 1=LOW, 2=HIGH
        for (let i = 0; i < 4; i++) {
            let pumpState = 'OFF';
            const val = (data[14] >> (i * 2)) & 0x03;
            if (val === 1) pumpState = 'LOW';
            else if (val === 2) pumpState = 'HIGH';
            components.push({ componentType: 'PUMP', port: i.toString(), value: pumpState });
        }

        // Blower (data[16])
        let blowerState = 'OFF';
        const blowerByte = data[16] || 0;
        const blowerVal = (blowerByte >> 2) & 0x03;
        if (blowerVal === 1) blowerState = 'LOW';
        else if (blowerVal === 2) blowerState = 'MEDIUM';
        else if (blowerVal === 3) blowerState = 'HIGH';
        components.push({ componentType: 'BLOWER', port: '0', value: blowerState });

        // Lights (data[17])
        const light1 = (data[17] & 0x03) !== 0 ? 'HIGH' : 'OFF';
        components.push({ componentType: 'LIGHT', port: '0', value: light1 });

        // Heater
        components.push({ componentType: 'HEATER', value: isHeating ? 'ON' : 'OFF' });

        return {
            desiredTemp: targetTemperature,
            targetDesiredTemp: targetTemperature,
            currentTemp: actualTemperature,
            heaterMode: heaterMode,
            components: components,
            online: true,
            tempRange: temperatureRange,
            setupParams: {
                highRangeLow: 10,
                highRangeHigh: 40,
                lowRangeLow: 10,
                lowRangeHigh: 37
            },
            hour: data[5],
            minute: data[6],
            military: true,
            temperatureScale: temperatureScale
        };
    }

    // ==================== COMMAND METHODS ====================

    /**
     * Acquire command lock to prevent concurrent command sequences.
     * Commands that connect + read state + toggle must not overlap.
     */
    async _acquireCommandLock(timeoutMs = 20000) {
        const start = Date.now();
        while (this._commandLock) {
            if (Date.now() - start > timeoutMs) {
                throw new Error('Command lock timeout — another command is still in progress');
            }
            await new Promise(r => setTimeout(r, 200));
        }
        this._commandLock = true;
    }

    _releaseCommandLock() {
        this._commandLock = false;
    }

    async setJetState(port, state) {
        await this._acquireCommandLock();
        try {
            const freshState = await this.ensureState();
            const pump = freshState.components.find(c => c.componentType === 'PUMP' && c.port === port.toString());
            if (!pump) {
                console.warn(`[BalboaLocal] Pump ${port} not found in state`);
                return freshState;
            }

            const isCurrentlyOn = pump.value !== 'OFF';
            const targetOn = !!state;

            if (isCurrentlyOn !== targetOn) {
                console.log(`[BalboaLocal] Toggling Pump ${parseInt(port) + 1} to ${targetOn ? 'ON' : 'OFF'}`);
                const pumpCode = 0x04 + parseInt(port);
                await this._sendCommandAndVerify(
                    0x11, [pumpCode, 0x00],
                    (newState) => {
                        const newPump = newState.components.find(c => c.componentType === 'PUMP' && c.port === port.toString());
                        return newPump && (newPump.value !== 'OFF') === targetOn;
                    },
                    `Pump ${parseInt(port) + 1} to ${targetOn ? 'ON' : 'OFF'}`
                );
            } else {
                console.log(`[BalboaLocal] Pump ${parseInt(port) + 1} already ${targetOn ? 'ON' : 'OFF'}`);
            }
            return this.lastState;
        } finally {
            this._releaseCommandLock();
        }
    }

    async setLightState(port, state) {
        await this._acquireCommandLock();
        try {
            const freshState = await this.ensureState();
            const light = freshState.components.find(c => c.componentType === 'LIGHT' && c.port === port.toString());
            if (!light) {
                console.warn(`[BalboaLocal] Light ${port} not found in state`);
                return freshState;
            }

            const isCurrentlyOn = light.value !== 'OFF';
            const targetOn = !!state;

            if (isCurrentlyOn !== targetOn) {
                console.log(`[BalboaLocal] Toggling Light ${parseInt(port) + 1} to ${targetOn ? 'ON' : 'OFF'}`);
                await this._sendCommandAndVerify(
                    0x11, [0x11, 0x00],
                    (newState) => {
                        const newLight = newState.components.find(c => c.componentType === 'LIGHT' && c.port === port.toString());
                        return newLight && (newLight.value !== 'OFF') === targetOn;
                    },
                    `Light ${parseInt(port) + 1} to ${targetOn ? 'ON' : 'OFF'}`
                );
            } else {
                console.log(`[BalboaLocal] Light ${parseInt(port) + 1} already ${targetOn ? 'ON' : 'OFF'}`);
            }
            return this.lastState;
        } finally {
            this._releaseCommandLock();
        }
    }

    async setBlowerState(port, state) {
        await this._acquireCommandLock();
        try {
            const freshState = await this.ensureState();
            const blower = freshState.components.find(c => c.componentType === 'BLOWER');
            if (!blower) {
                console.warn(`[BalboaLocal] Blower not found in state`);
                return freshState;
            }

            const isCurrentlyOn = blower.value !== 'OFF';
            const targetOn = !!state;

            if (isCurrentlyOn !== targetOn) {
                console.log(`[BalboaLocal] Toggling Blower to ${targetOn ? 'ON' : 'OFF'}`);
                await this._sendCommandAndVerify(
                    0x11, [0x0c, 0x00],
                    (newState) => {
                        const newBlower = newState.components.find(c => c.componentType === 'BLOWER');
                        return newBlower && (newBlower.value !== 'OFF') === targetOn;
                    },
                    `Blower to ${targetOn ? 'ON' : 'OFF'}`
                );
            } else {
                console.log(`[BalboaLocal] Blower already ${targetOn ? 'ON' : 'OFF'}`);
            }
            return this.lastState;
        } finally {
            this._releaseCommandLock();
        }
    }

    async setTemp(tempCelsius) {
        await this._acquireCommandLock();
        try {
            const freshState = await this.ensureState();
            const temperatureScale = freshState.temperatureScale || 'F';
            const { setupParams, tempRange: stateRange } = freshState;
            
            // Use intended range if we just set it, to prevent race conditions
            const tempRange = this._intendedTempRange || stateRange;

            let val;
            let displayTemp;

            if (temperatureScale === 'C') {
                // If we have setupParams (local mode), respect the current range limits
                if (setupParams) {
                    const isHigh = tempRange.toUpperCase() === 'HIGH';
                    const minLimit = isHigh ? setupParams.highRangeLow : setupParams.lowRangeLow;
                    const maxLimit = isHigh ? setupParams.highRangeHigh : setupParams.lowRangeHigh;
                    tempCelsius = Math.min(maxLimit, Math.max(minLimit, tempCelsius));
                }
                val = Math.round(tempCelsius * 2);
                displayTemp = `${tempCelsius}°C`;
            } else {
                val = Math.round((tempCelsius * 9 / 5) + 32);
                displayTemp = `${val}°F`;
            }

            console.log(`[BalboaLocal] Setting temperature to ${displayTemp} (Payload: ${val})`);
            await this._sendCommandAndVerify(
                0x20, [val],
                (newState) => {
                    const expectedTemp = temperatureScale === 'C' ? tempCelsius : val;
                    const actualTarget = newState.desiredTemp;
                    return Math.abs(actualTarget - expectedTemp) < 0.6;
                },
                `Temperature to ${displayTemp}`
            );
            return this.lastState;
        } finally {
            this._releaseCommandLock();
        }
    }

    async setHeaterMode(mode) {
        await this._acquireCommandLock();
        try {
            // CRITICAL FIX: Get fresh state FIRST so we never silently drop the command
            const freshState = await this.ensureState();
            const currentMode = freshState.heaterMode;

            if (currentMode === mode) {
                console.log(`[BalboaLocal] Heater mode already ${mode}, no action needed`);
                return this.lastState;
            }

            console.log(`[BalboaLocal] Toggling Heater Mode from ${currentMode} to ${mode}`);
            await this._sendCommandAndVerify(
                0x11, [0x51, 0x00],
                (newState) => newState.heaterMode === mode,
                `Heater Mode to ${mode}`
            );

            // When switching TO Ready mode, the temperature sensor takes time to wake up.
            // Schedule extra status polls at 60s and 120s to capture the real temperature
            // as soon as the heater brings the sensor back online.
            if (mode === 'READY') {
                console.log(`[BalboaLocal] Scheduling temperature refresh polls after switching to READY...`);
                [60000, 120000, 180000, 300000].forEach(delay => {
                    setTimeout(async () => {
                        if (!this._commandLock) {
                            try {
                                console.log(`[BalboaLocal] Post-READY temperature poll (${delay / 1000}s)...`);
                                await this.ensureState();
                            } catch (err) {
                                console.warn(`[BalboaLocal] Post-READY temperature poll failed: ${err.message}`);
                            }
                        }
                    }, delay);
                });
            }

            return this.lastState;
        } finally {
            this._releaseCommandLock();
        }
    }

    async setTempRange(range) {
        // Normalize: Homey passes true/false, internal state uses 'HIGH'/'LOW'
        const targetRange = (range === true || range === 'HIGH') ? 'HIGH' : 'LOW';

        await this._acquireCommandLock();
        try {
            const freshState = await this.ensureState();
            const currentRange = freshState.tempRange;

            if (currentRange === targetRange) {
                console.log(`[BalboaLocal] Temp range already ${targetRange}, no action needed`);
                return this.lastState;
            }

            console.log(`[BalboaLocal] Toggling Temperature Range from ${currentRange} to ${targetRange}`);
            
            // Set intended range to prevent race conditions in setTemp
            this._intendedTempRange = targetRange;

            await this._sendCommandAndVerify(
                0x11, [0x50, 0x00],
                (newState) => {
                    const match = newState.tempRange === targetRange;
                    if (match) this._intendedTempRange = null;
                    return match;
                },
                `Temp Range to ${targetRange}`
            );
            return this.lastState;
        } finally {
            this._releaseCommandLock();
        }
    }

    sendConfigCommand() {
        this._writeRaw(0x04, []);
    }

    // ==================== SEND + VERIFY ====================

    /**
     * Send a command and verify it took effect. Retry once on failure.
     * @param {number} type - Command type byte
     * @param {number[]} payload - Command payload
     * @param {function} verifyFn - Function that takes new state and returns true if command worked
     * @param {string} description - Human-readable description for logging
     */
    async _sendCommandAndVerify(type, payload, verifyFn, description) {
        this.pendingCommand = true;
        // Reset disconnect timer while commanding
        if (this.disconnectTimeout) {
            clearTimeout(this.disconnectTimeout);
            this.disconnectTimeout = null;
        }

        try {
            // Attempt 1
            this._writeRaw(type, payload);

            // Request status to verify
            await new Promise(r => setTimeout(r, 1000)); // Give spa time to process
            this._writeRaw(0x12, []); // Request status
            const state1 = await this._waitForStatus(5000);

            if (state1 && verifyFn(state1)) {
                console.log(`[BalboaLocal] ✓ Command verified: ${description}`);
                return;
            }

            // Attempt 2 (retry)
            console.warn(`[BalboaLocal] ⚠ Command not verified, retrying: ${description}`);
            this._writeRaw(type, payload);

            await new Promise(r => setTimeout(r, 1500));
            this._writeRaw(0x12, []);
            const state2 = await this._waitForStatus(5000);

            if (state2 && verifyFn(state2)) {
                console.log(`[BalboaLocal] ✓ Command verified on retry: ${description}`);
                return;
            }

            console.error(`[BalboaLocal] ✗ Command FAILED after retry: ${description}`);
            this.emit('commandFailed', { description, type, payload });
        } finally {
            this.pendingCommand = false;
            // Schedule disconnect now that command sequence is done
            this._scheduleDisconnect();
        }
    }

    /**
     * Low-level: write a raw Balboa command to the TCP socket.
     * Does NOT manage connection — caller must ensure connected.
     */
    _writeRaw(type, payload = []) {
        if (!this.client || !this.connected) {
            console.error(`[BalboaLocal] _writeRaw called but not connected!`);
            return;
        }

        const payloadBuffer = Buffer.from(payload);
        const len = payloadBuffer.length + 5;
        const message = Buffer.alloc(len + 2);

        message[0] = 0x7E;
        message[1] = len;
        message[2] = 0x0A;
        message[3] = 0xBF;
        message[4] = type;
        payloadBuffer.copy(message, 5);

        message[len] = this._calculateCRC(message.slice(1, len));
        message[len + 1] = 0x7E;

        this.client.write(message);
    }

    /**
     * Legacy sendCommand — now uses ensureConnected + _writeRaw.
     * Kept for backwards compatibility.
     */
    async sendCommand(type, payload = []) {
        this.pendingCommand = true;
        if (this.disconnectTimeout) {
            clearTimeout(this.disconnectTimeout);
            this.disconnectTimeout = null;
        }

        if (!this.client || !this.connected) {
            try {
                await this.ensureConnected();
            } catch (err) {
                console.error(`[BalboaLocal] Failed to connect for command: ${err.message}`);
                this.pendingCommand = false;
                return;
            }
        }

        this._writeRaw(type, payload);

        // Allow disconnect after command confirmation
        setTimeout(() => {
            this.pendingCommand = false;
            this._scheduleDisconnect();
        }, 3000);
    }

    _calculateCRC(data) {
        let crc = 0x02;
        for (let i = 0; i < data.length; i++) {
            crc = this._crcTable[crc ^ data[i]];
        }
        return crc ^ 0x02;
    }

    get _crcTable() {
        return [
            0x00, 0x07, 0x0e, 0x09, 0x1c, 0x1b, 0x12, 0x15, 0x38, 0x3f, 0x36, 0x31, 0x24, 0x23, 0x2a, 0x2d,
            0x70, 0x77, 0x7e, 0x79, 0x6c, 0x6b, 0x62, 0x65, 0x48, 0x4f, 0x46, 0x41, 0x54, 0x53, 0x5a, 0x5d,
            0xe0, 0xe7, 0xee, 0xe9, 0xfc, 0xfb, 0xf2, 0xf5, 0xd8, 0xdf, 0xd6, 0xd1, 0xc4, 0xc3, 0xca, 0xcd,
            0x90, 0x97, 0x9e, 0x99, 0x8c, 0x8b, 0x82, 0x85, 0xa8, 0xaf, 0xa6, 0xa1, 0xb4, 0xb3, 0xba, 0xbd,
            0xc7, 0xc0, 0xc9, 0xce, 0xdb, 0xdc, 0xd5, 0xd2, 0xff, 0xf8, 0xf1, 0xf6, 0xe3, 0xe4, 0xed, 0xea,
            0xb7, 0xb0, 0xb9, 0xbe, 0xab, 0xac, 0xa5, 0xa2, 0x8f, 0x88, 0x81, 0x86, 0x93, 0x94, 0x9d, 0x9a,
            0x27, 0x20, 0x29, 0x2e, 0x3b, 0x3c, 0x35, 0x32, 0x1f, 0x18, 0x11, 0x16, 0x03, 0x04, 0x0d, 0x0a,
            0x57, 0x50, 0x59, 0x5e, 0x4b, 0x4c, 0x45, 0x42, 0x6f, 0x68, 0x61, 0x66, 0x73, 0x74, 0x7d, 0x7a,
            0x89, 0x8e, 0x87, 0x80, 0x95, 0x92, 0x9b, 0x9c, 0xb1, 0xb6, 0xbf, 0xb8, 0xad, 0xaa, 0xa3, 0xa4,
            0xf9, 0xfe, 0xf7, 0xf0, 0xe5, 0xe2, 0xeb, 0xec, 0xc1, 0xc6, 0xcf, 0xc8, 0xdd, 0xda, 0xd3, 0xd4,
            0x69, 0x6e, 0x67, 0x60, 0x75, 0x72, 0x7b, 0x7c, 0x51, 0x56, 0x5f, 0x58, 0x4d, 0x4a, 0x43, 0x44,
            0x19, 0x1e, 0x17, 0x10, 0x05, 0x02, 0x0b, 0x0c, 0x21, 0x26, 0x2f, 0x28, 0x3d, 0x3a, 0x33, 0x34,
            0x4e, 0x49, 0x40, 0x47, 0x52, 0x55, 0x5c, 0x5b, 0x76, 0x71, 0x78, 0x7f, 0x6a, 0x6d, 0x64, 0x63,
            0x3e, 0x39, 0x30, 0x37, 0x22, 0x25, 0x2c, 0x2b, 0x06, 0x01, 0x08, 0x0f, 0x1a, 0x1d, 0x14, 0x13,
            0xae, 0xa9, 0xa0, 0xa7, 0xb2, 0xb5, 0xbc, 0xbb, 0x96, 0x91, 0x98, 0x9f, 0x8a, 0x8d, 0x84, 0x83,
            0xde, 0xd9, 0xd0, 0xd7, 0xc2, 0xc5, 0xcc, 0xcb, 0xe6, 0xe1, 0xe8, 0xef, 0xfa, 0xfd, 0xf4, 0xf3
        ];
    }

    /**
     * Static method to discover Balboa spas on the local network.
     * Uses hintIp to derive the correct subnet (important when running inside Docker).
     * Falls back to os.networkInterfaces() and common home subnets.
     * @param {number} timeout - Discovery timeout in ms
     * @param {string} hintIp - Last known IP of the spa, used to derive subnet
     * @returns {Promise<string[]>} - Array of discovered IP addresses
     */
    static async discover(timeout = 5000, hintIp = null) {
        const foundIps = [];
        const scanPromises = [];
        const scannedSubnets = new Set();

        // Helper to scan a single subnet
        const scanSubnet = (subnet) => {
            if (scannedSubnets.has(subnet)) return;
            scannedSubnets.add(subnet);
            console.log(`[BalboaLocal] Scanning subnet ${subnet}.x for Balboa spas...`);

            for (let i = 1; i <= 254; i++) {
                const ip = `${subnet}.${i}`;
                scanPromises.push(
                    BalboaLocal._checkHost(ip, 4257, Math.min(timeout, 3000))
                        .then(reachable => {
                            if (reachable) {
                                console.log(`[BalboaLocal] Found spa at ${ip}`);
                                foundIps.push(ip);
                            }
                        })
                        .catch(() => { })
                );
            }
        };

        // Priority 1: Scan the subnet derived from the hint IP (last known spa address)
        if (hintIp) {
            const parts = hintIp.split('.');
            if (parts.length === 4) {
                scanSubnet(`${parts[0]}.${parts[1]}.${parts[2]}`);
            }
        }

        // Priority 2: Scan subnets from local network interfaces (may be Docker bridge)
        try {
            const os = require('os');
            const interfaces = os.networkInterfaces();
            for (const name of Object.keys(interfaces)) {
                for (const iface of interfaces[name]) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        const parts = iface.address.split('.');
                        scanSubnet(`${parts[0]}.${parts[1]}.${parts[2]}`);
                    }
                }
            }
        } catch (err) {
            console.warn(`[BalboaLocal] Could not read network interfaces: ${err.message}`);
        }

        // Priority 3: Common home network subnets as fallback
        scanSubnet('192.168.1');
        scanSubnet('192.168.0');
        scanSubnet('10.0.0');

        await Promise.race([
            Promise.all(scanPromises),
            new Promise(resolve => setTimeout(resolve, timeout))
        ]);

        return foundIps;
    }

    static _checkHost(host, port, timeout) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            let resolved = false;

            socket.setTimeout(timeout);

            socket.on('connect', () => {
                resolved = true;
                socket.destroy();
                resolve(true);
            });

            socket.on('timeout', () => {
                if (!resolved) {
                    socket.destroy();
                    resolve(false);
                }
            });

            socket.on('error', () => {
                if (!resolved) {
                    socket.destroy();
                    resolve(false);
                }
            });

            socket.connect(port, host);
        });
    }
}

module.exports = BalboaLocal;
