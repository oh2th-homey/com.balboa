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

    async login() {
        try {
            const req = await this.request('POST', '/auth/login', {
                body: { email: this.email, password: this.password },
                auth: false
            });

            console.log(`login Response [${req.status}] ${req.data.message}`);

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
            console.error('Login Error:', error.message);
            this.loginFailed(null, error.message);
            return false;
        }
    }

    loginFailed(status, message) {
        this.tokenData = null;
        this.loginError = { status, message: message || null };
        this.loginRetryDelay = Math.min(Math.max(this.loginRetryDelay * 2, LOGIN_RETRY_MIN_MS), LOGIN_RETRY_MAX_MS);
        this.loginRetryAt = Date.now() + this.loginRetryDelay;
        console.error(`failed to login, next attempt in ${this.loginRetryDelay / 60000} min`);
    }

    //async getWhoAmI() {
    //    try {
    //        const req = await this.instance.get('https://production.controlmyspa.net/user-management/profile', {
    //            headers: this.getAuthHeaders()
    //        });

    //        console.log(`getWhoAmI Response [${req.status}] ${req.data.message}`);

    //        if (req.status === 200 && req.data?.data?.user) {
    //            this.userInfo = req.data.data.user;
    //            this.spaId = this.userInfo.spaId;
    //            return this.userInfo;
    //        }

    //        console.error('failed to get WhoAmI');
    //        return false;
    //    } catch (error) {
    //        console.error('GetWhoAmI Error:', error);
    //    }
    //}

    /**
     * Retrieved owned spas
     * @return {Object[]|null} - Array of spa objects or null if the request fails.
     */
    async getSpas() {
        try {
            if (!(await this.ensureLogin())) return null;

            const req = await this.request('GET', `/spas/owned`);

            console.log(`getSpas Response [${req.status}] ${req.data.message}`);

            if (req.status === 200 && req.data?.data?.spas) {
                return req.data.data.spas;
            }

            console.error('failed to get spas');
            return null;
        } catch (error) {
            console.error('GetSpas Error:', error.message);
            return null;
        }
    }

    /**
     * Retrieves the spa's current state.
     * @returns {Object|null} - The currentState object or null if the request fails.
     */
    async getSpa() {
        try {
            if (!(await this.ensureLogin())) return null;

            const req = await this.request('GET', `/spas/${this.spaId}/dashboard`);

            console.log(`getSpa Response [${req.status}] ${req.data.message}`);

            if (req.status === 200 && req.data?.data) {
                const currentState = this.constructCurrentState(req.data.data);
                return currentState;
            }

            console.error('Failed to get spa dashboard');
            return null;
        } catch (error) {
            console.error('GetSpa Error:', error.message);
            return null;
        }
    }

    async setTime(date, time, military_format = true) {
        try {
            if (!(await this.ensureLogin())) return null;

            const payload = {
                isMilitaryFormat: military_format,
                via: 'MOBILE',
                date,
                time,
                spaId: this.spaId
            };

            const req = await this.request('POST', `/spa-commands/time`, { body: payload });

            console.log(`setTime Response [${req.status}] ${req.data.message}`);

            if (req.status === 200) {
                await this.sleep(5000); // Wait for 5 seconds to allow server to update
                const currentState = await this.getSpa();
                return currentState;
            }

            console.error('Failed to get spa dashboard');
            return null;
        } catch (error) {
            console.error('GetTime Error:', error.message);
            return null;
        }
    }

    /**
     * Sets the temperature and returns the updated currentState.
     * @param {number} temp - The desired temperature to set.
     * @returns {Object|null} - The updated currentState object or null if the request fails.
     */
    async setTemp(temp) {
        try {
            if (!(await this.ensureLogin())) return null;

            const payload = {
                spaId: this.spaId,
                via: 'MOBILE',
                value: temp
            };

            const req = await this.request('POST', `/spa-commands/temperature/value`, { body: payload });

            console.log(`setTemp Response [${req.status}] ${req.data.message}`);

            if (req.status === 200) {
                await this.sleep(5000); // Wait for 5 seconds to allow server to update
                const currentState = await this.getSpa();
                return currentState;
            }

            console.error('Failed to set temperature');
            return null;
        } catch (error) {
            console.error('SetTemp Error:', error.message);
            return null;
        }
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
     * @returns {Object|null} - The updated currentState object or null if the request fails.
     */
    async setTempRange(high) {
        try {
            if (!(await this.ensureLogin())) return null;

            const payload = {
                spaId: this.spaId,
                via: 'MOBILE',
                range: high ? 'HIGH' : 'LOW'
            };

            const req = await this.request('POST', `/spa-commands/temperature/range`, { body: payload });

            console.log(`setTempRange Response [${req.status}] ${req.data.message}`);

            if (req.status === 200) {
                await this.sleep(5000); // Wait for 5 seconds to allow server to update
                const currentState = await this.getSpa();
                return currentState;
            }

            console.error('Failed to set temperature range');
            return null;
        } catch (error) {
            console.error('SetTempRange Error:', error.message);
            return null;
        }
    }

    async lockPanel() {
        return this.setPanelLock(true);
    }

    async unlockPanel() {
        return this.setPanelLock(false);
    }

    async setPanelLock(locked) {
        try {
            if (!(await this.ensureLogin())) return null;

            const panelData = {
                spaId: this.spaId,
                via: 'MOBILE',
                state: locked ? 'LOCK_PANEL' : 'UNLOCK_PANEL'
            };

            const req = await this.request('POST', `/spa-commands/panel/state`, { body: panelData });

            console.log(`setPanelLock Response [${req.status}] ${req.data.message}`);

            if (req.status === 200) {
                await this.sleep(5000); // Wait for 5 seconds to allow server to update
                const currentState = await this.getSpa();
                return currentState;
            }

            console.error('Failed to set panel lock state');
            return null;
        } catch (error) {
            console.error('setPanelLock Error:', error.message);
            return null;
        }
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
        try {
            if (!(await this.ensureLogin())) return null;

            const payload = {
                deviceNumber,
                state: desiredState,
                spaId: this.spaId,
                via: 'MOBILE',
                componentType
            };

            const req = await this.request('POST', `/spa-commands/component-state`, { body: payload });

            console.log(`setComponentState ${componentType} Response [${req.status}] ${req.data.message}`);

            if (req.status === 200) {
                await this.sleep(5000); // Wait for 5 seconds to allow server to update
                const currentState = await this.getSpa();
                return currentState;
            }

            console.error(`Failed to set component ${componentType} state to ${desiredState}`);
            return null;
        } catch (error) {
            console.error('setComponentState Error:', error.message);
            return null;
        }
    }

    async setHeaterMode(mode) {
        try {
            if (!(await this.ensureLogin())) return null;

            const payload = {
                spaId: this.spaId,
                via: 'MOBILE',
                mode
            };

            const req = await this.request('POST', `/spa-commands/temperature/heater-mode`, { body: payload });

            console.log(`setHeaterMode Response [${req.status}] ${req.data.message}`);

            if (req.status === 200 && req.data?.data) {
                await this.sleep(5000); // Wait for 5 seconds to allow server to update
                const currentState = await this.getSpa();
                return currentState;
            }

            console.error('Failed to set heater mode');
            return null;
        } catch (error) {
            console.error('SetHeaterMode Error:', error.message);
            return null;
        }
    }

    /**
     * Sets the start time and length of a filter cycle. This does not enable or
     * disable filter cycle 2: use setFilter2State() for that.
     * @param {number} deviceNumber - 0 for filter cycle 1, 1 for filter cycle 2.
     * @param {number} numOfIntervals - Length in 15-minute intervals (1-96).
     * @param {string} time - Start time as HH:mm.
     * @param {Object} [options]
     * @param {boolean} [options.refresh=true] - Wait and return the spa state; when false, returns true on success.
     * @returns {Promise<Object|boolean|null>} - The spa state (or true), or null on failure.
     */
    async setFilterCycle(deviceNumber, numOfIntervals, time, { refresh = true } = {}) {
        try {
            if (!(await this.ensureLogin())) return null;

            const payload = {
                spaId: this.spaId,
                via: 'MOBILE',
                deviceNumber,
                numOfIntervals,
                time
            };

            const req = await this.request('POST', `/spa-commands/filter-cycles/schedule`, { body: payload });

            console.log(`setFilterCycle Response [${req.status}] ${req.data.message}`);

            if (req.status === 200) {
                if (!refresh) return true;
                await this.sleep(5000); // Wait for 5 seconds to allow server to update
                const currentState = await this.getSpa();
                return currentState;
            }

            console.error('Failed to set filter cycle');
            return null;
        } catch (error) {
            console.error('SetFilterCycle Error:', error.message);
            return null;
        }
    }

    /**
     * Enables or disables filter cycle 2. Its schedule is kept while it is disabled.
     * Despite the endpoint's name this is a setter: `state` is the wanted state.
     * @param {boolean} enabled - true to enable filter cycle 2, false to disable it.
     * @returns {Promise<Object|null>} - The spa state, or null on failure.
     */
    async setFilter2State(enabled) {
        try {
            if (!(await this.ensureLogin())) return null;

            const payload = {
                spaId: this.spaId,
                state: enabled ? 'ON' : 'OFF',
                via: 'MOBILE'
            };

            const req = await this.request('POST', `/spa-commands/filter-cycles/toggle-filter2-state`, { body: payload });

            console.log(`setFilter2State Response [${req.status}] ${req.data.message}`);

            if (req.status === 200) {
                await this.sleep(5000); // Wait for 5 seconds to allow server to update
                const currentState = await this.getSpa();
                return currentState;
            }

            console.error(`Failed to set filter cycle 2 ${enabled ? 'on' : 'off'}`);
            return null;
        } catch (error) {
            console.error('setFilter2State Error:', error.message);
            return null;
        }
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
