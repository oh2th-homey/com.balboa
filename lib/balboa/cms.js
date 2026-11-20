// This code is a derivative work based on an original project licensed under the MIT License.
// Original source: https://gitlab.com/VVlasy/controlmyspajs
// Copyright (c) [Victor Vlasák]
// Licensed under the MIT License. See LICENSE file for details.

// Add configuration variable for API host
const CMS_API_HOST = 'controlmyspa.com';

// Give up on a request that gets no answer within this time.
const REQUEST_TIMEOUT_MS = 30000;

// After a failed login, wait before the next attempt: 1 min, doubling up to 60 min.
const LOGIN_RETRY_MIN_MS = 60 * 1000;
const LOGIN_RETRY_MAX_MS = 60 * 60 * 1000;

// After a command, wait this long before reading the spa back.
const COMMAND_SETTLE_MS = 5000;

class ControlMySpa {
    constructor(email, password, spaId = null) {
        this.email = email;
        this.password = password;
        this.spaId = spaId;
        this.tokenData = null;
        this.userInfo = null;
        this.currentSpa = null;
        this.waitForResult = true;
        this.scheduleFilterIntervalEnum = null;
        this.createFilterScheduleIntervals();

        this.apiHost = CMS_API_HOST;

        // Why the last login failed: { status, message }, status is null for network errors. null after a successful login.
        this.loginError = null;
        this.loginRetryDelay = 0;
        this.loginRetryAt = 0;
    }

    /**
     * True when the last login was rejected by ControlMySpa (wrong email or password, or no such account).
     */
    get credentialsRejected() {
        return this.loginError?.status === 401 || this.loginError?.status === 403;
    }

    /**
     * Logs in when there is no valid token, but not more often than the retry delay after a failed login allows.
     * @returns {Promise<boolean>} - true when there is a valid token.
     */
    async ensureLogin() {
        if (this.isLoggedIn()) return true;
        if (Date.now() < this.loginRetryAt) return false;
        return this.login();
    }

    /**
     * Sends a request to the ControlMySpa API.
     * Errors only carry a short message: never log the request itself, its body holds the credentials at login.
     * @param {string} method - HTTP method.
     * @param {string} path - Path below the API host, starting with a slash.
     * @param {Object} [options]
     * @param {Object} [options.body] - Sent as JSON.
     * @param {boolean} [options.auth=true] - Send the bearer token.
     * @returns {Promise<{status: number, data: Object}>} - The HTTP status and the parsed JSON body ({} if there is none).
     */
    async request(method, path, { body, auth = true } = {}) {
        const headers = { ...this.getCommonHeaders() };
        if (auth) {
            if (!this.tokenData?.access_token) throw new Error('not logged in');
            headers.Authorization = 'Bearer ' + this.tokenData.access_token;
        }
        if (body !== undefined) headers['Content-Type'] = 'application/json';

        let res;
        try {
            res = await fetch(`https://${this.apiHost}${path}`, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            });
        } catch (error) {
            throw new Error(`${method} ${path} failed: ${error.cause?.code || error.message}`);
        }

        // A rejected token: drop it, so the next call logs in again.
        if (auth && res.status === 401) this.tokenData = null;

        const text = await res.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = { message: text.slice(0, 200) };
        }
        return { status: res.status, data };
    }

    /**
     * Constructs the currentState object from the API response.
     * @param {Object} spaData - The data object from the API response.
     * @returns {Object} - The constructed currentState object.
     */
    constructCurrentState(spaData) {
        // Ensure components array exists
        const components = spaData.components || [];

        // Check if HEATER component exists, and add a default one if missing
        // This is a workaround for the issue where HEATER component is not present in the response.
        // We assume the HEATER component is OFF when not present.
        const heaterExists = components.some((component) => component.componentType === 'HEATER');
        if (!heaterExists) {
            components.push({
                componentId: null,
                serialNumber: spaData.serialNumber || null,
                alertState: null,
                materialType: null,
                targetValue: null,
                name: 'HEATER',
                componentType: 'HEATER',
                value: 'OFF', // Default value for missing HEATER component
                availableValues: ['OFF', 'ON'],
                registeredTimestamp: new Date().toISOString(),
                port: null,
                hour: null,
                minute: null,
                durationMinutes: null
            });
        }

        return {
            desiredTemp: parseFloat(spaData.desiredTemp),
            targetDesiredTemp: parseFloat(spaData.desiredTemp), // Assuming targetDesiredTemp is the same as desiredTemp
            currentTemp: parseFloat(spaData.currentTemp),
            panelLock: spaData.isPanelLocked,
            heaterMode: spaData.heaterMode,
            components: components, // Updated components array
            online: spaData.isOnline,
            tempRange: spaData.tempRange,
            setupParams: {
                highRangeLow: spaData.rangeLimits.highRangeLow,
                highRangeHigh: spaData.rangeLimits.highRangeHigh,
                lowRangeLow: spaData.rangeLimits.lowRangeLow,
                lowRangeHigh: spaData.rangeLimits.lowRangeHigh
            },
            hour: spaData.time ? parseInt(spaData.time.split(':')[0], 10) : null,
            minute: spaData.time ? parseInt(spaData.time.split(':')[1], 10) : null,
            timeNotSet: !spaData.time,
            military: spaData.isMilitaryTime
        };
    }

    getCommonHeaders() {
        return {
            Accept: '*/*',
            'Accept-Language': 'en-GB,en;q=0.9',
            'User-Agent': 'cms/34 CFNetwork/3826.500.111.2.2 Darwin/24.4.0'
        };
    }

    async init() {
        return (await this.login()) && (await this.getSpas());
    }

    async deviceInit() {
        return (await this.login());
    }

    isLoggedIn() {
        return !!this.tokenData?.access_token && this.tokenData.timestamp + this.tokenData.expires_in * 1000 > Date.now();
    }

    /**
     * Logs in. Never throws: the reason of a failure is kept in `loginError`.
     * @returns {Promise<boolean>} - true on success.
     */
    async login() {
        try {
            const req = await this.request('POST', '/auth/login', {
                body: { email: this.email, password: this.password },
                auth: false
            });

            if (req.status === 200 && req.data?.data?.accessToken) {
                this.tokenData = {
                    access_token: req.data.data.accessToken,
                    timestamp: Date.now(),
                    expires_in: 3600
                };
                this.loginError = null;
                this.loginRetryDelay = 0;
                this.loginRetryAt = 0;
                return true;
            }

            this.loginFailed(req.status, req.data?.message);
            return false;
        } catch (error) {
            this.loginFailed(null, error.message);
            return false;
        }
    }

    loginFailed(status, message) {
        this.tokenData = null;
        this.loginError = { status, message: message || null };
        this.loginRetryDelay = Math.min(Math.max(this.loginRetryDelay * 2, LOGIN_RETRY_MIN_MS), LOGIN_RETRY_MAX_MS);
        this.loginRetryAt = Date.now() + this.loginRetryDelay;
    }

    /**
     * Makes sure there is a valid token.
     * @throws {Error} - When not logged in, with the reason of the last failed login.
     */
    async requireLogin() {
        if (await this.ensureLogin()) return;
        const { status, message } = this.loginError || {};
        const reason = [status && `[${status}]`, message].filter(Boolean).join(' ') || 'login failed';
        throw new Error(`Not logged in to ControlMySpa: ${reason}`);
    }

    /**
     * Builds the error for a request ControlMySpa did not accept.
     * @param {string} what - What was being done, for example "Setting the temperature".
     * @param {{status: number, data: Object}} req - The response.
     */
    requestError(what, req) {
        return new Error(`${what} failed: [${req.status}] ${req.data?.message || 'no message from ControlMySpa'}`);
    }

    /**
     * Sends a spa command, then waits and reads the spa state back.
     * @param {string} what - What the command does, used in error messages.
     * @param {string} path - The command's path.
     * @param {Object} body - The command's payload.
     * @param {Object} [options]
     * @param {boolean} [options.refresh=true] - Wait and return the spa state; when false, returns true.
     * @param {boolean} [options.requireData=false] - The response must carry a data object to count as accepted.
     * @param {Function} [options.check] - Called with the spa state; returns null when the change shows,
     *   or a message saying how it does not. Checked again after another wait before failing.
     * @returns {Promise<Object|boolean>} - The spa state, or true when refresh is false.
     * @throws {Error} - When not logged in, the request fails, or the spa does not report the change.
     */
    async command(what, path, body, { refresh = true, requireData = false, check = null } = {}) {
        await this.requireLogin();

        const req = await this.request('POST', path, { body });
        if (req.status !== 200 || (requireData && !req.data?.data)) throw this.requestError(what, req);
        if (!refresh) return true;

        await this.sleep(COMMAND_SETTLE_MS);
        let state = await this.getSpa();
        if (!check) return state;

        let mismatch = check(state);
        if (mismatch) {
            // The spa may report late: read once more before failing.
            await this.sleep(COMMAND_SETTLE_MS);
            state = await this.getSpa();
            mismatch = check(state);
        }
        if (mismatch) throw new Error(mismatch);
        return state;
    }

    /**
     * Retrieves the owned spas.
     * @returns {Promise<Object[]>} - Array of spa objects.
     * @throws {Error} - When not logged in or the request fails.
     */
    async getSpas() {
        await this.requireLogin();

        const req = await this.request('GET', `/spas/owned`);
        if (req.status === 200 && req.data?.data?.spas) return req.data.data.spas;

        throw this.requestError('Reading the spas', req);
    }

    /**
     * Retrieves the spa's current state.
     * @returns {Promise<Object>} - The currentState object.
     * @throws {Error} - When not logged in or the request fails.
     */
    async getSpa() {
        await this.requireLogin();

        const req = await this.request('GET', `/spas/${this.spaId}/dashboard`);
        if (req.status === 200 && req.data?.data) return this.constructCurrentState(req.data.data);

        throw this.requestError('Reading the spa', req);
    }

    /**
     * Sets the spa clock.
     * @returns {Promise<boolean>} - true when ControlMySpa accepted it.
     */
    async setTime(date, time, military_format = true) {
        const payload = {
            isMilitaryFormat: military_format,
            via: 'MOBILE',
            date,
            time,
            spaId: this.spaId
        };

        return this.command('Setting the spa clock', `/spa-commands/time`, payload, { refresh: false });
    }

    /**
     * Sets the temperature and returns the updated currentState.
     * @param {number} temp - The desired temperature to set.
     * @returns {Promise<Object>} - The updated currentState object.
     */
    async setTemp(temp) {
        const payload = {
            spaId: this.spaId,
            via: 'MOBILE',
            value: temp
        };

        return this.command('Setting the temperature', `/spa-commands/temperature/value`, payload);
    }

    async setTempRangeHigh() {
        return this.setTempRange(true);
    }

    async setTempRangeLow() {
        return this.setTempRange(false);
    }

    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Sets the temperature range and returns the updated currentState.
     * @param {boolean} high - Whether to set the range to HIGH.
     * @returns {Promise<Object>} - The updated currentState object.
     */
    async setTempRange(high) {
        const payload = {
            spaId: this.spaId,
            via: 'MOBILE',
            range: high ? 'HIGH' : 'LOW'
        };

        return this.command('Setting the temperature range', `/spa-commands/temperature/range`, payload);
    }

    async lockPanel() {
        return this.setPanelLock(true);
    }

    async unlockPanel() {
        return this.setPanelLock(false);
    }

    async setPanelLock(locked) {
        const payload = {
            spaId: this.spaId,
            via: 'MOBILE',
            state: locked ? 'LOCK_PANEL' : 'UNLOCK_PANEL'
        };

        return this.command(locked ? 'Locking the panel' : 'Unlocking the panel', `/spa-commands/panel/state`, payload);
    }

    async setLightState(deviceNumber, desiredState) {
        return this.setComponentState(deviceNumber, desiredState, 'light');
    }

    async setJetState(deviceNumber, desiredState) {
        return this.setComponentState(deviceNumber, desiredState, 'jet');
    }

    async setBlowerState(deviceNumber, desiredState) {
        return this.setComponentState(deviceNumber, desiredState, 'blower');
    }

    async setComponentState(deviceNumber, desiredState, componentType) {
        const payload = {
            deviceNumber,
            state: desiredState,
            spaId: this.spaId,
            via: 'MOBILE',
            componentType
        };

        return this.command(`Setting ${componentType} ${deviceNumber + 1} to ${desiredState}`, `/spa-commands/component-state`, payload);
    }

    async setHeaterMode(mode) {
        const payload = {
            spaId: this.spaId,
            via: 'MOBILE',
            mode
        };

        return this.command(`Setting the heater mode to ${mode}`, `/spa-commands/temperature/heater-mode`, payload, { requireData: true });
    }

    /**
     * Sets the start time and length of a filter cycle, and checks that the spa reports them.
     * This does not enable or disable filter cycle 2: use setFilter2State() for that.
     * @param {number} deviceNumber - 0 for filter cycle 1, 1 for filter cycle 2.
     * @param {number} numOfIntervals - Length in 15-minute intervals (1-96).
     * @param {string} time - Start time as HH:mm.
     * @param {Object} [options]
     * @param {boolean} [options.refresh=true] - Wait, check and return the spa state; when false, returns true
     *   without checking (check with setFilter2State() instead).
     * @returns {Promise<Object|boolean>} - The spa state (or true).
     */
    async setFilterCycle(deviceNumber, numOfIntervals, time, { refresh = true } = {}) {
        const payload = {
            spaId: this.spaId,
            via: 'MOBILE',
            deviceNumber,
            numOfIntervals,
            time
        };

        return this.command(`Setting filter cycle ${deviceNumber + 1}`, `/spa-commands/filter-cycles/schedule`, payload, {
            refresh,
            check: (state) => this.filterMismatch(state, deviceNumber, { numOfIntervals, time })
        });
    }

    /**
     * Enables or disables filter cycle 2, and checks that the spa reports it. Its schedule is kept while it is disabled.
     * Despite the endpoint's name this is a setter: `state` is the wanted state.
     * @param {boolean} enabled - true to enable filter cycle 2, false to disable it.
     * @param {Object} [schedule] - A schedule just sent with setFilterCycle(1, …, { refresh: false }), to check as well.
     * @param {number} [schedule.numOfIntervals]
     * @param {string} [schedule.time]
     * @returns {Promise<Object>} - The spa state.
     */
    async setFilter2State(enabled, schedule = {}) {
        const payload = {
            spaId: this.spaId,
            state: enabled ? 'ON' : 'OFF',
            via: 'MOBILE'
        };

        return this.command(`Turning filter cycle 2 ${enabled ? 'on' : 'off'}`, `/spa-commands/filter-cycles/toggle-filter2-state`, payload, {
            check: (state) => this.filterMismatch(state, 1, { ...schedule, enabled })
        });
    }

    /**
     * Compares a filter cycle in the spa state with the requested change.
     * @param {Object} state - The spa state from getSpa().
     * @param {number} deviceNumber - 0 for filter cycle 1, 1 for filter cycle 2.
     * @param {Object} expected - Only the given fields are compared.
     * @param {number} [expected.numOfIntervals] - Length in 15-minute intervals.
     * @param {string} [expected.time] - Start time as HH:mm.
     * @param {boolean} [expected.enabled] - Whether the cycle is enabled (filter cycle 2).
     * @returns {string|null} - null when the spa reports the change, otherwise what it reports.
     */
    filterMismatch(state, deviceNumber, { numOfIntervals, time, enabled } = {}) {
        const name = `Filter cycle ${deviceNumber + 1}`;
        const filter = state.components.find((c) => c.componentType === 'FILTER' && String(c.port) === String(deviceNumber));
        if (!filter) return `${name} was not changed: the spa does not report it`;

        // The dashboard leaves out minute when it is 0.
        const hour = Number(filter.hour);
        const minute = Number(filter.minute ?? 0);
        const duration = Number(filter.durationMinutes);

        let matches = true;
        if (time !== undefined) {
            const [h, m] = time.split(':').map(Number);
            if (hour !== h || minute !== m) matches = false;
        }
        if (numOfIntervals !== undefined && duration !== numOfIntervals * 15) matches = false;
        if (enabled !== undefined && (filter.value !== 'DISABLED') !== enabled) matches = false;
        if (matches) return null;

        const start = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        return `${name} was not changed (spa reports ${filter.value} ${start}, ${duration} min)`;
    }

    // This is not in use anywhere and possibly not needed // Noted on 2025-05-01 by Tapio
    createFilterScheduleIntervals() {
        /**
         * Builds an enum-style object mapping time intervals from 15 minutes up to 24 hours
         * into unique integer values. The structure looks like this:
         *
         * {
         *   idisabled: 0,
         *   i15minutes: 1,
         *   i30minutes: 2,
         *   i45minutes: 3,
         *   i1hour: 4,
         *   i1hour15minutes: 5,
         *   ...
         *   i23hours45minutes: 95,
         *   i24hours: 96
         * }
         *
         */
        const intervals = { idisabled: 0 };
        let index = 1;

        for (let hours = 0; hours <= 24; hours++) {
            for (let minutes of [0, 15, 30, 45]) {
                if (hours === 0 && minutes === 0) continue; // already covered by idisabled
                if (hours === 24 && minutes > 0) continue; // skip invalid intervals beyond 24h

                const label = 'i' + (hours > 0 ? `${hours}hour${hours > 1 ? 's' : ''}` : '') + (minutes > 0 ? `${hours > 0 ? '' : ''}${minutes}minutes` : '');

                intervals[label] = index++;
            }
        }

        this.scheduleFilterIntervalEnum = Object.freeze(intervals);
    }
}

module.exports = ControlMySpa;
