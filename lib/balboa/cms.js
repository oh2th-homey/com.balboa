const axios = require('axios').default;
const https = require('https');

class ControlMySpa {
    constructor(email, password) {
        this.email = email;
        this.password = password;
        this.tokenData = null;
        this.userInfo = null;
        this.currentSpa = null;
        this.waitForResult = true;
        this.scheduleFilterIntervalEnum = null;
        this.createFilterScheduleIntervals();

        this.instance = axios.create({
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });
    }

    /**
     * Constructs the currentState object from the API response.
     * @param {Object} spaData - The data object from the API response.
     * @returns {Object} - The constructed currentState object.
     */
    constructCurrentState(spaData) {
        return {
            desiredTemp: parseFloat(spaData.desiredTemp),
            targetDesiredTemp: parseFloat(spaData.desiredTemp), // Assuming targetDesiredTemp is the same as desiredTemp
            currentTemp: parseFloat(spaData.currentTemp),
            panelLock: spaData.isPanelLocked,
            heaterMode: spaData.heaterMode,
            components: spaData.components || [],
            runMode: spaData.heaterMode, // Assuming runMode is the same as heaterMode
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

    getAuthHeaders() {
        return {
            Authorization: 'Bearer ' + this.tokenData.access_token,
            ...this.getCommonHeaders()
        };
    }

    getCommonHeaders() {
        return {
            Accept: '*/*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en-GB,en;q=0.9',
            'User-Agent': 'cms/34 CFNetwork/3826.500.111.2.2 Darwin/24.4.0'
        };
    }

    async init() {
        return (await this.login()) && (await this.getWhoAmI()) && (await this.getSpa());
    }

    async deviceInit() {
        return (await this.login()) && (await this.getWhoAmI());
    }

    isLoggedIn() {
        return !!this.tokenData?.access_token && this.tokenData.timestamp + this.tokenData.expires_in * 1000 > Date.now();
    }

    async login() {
        try {
            const req = await this.instance.post(
                'https://production.controlmyspa.net/auth/login',
                {
                    email: this.email,
                    password: this.password
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        ...this.getCommonHeaders()
                    }
                }
            );

            console.log('Login Response:', {
                status: req.status,
                headers: req.headers,
                data: req.data
            });

            if (req.status === 200 && req.data?.data?.accessToken) {
                this.tokenData = {
                    access_token: req.data.data.accessToken,
                    timestamp: Date.now(),
                    expires_in: 3600
                };
                return true;
            }

            console.error('failed to login');
            return false;
        } catch (error) {
            console.error('Login Error:', error);
            return false;
        }
    }

    async getWhoAmI() {
        try {
            const req = await this.instance.get('https://production.controlmyspa.net/user-management/profile', {
                headers: this.getAuthHeaders()
            });

            console.log('GetWhoAmI Response:', {
                status: req.status,
                headers: req.headers,
                data: req.data
            });

            if (req.status === 200 && req.data?.data?.user) {
                this.userInfo = req.data.data.user;
                this.spaId = this.userInfo.spaId;
                return this.userInfo;
            }

            console.error('failed to get WhoAmI');
            return false;
        } catch (error) {
            console.error('GetWhoAmI Error:', error);
        }
    }

    /**
     * Retrieves the spa's current state.
     * @returns {Object|null} - The currentState object or null if the request fails.
     */
    async getSpa() {
        try {
            if (!this.isLoggedIn()) await this.login();

            const req = await this.instance.get(`https://production.controlmyspa.net/spas/${this.spaId}/dashboard`, {
                headers: this.getAuthHeaders()
            });

            console.log(`getSpa Response [${req.status}] ${req.data.message}`);

            if (req.status === 200 && req.data?.data) {
                const currentState = this.constructCurrentState(req.data.data);
                console.log('Current Spa State:', currentState);
                return currentState;
            }

            console.error('Failed to get spa dashboard');
            return null;
        } catch (error) {
            console.error('GetSpa Error:', error);
            return null;
        }
    }

    async setTime(date, time, military_format = true) {
        try {
            if (!this.isLoggedIn()) await this.login();

            const payload = {
                isMilitaryFormat: military_format,
                via: 'MOBILE',
                date,
                time,
                spaId: this.spaId
            };

            const req = await this.instance.post('https://production.controlmyspa.net/spa-commands/time', payload, {
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                }
            });

            console.log(`setTime Response [${req.status}] ${req.data.message}`);

            if (req.status === 200) {
                await this.sleep(5000); // Wait for 5 seconds to allow server to update
                const currentState = await this.getSpa();
                return currentState;
            }

            console.error('Failed to get spa dashboard');
            return null;
        } catch (error) {
            console.error('GetTime Error:', error);
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
            if (!this.isLoggedIn()) await this.login();

            const payload = {
                spaId: this.spaId,
                via: 'MOBILE',
                value: temp
            };

            const req = await this.instance.post('https://production.controlmyspa.net/spa-commands/temperature/value', payload, {
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                }
            });

            console.log(`setTemp Response [${req.status}] ${req.data.message}`);

            if (req.status === 200) {
                await this.sleep(5000); // Wait for 5 seconds to allow server to update
                const currentState = await this.getSpa();
                return currentState;
            }

            console.error('Failed to set temperature');
            return null;
        } catch (error) {
            console.error('SetTemp Error:', error);
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
            if (!this.isLoggedIn()) await this.login();

            const payload = {
                spaId: this.spaId,
                via: 'MOBILE',
                range: high ? 'HIGH' : 'LOW'
            };

            const req = await this.instance.post('https://production.controlmyspa.net/spa-commands/temperature/range', payload, {
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                }
            });

            console.log(`setTempRange Response [${req.status}] ${req.data.message}`);

            if (req.status === 200) {
                await this.sleep(5000); // Wait for 5 seconds to allow server to update
                const currentState = await this.getSpa();
                return currentState;
            }

            console.error('Failed to set temperature range');
            return null;
        } catch (error) {
            console.error('SetTempRange Error:', error);
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
            if (!this.isLoggedIn()) await this.login();

            const panelData = {
                spaId: this.spaId,
                via: 'MOBILE',
                state: locked ? 'LOCK_PANEL' : 'UNLOCK_PANEL'
            };

            const req = await this.instance.post('https://production.controlmyspa.net/spa-commands/panel/state', panelData, {
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                }
            });

            console.log(`setPanelLock Response [${req.status}] ${req.data.message}`);

            if (req.status === 200) {
                await this.sleep(5000); // Wait for 5 seconds to allow server to update
                const currentState = await this.getSpa();
                return currentState;
            }

            console.error('Failed to set panel lock state');
            return null;
        } catch (error) {
            console.error('setPanelLock Error:', error);
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
            if (!this.isLoggedIn()) await this.login();

            const payload = {
                deviceNumber,
                state: desiredState,
                spaId: this.spaId,
                via: 'MOBILE',
                componentType
            };

            const req = await this.instance.post('https://production.controlmyspa.net/spa-commands/component-state', payload, {
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                }
            });

            console.log(`setComponentState ${componentType} Response [${req.status}] ${req.data.message}`);

            if (req.status === 200) {
                await this.sleep(5000); // Wait for 5 seconds to allow server to update
                const currentState = await this.getSpa();
                return currentState;
            }

            console.error(`Failed to set component ${componentType} state to ${desiredState}`);
            return null;
        } catch (error) {
            console.error('setComponentState Error:', error);
            return null;
        }
    }

    async setHeaterMode(mode) {
        try {
            if (!this.isLoggedIn()) await this.login();

            const payload = {
                spaId: this.spaId,
                via: 'MOBILE',
                mode
            };

            const req = await this.instance.post('https://production.controlmyspa.net/spa-commands/temperature/heater-mode', payload, {
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                }
            });

            console.log(`setHeaterMode Response [${req.status}] ${req.data.message}`);

            if (req.status === 200 && req.data?.data) {
                await this.sleep(5000); // Wait for 5 seconds to allow server to update
                const currentState = await this.getSpa();
                return currentState;
            }

            console.error('Failed to set heater mode');
            return null;
        } catch (error) {
            console.error('SetHeaterMode Error:', error);
            return null;
        }
    }

    async setFilterCycle(deviceNumber, numOfIntervals, time) {
        try {
            if (!this.isLoggedIn()) await this.login();

            const payload = {
                spaId: this.spaId,
                via: 'MOBILE',
                deviceNumber,
                numOfIntervals,
                time
            };

            const req = await this.instance.post('https://production.controlmyspa.net/spa-commands/filter-cycles/schedule', payload, {
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                }
            });

            console.log(`setFilterCycle Response [${req.status}] ${req.data.message}`);

            if (req.status === 200) {
                await this.sleep(5000); // Wait for 5 seconds to allow server to update
                const currentState = await this.getSpa();
                return currentState;
            }

            console.error('Failed to set filter cycle');
            return null;
        } catch (error) {
            console.error('SetFilterCycle Error:', error);
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
