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
            console.error(error);
            return false;
        }
    }

    async getSpa() {
        try {
            if (!this.isLoggedIn()) await this.login();

            const req = await this.instance.get(`https://production.controlmyspa.net/spas/${this.spaId}/dashboard`, {
                headers: this.getAuthHeaders()
            });

            if (req.status === 200 && req.data?.data) {
                this.currentSpa = req.data.data;
                return this.currentSpa;
            }

            console.error('failed to get spa dashboard');
            return false;
        } catch (error) {
            console.error(error);
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
                    ...this.getCommonHeaders()
                }
            });

            return req.status === 200 && req.data?.data?.success;
        } catch (error) {
            console.error(error);
        }
    }

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
                    ...this.getCommonHeaders()
                }
            });

            return req.status === 200 && req.data?.data?.success;
        } catch (error) {
            console.error(error);
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
                    ...this.getCommonHeaders()
                }
            });

            return req.status === 200 && req.data?.data?.success;
        } catch (error) {
            console.error(error);
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
                    ...this.getCommonHeaders()
                }
            });

            return req.status === 200 && req.data?.data?.success;
        } catch (error) {
            console.error(error);
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
                    ...this.getCommonHeaders()
                }
            });

            return req.status === 200 && req.data?.data?.success;
        } catch (error) {
            console.error(error);
        }
    }

    async setHeaterMode(mode) {
        try {
            if (!this.isLoggedIn()) await this.login();

            const allowedModes = ['READY', 'REST'];
            if (!allowedModes.includes(mode)) {
                console.error('Invalid heater mode. Allowed values are: READY, REST');
                return false;
            }

            const payload = {
                spaId: this.spaId,
                via: 'MOBILE',
                mode
            };

            const req = await this.instance.post('https://production.controlmyspa.net/spa-commands/temperature/heater-mode', payload, {
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getCommonHeaders()
                }
            });

            return req.status === 200 && req.data?.data?.success;
        } catch (error) {
            console.error(error);
        }
    }

    async setFilterCycle(deviceNumber, time, numOfIntervals) {
        try {
            if (!this.isLoggedIn()) await this.login();

            const payload = {
                spaId: this.spaId,
                via: 'MOBILE',
                deviceNumber,
                time,
                numOfIntervals
            };

            const req = await this.instance.post('https://production.controlmyspa.net/spa-commands/filter-cycles/schedule', payload, {
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getCommonHeaders()
                }
            });

            return req.status === 200 && req.data?.data?.success;
        } catch (error) {
            console.error(error);
        }
    }

    createFilterScheduleIntervals() {
        this.scheduleFilterIntervalEnum = Object.freeze({
            idisabled: 0,
            i15minutes: 1,
            i30minutes: 2,
            i45minutes: 3,
            i1hour: 4,
            i1hour15minutes: 5,
            i1hour30minutes: 6,
            i1hour45minutes: 7,
            i2hours: 8,
            i2hours15minutes: 9,
            i2hours30minutes: 10,
            i2hours45minutes: 11,
            i3hours: 12,
            i3hours15minutes: 13,
            i3hours30minutes: 14,
            i3hours45minutes: 15,
            i4hours: 16,
            i4hours15minutes: 17,
            i4hours30minutes: 18,
            i4hours45minutes: 19,
            i5hours: 20,
            i5hours15minutes: 21,
            i5hours30minutes: 22,
            i5hours45minutes: 23,
            i6hours: 24,
            i6hours15minutes: 25,
            i6hours30minutes: 26,
            i6hours45minutes: 27,
            i7hours: 28,
            i7hours15minutes: 29,
            i7hours30minutes: 30,
            i7hours45minutes: 31,
            i8hours: 32,
            i8hours15minutes: 33,
            i8hours30minutes: 34,
            i8hours45minutes: 35,
            i9hours: 36,
            i9hours15minutes: 37,
            i9hours30minutes: 38,
            i9hours45minutes: 39,
            i10hours: 40,
            i10hours15minutes: 41,
            i10hours30minutes: 42,
            i10hours45minutes: 43,
            i11hours: 44,
            i11hours15minutes: 45,
            i11hours30minutes: 46,
            i11hours45minutes: 47,
            i12hours: 48,
            i12hours15minutes: 49,
            i12hours30minutes: 50,
            i12hours45minutes: 51,
            i13hours: 52,
            i13hours15minutes: 53,
            i13hours30minutes: 54,
            i13hours45minutes: 55,
            i14hours: 56,
            i14hours15minutes: 57,
            i14hours30minutes: 58,
            i14hours45minutes: 59,
            i15hours: 60,
            i15hours15minutes: 61,
            i15hours30minutes: 62,
            i15hours45minutes: 63,
            i16hours: 64,
            i16hours15minutes: 65,
            i16hours30minutes: 66,
            i16hours45minutes: 67,
            i17hours: 68,
            i17hours15minutes: 69,
            i17hours30minutes: 70,
            i17hours45minutes: 71,
            i18hours: 72,
            i18hours15minutes: 73,
            i18hours30minutes: 74,
            i18hours45minutes: 75,
            i19hours: 76,
            i19hours15minutes: 77,
            i19hours30minutes: 78,
            i19hours45minutes: 79,
            i20hours: 80,
            i20hours15minutes: 81,
            i20hours30minutes: 82,
            i20hours45minutes: 83,
            i21hours: 84,
            i21hours15minutes: 85,
            i21hours30minutes: 86,
            i21hours45minutes: 87,
            i22hours: 88,
            i22hours15minutes: 89,
            i22hours30minutes: 90,
            i22hours45minutes: 91,
            i23hours: 92,
            i23hours15minutes: 93,
            i23hours30minutes: 94,
            i23hours45minutes: 95,
            i24hours: 96
        });
    }
}

module.exports = ControlMySpa;
