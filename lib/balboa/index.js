const querystring = require('querystring');
const axios = require('axios').default;
const https = require('https');

class ControlMySpa {
    constructor(email, password) {
        this.email = email;
        this.password = password;

        // Access token data
        this.tokenData = null;

        // WhoAMI
        this.userInfo = null;

        this.currentSpa = null;

        // Urls
        this.tokenEndpoint = null;
        this.refreshEndpoint = null;
        this.whoami = null;

        // client info
        this.mobileClientId = null;
        this.mobileClientSecret = null;

        this.waitForResult = true;

        this.scheduleFilterIntervalEnum = null;
        this.createFilterScheduleIntervals();

        this.instance = axios.create({
            httpsAgent: new https.Agent({
                rejectUnauthorized: false
            })
        });
    }

    async init() {
        return (await this.idm()) && (await this.login()) && (await this.getWhoAmI()) && (await this.getSpa());
    }

    async deviceInit() {
        return (await this.idm()) && (await this.login()) && (await this.getWhoAmI());
    }

    async idm() {
        try {
            const req = await this.instance.get('https://iot.controlmyspa.com/idm/tokenEndpoint');

            if (req.status === 200) {
                const body = req.data;

                this.mobileClientId = body.mobileClientId;
                this.mobileClientSecret = body.mobileClientSecret;
                this.tokenEndpoint = body._links.tokenEndpoint.href;
                this.refreshEndpoint = body._links.refreshEndpoint.href;
                this.whoami = body._links.whoami.href;
            } else {
                // error getting idm
                console.error('Error getting IDM info');
            }

            return req.status === 200;
        } catch (error) {
            console.log(error);
        }
    }

    async login() {
        try {
            const form = {
                grant_type: 'password',
                password: this.password,
                scope: 'openid user_name',
                username: this.email
            };

            const formData = querystring.stringify(form);
            const contentLength = formData.length;

            const req = await this.instance.post(this.tokenEndpoint, formData, {
                headers: {
                    'Content-Length': contentLength,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `Basic ${Buffer.from(this.mobileClientId + ':' + this.mobileClientSecret).toString('base64')}`
                }
            });

            if (req.status === 200) {
                const body = req.data;
                this.tokenData = body;
                console.log('login success');
            } else {
                // error getting idm
                console.error('failed to login');
            }

            return req.status === 200;
        } catch (error) {
            console.log(error);
        }
    }

    async getWhoAmI() {
        try {
            const req = await this.instance.get(this.whoami, {
                headers: {
                    Authorization: 'Bearer ' + this.tokenData.access_token
                }
            });

            if (req.status === 200) {
                const body = req.data;
                this.userInfo = body;

                return this.userInfo;
            } else {
                // error getting idm
                console.error('failed to get WhoAmI');
            }

            return false;
        } catch (error) {
            console.log(error);
        }
    }

    async getSpa() {
        try {
            const req = await this.instance.get(`https://iot.controlmyspa.com/mobile/spas/search/findByUsername?`, {
                headers: {
                    Authorization: 'Bearer ' + this.tokenData.access_token
                },
                params: {
                    username: this.userInfo.username
                }
            });

            if (req.status === 200) {
                const body = req.data;

                this.currentSpa = body;

                return this.currentSpa;
            } else {
                // error getting idm
                console.error('failed to get spa data');
            }

            return false;
        } catch (error) {
            console.log(error);
        }
    }

    /**
     * @description Call the CMS API to set time and 24h clock format
     * 
     * @param {String} date in mm/dd/yyyy format
     * @param {String} time in HH:mm format
     * @param {Boolean} military_format true for 24h, false for 12h clock
     */
    async setTime(date, time, military_format = true) {
        // Escape slashes in date before sending to api
        try {
            const timeData = {
                date: date.replace(/\//g, '\\/'),
                time: time,
                military_format: military_format ? 'TRUE' : 'FALSE'
            };

            const req = await this.instance.post('https://iot.controlmyspa.com/mobile/control/' + this.currentSpa._id + '/setTime', timeData, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'ControlMySpa/3.0.2 (com.controlmyspa.qa; build:1; iOS 14.2.0) Alamofire/5.2.2',
                    'Accept-Encoding': 'br;q=1.0, gzip;q=0.9, deflate;q=0.8',
                    'Accept-Language': 'cs-CZ;q=1.0',
                    'Content-Length': JSON.stringify(timeData).length,
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + this.tokenData.access_token
                }
            });

            if (req.status === 202) {
                const body = req.data;
            } else {
                // error getting idm
                console.error('failed to set time');
            }

            return req.status === 200;
        } catch (error) {
            console.log(error);
        }
    }

    async setTemp(temp) {
        try {
            // let toSet = temp;

            const tempData = {
                desiredTemp: temp.toFixed(1)
            };

            const req = await this.instance.post('https://iot.controlmyspa.com/mobile/control/' + this.currentSpa._id + '/setDesiredTemp', tempData, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'ControlMySpa/3.0.2 (com.controlmyspa.qa; build:1; iOS 14.2.0) Alamofire/5.2.2',
                    'Accept-Encoding': 'br;q=1.0, gzip;q=0.9, deflate;q=0.8',
                    'Accept-Language': 'cs-CZ;q=1.0',
                    'Content-Length': JSON.stringify(tempData).length,
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + this.tokenData.access_token
                }
            });

            if (req.status === 202) {
                const body = req.data;
            } else {
                // error getting idm
                console.error('failed to set temp');
            }

            return req.status === 200;
        } catch (error) {
            console.log(error);
        }
    }

    async setTempRangeHigh() {
        return await this.setTempRange(true);
    }

    async setTempRangeLow() {
        return await this.setTempRange(false);
    }

    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async setTempRange(high) {
        try {
            const tempData = {
                desiredState: high ? 'HIGH' : 'LOW'
            };

            const req = await this.instance.post('https://iot.controlmyspa.com/mobile/control/' + this.currentSpa._id + '/setTempRange', tempData, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'ControlMySpa/3.0.2 (com.controlmyspa.qa; build:1; iOS 14.2.0) Alamofire/5.2.2',
                    'Accept-Encoding': 'br;q=1.0, gzip;q=0.9, deflate;q=0.8',
                    'Accept-Language': 'cs-CZ;q=1.0',
                    'Content-Length': JSON.stringify(tempData).length,
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + this.tokenData.access_token
                }
            });

            if (req.status === 202) {
                if (this.waitForResult) {
                    await this.sleep(5000);
                    const newSpaData = await this.getSpa();

                    return newSpaData;
                }

                return true;
            } else {
                // error getting idm
                console.error('failed to set temp range');
            }

            return false;
        } catch (error) {
            console.log(error);
        }
    }

    async lockPanel() {
        return await this.setPanelLock(true);
    }

    async unlockPanel() {
        return await this.setPanelLock(false);
    }

    async setPanelLock(locked) {
        try {
            const panelData = {
                desiredState: locked ? 'LOCK_PANEL' : 'UNLOCK_PANEL'
            };

            const req = await this.instance.post('https://iot.controlmyspa.com/mobile/control/' + this.currentSpa._id + '/setPanel', panelData, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'ControlMySpa/3.0.2 (com.controlmyspa.qa; build:1; iOS 14.2.0) Alamofire/5.2.2',
                    'Accept-Encoding': 'br;q=1.0, gzip;q=0.9, deflate;q=0.8',
                    'Accept-Language': 'cs-CZ;q=1.0',
                    'Content-Length': JSON.stringify(panelData).length,
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + this.tokenData.access_token
                }
            });

            if (req.status === 202) {
                const oldState = this.currentSpa.currentState.panelLock;

                if (this.waitForResult) {
                    await this.sleep(5000);
                    const newSpaData = await this.getSpa();

                    console.log((oldState ? 'LOCKED' : 'UNLOCKED') + ' => ' + (newSpaData.currentState.panelLock ? 'LOCKED' : 'UNLOCKED'));

                    return newSpaData;
                }

                return true;
            } else {
                // error getting idm
                console.error('failed to set panel lock');
            }

            return false;
        } catch (error) {
            console.log(error);
        }
    }

    async setJetState(deviceNumber, desiredState) {
        try {
            // numbers 0,1,2  || states: HIGH , OFF
            if (desiredState !== 'OFF' && desiredState !== 'HIGH') {
                console.error('Invalid value for desired state');

                return false;
            }

            console.log(deviceNumber, desiredState);

            const jetState = {
                deviceNumber: deviceNumber.toString(),
                desiredState: desiredState,
                originatorId: 'optional-Jet'
            };

            const req = await this.instance.post('https://iot.controlmyspa.com/mobile/control/' + this.currentSpa._id + '/setJetState', jetState, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'ControlMySpa/3.0.2 (com.controlmyspa.qa; build:1; iOS 14.2.0) Alamofire/5.2.2',
                    'Accept-Encoding': 'br;q=1.0, gzip;q=0.9, deflate;q=0.8',
                    'Accept-Language': 'cs-CZ;q=1.0',
                    'Content-Length': JSON.stringify(jetState).length,
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + this.tokenData.access_token
                }
            });

            if (req.status === 202) {
                const oldState = this.currentSpa.currentState.components.find((el, id) => {
                    return el.componentType === 'PUMP' && el.port === deviceNumber.toString();
                });

                if (this.waitForResult) {
                    await this.sleep(5000);
                    const newSpaData = await this.getSpa();

                    const newState = newSpaData.currentState.components.find((el, id) => {
                        return el.componentType === 'PUMP' && el.port === deviceNumber.toString();
                    });

                    console.log(oldState.value + ' => ' + newState.value);

                    return newSpaData;
                }

                return true;
            } else {
                // error getting idm
                console.error('failed to set jet state');
            }

            return false;
        } catch (error) {
            console.log(error);
        }
    }

    async setBlowerState(deviceNumber, desiredState) {
        try {
            // numbers 0,1,2  || states: HIGH , OFF
            if (desiredState !== 'OFF' && desiredState !== 'HIGH') {
                console.error('Invalid value for desired state');

                return false;
            }

            console.log(deviceNumber, desiredState);

            const blowerState = {
                deviceNumber: deviceNumber.toString(),
                desiredState: desiredState,
                originatorId: 'optional-Blower'
            };

            const req = await this.instance.post('https://iot.controlmyspa.com/mobile/control/' + this.currentSpa._id + '/setBlowerState', blowerState, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'ControlMySpa/3.0.2 (com.controlmyspa.qa; build:1; iOS 14.2.0) Alamofire/5.2.2',
                    'Accept-Encoding': 'br;q=1.0, gzip;q=0.9, deflate;q=0.8',
                    'Accept-Language': 'cs-CZ;q=1.0',
                    'Content-Length': JSON.stringify(blowerState).length,
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + this.tokenData.access_token
                }
            });

            if (req.status === 202) {
                const oldState = this.currentSpa.currentState.components.find((el, id) => {
                    return el.componentType === 'BLOWER' && el.port === deviceNumber.toString();
                });

                if (this.waitForResult) {
                    await this.sleep(5000);
                    const newSpaData = await this.getSpa();

                    const newState = newSpaData.currentState.components.find((el, id) => {
                        return el.componentType === 'BLOWER' && el.port === deviceNumber.toString();
                    });

                    console.log(oldState.value + ' => ' + newState.value);

                    return newSpaData;
                }

                return true;
            } else {
                // error getting idm
                console.error('failed to set blower state');
            }

            return false;
        } catch (error) {
            console.log(error);
        }
    }

    async setLightState(deviceNumber, desiredState) {
        try {
            // numbers 0,1,2  || states: HIGH , OFF
            if (desiredState !== 'OFF' && desiredState !== 'HIGH') {
                console.error('Invalid value for desired state');

                return false;
            }

            const lightState = {
                deviceNumber: deviceNumber.toString(),
                desiredState: desiredState,
                originatorId: 'optional-Light'
            };

            const req = await this.instance.post('https://iot.controlmyspa.com/mobile/control/' + this.currentSpa._id + '/setLightState', lightState, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'ControlMySpa/3.0.2 (com.controlmyspa.qa; build:1; iOS 14.2.0) Alamofire/5.2.2',
                    'Accept-Encoding': 'br;q=1.0, gzip;q=0.9, deflate;q=0.8',
                    'Accept-Language': 'cs-CZ;q=1.0',
                    'Content-Length': JSON.stringify(lightState).length,
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + this.tokenData.access_token
                }
            });

            if (req.status === 202) {
                const oldState = this.currentSpa.currentState.components.find((el, id) => {
                    return el.componentType === 'LIGHT' && el.port === deviceNumber.toString();
                });

                if (this.waitForResult) {
                    await this.sleep(5000);
                    const newSpaData = await this.getSpa();

                    const newState = newSpaData.currentState.components.find((el, id) => {
                        return el.componentType === 'LIGHT' && el.port === deviceNumber.toString();
                    });

                    console.log(oldState.value + ' => ' + newState.value);

                    return newSpaData;
                }

                return true;
            } else {
                // error getting idm
                console.error('failed to set light state');
            }

            return false;
        } catch (error) {
            console.log(error);
        }
    }

    async toggleHeaterMode() {
        try {
            const toggle = {
                originatorId: ''
            };

            const req = await this.instance.post('https://iot.controlmyspa.com/mobile/control/' + this.currentSpa._id + '/toggleHeaterMode', toggle, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'ControlMySpa/3.0.2 (com.controlmyspa.qa; build:1; iOS 14.2.0) Alamofire/5.2.2',
                    'Accept-Encoding': 'br;q=1.0, gzip;q=0.9, deflate;q=0.8',
                    'Accept-Language': 'cs-CZ;q=1.0',
                    'Content-Length': JSON.stringify(toggle).length,
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + this.tokenData.access_token
                }
            });

            if (req.status === 202) {
                const oldState = this.currentSpa.currentState.heaterMode;

                if (this.waitForResult) {
                    await this.sleep(5000);
                    const newSpaData = await this.getSpa();

                    const newState = newSpaData.currentState.heaterMode;

                    console.log(oldState + ' => ' + newState);

                    return newSpaData;
                }

                return true;
            } else {
                // error getting idm
                console.error('failed to set light state');
            }

            return false;
        } catch (error) {
            console.log(error);
        }
    }

    async setFilterCycleIntervalSchedule(scheduleNumber, filterInterval, startTime) {
        try {
            // scheduleNumber 0,1  || filterInterval: this.scheduleFilterIntervalEnum || time: 24 hour format eg 20:00
            const schedule = {
                deviceNumber: scheduleNumber.toString(), // 0 - first always enabled , 1 - can be disabled by setting interval number to 0
                originatorId: 'optional-filtercycle',
                intervalNumber: filterInterval,
                time: startTime
            };

            const req = await this.instance.post('https://iot.controlmyspa.com/mobile/control/' + this.currentSpa._id + '/setFilterCycleIntervalsSchedule', schedule, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'ControlMySpa/3.0.2 (com.controlmyspa.qa; build:1; iOS 14.2.0) Alamofire/5.2.2',
                    'Accept-Encoding': 'br;q=1.0, gzip;q=0.9, deflate;q=0.8',
                    'Accept-Language': 'en-US;q=1.0',
                    'Content-Length': JSON.stringify(schedule).length,
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + this.tokenData.access_token
                }
            });

            if (req.status === 202) {
                const oldState = this.currentSpa.currentState.components.find((el, id) => {
                    return el.componentType === 'FILTER' && el.port === scheduleNumber.toString();
                });

                if (this.waitForResult) {
                    await this.sleep(5000);
                    const newSpaData = await this.getSpa();

                    const newState = newSpaData.currentState.components.find((el, id) => {
                        return el.componentType === 'FILTER' && el.port === scheduleNumber.toString();
                    });

                    console.log(oldState.value + ' => ' + newState.value);

                    return newSpaData;
                }

                return true;
            } else {
                // error getting idm
                console.error('failed to set filter schedule');
            }

            return false;
        } catch (error) {
            console.log(error);
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
