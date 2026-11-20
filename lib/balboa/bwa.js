const https = require('https');

class GlobalState {
    constructor() {
        this.token = null;
        this.device_id = null;
    }
    // Set authentication token
    setToken(token) {
        this.token = token;
    }
    // Set device ID
    setDeviceId(deviceId) {
        this.device_id = deviceId;
    }
}

const globalState = new GlobalState();

// Function to perform HTTPS requests
function httpsRequest(options, body = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            // Collect data chunks
            res.on('data', (chunk) => {
                data += chunk;
            });
            // Handle response end
            res.on('end', () => {
                try {
                    // Try parsing data as JSON
                    resolve(JSON.parse(data));
                } catch (e) {
                    // Resolve with raw data if not JSON
                    resolve(data);
                }
            });
        });

        req.on('error', (e) => reject(e)); // Handle request error
        if (body) req.write(body); // Write request body if present
        req.end(); // End the request
    });
}

// Function to login and retrieve token
async function loginAndGetToken(username, password) {
    // Define request options
    const loginOptions = {
        hostname: 'bwgapi.balboawater.com',
        path: '/users/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    };

    // Stringify login data
    const loginData = JSON.stringify({ username, password });

    let loginResponse;
    try {
        loginResponse = await httpsRequest(loginOptions, loginData);
    } catch (error) {
        throw new Error(`BWA login request failed: ${error.message}`);
    }

    if (!loginResponse || !loginResponse.token) {
        const reason = (loginResponse && loginResponse.message) || 'no token in the response';
        throw new Error(`BWA login failed: ${reason}`);
    }
    if (!loginResponse.device || !loginResponse.device.device_id) {
        throw new Error('BWA login failed: no spa device in the account');
    }

    // Set global state with token and device ID
    globalState.setToken(loginResponse.token);
    globalState.setDeviceId(loginResponse.device.device_id);

    return loginResponse;
}

// Function to parse device configuration data
function parseDeviceConfigurationData(encodedData) {
    const decoded = Buffer.from(encodedData, 'base64');

    let deviceConfig = {
        Pumps: {},
        Lights: {},
        Blower: {},
        Aux: {},
        Mister: {},
        DeviceId: globalState.device_id
    };

    // Parse and store data for each pump
    deviceConfig.Pumps = {
        Pump1: { present: (decoded[7] & 128) !== 0 },
        Pump2: { present: (decoded[4] & 3) !== 0 },
        Pump3: { present: (decoded[4] & 12) !== 0 },
        Pump4: { present: (decoded[4] & 48) !== 0 },
        Pump5: { present: (decoded[4] & 192) !== 0 },
        Pump6: { present: (decoded[5] & 3) !== 0 }
    };

    // Parse and store data for lights
    deviceConfig.Lights = {
        Light1: { present: (decoded[6] & 3) !== 0 },
        Light2: { present: (decoded[6] & 12) !== 0 }
    };

    // Parse and store data for blower (adjust the logic as needed)
    deviceConfig.Blower = { present: (decoded[7] & 15) !== 0 }; // Example logic

    // Parse and store data for Aux (adjust the logic as needed)
    deviceConfig.Aux = {
        Aux1: { present: (decoded[8] & 1) !== 0 },
        Aux2: { present: (decoded[8] & 2) !== 0 }
    };

    // Parse and store data for Mister (adjust the logic as needed)
    deviceConfig.Mister = { present: (decoded[8] & 16) !== 0 };

    return deviceConfig;
}

// Function to extract data from XML
function extractDataFromXML(xmlString) {
    const dataRegex = /<data>(.*?)<\/data>/;
    const match = xmlString.match(dataRegex);
    return match ? match[1] : null;
}

// Function to parse Panel Data

function parsePanelData(encodedData) {
    const decoded = Buffer.from(encodedData, 'base64');

    // Parse common data
    const is24HourTime = (decoded[13] & 2) !== 0;
    const currentTimeHour = decoded[7];
    const currentTimeMinute = decoded[8];
    const temperatureScale = (decoded[13] & 1) === 0 ? 'F' : 'C';
    const actualTemperature = temperatureScale === 'C' ? decoded[6] / 2 : decoded[6];
    const targetTemperature = temperatureScale === 'C' ? decoded[24] / 2 : decoded[24];
    const temperatureRange = (decoded[14] & 4) === 4 ? 'high' : 'low';
    const isHeating = (decoded[14] & 48) !== 0;

    // Determine heat mode
    let heatMode;
    switch (decoded[9]) {
        case 0:
            heatMode = 'Ready';
            break;
        case 1:
            heatMode = 'Rest';
            break;
        case 2:
            heatMode = 'Ready in Rest';
            break;
        default:
            heatMode = 'None';
    }

    // Pumps state parsing
    let pumpsState = {};
    for (let i = 1; i <= 6; i++) {
        let pumpState = 'off';
        switch (decoded[15] & (3 << ((i - 1) * 2))) {
            case 1 << ((i - 1) * 2):
                pumpState = 'low';
                break;
            case 2 << ((i - 1) * 2):
                pumpState = 'high';
                break;
        }
        pumpsState[`Pump${i}`] = pumpState;
    }

    // Lights state parsing
    let lightsState = {
        Light1: (decoded[18] & 3) !== 0 ? 'on' : 'off',
        Light2: (decoded[18] & 12) !== 0 ? 'on' : 'off'
    };

    // Blower state parsing
    let blowerState = 'off';
    switch (decoded[17] & 12) {
        case 4:
            blowerState = 'low';
            break;
        case 8:
            blowerState = 'medium';
            break;
        case 12:
            blowerState = 'high';
            break;
    }

    // Mister state parsing
    let misterState = (decoded[19] & 1) !== 0 ? 'on' : 'off';

    // Aux state parsing
    let auxState = {
        Aux1: (decoded[19] & 8) !== 0 ? 'on' : 'off',
        Aux2: (decoded[19] & 16) !== 0 ? 'on' : 'off'
    };

    // WiFi state parsing
    let wifiState = 'Unknown'; // Default state
    switch (decoded[16] & 240) {
        case 0:
            wifiState = 'WiFi OK';
            break;
        case 16:
            wifiState = 'WiFi Spa Not Communicating';
            break;
        case 32:
            wifiState = 'WiFi Startup';
            break;
        // ... other cases as per your system's specification
    }

    // Return the parsed panel data
    return {
        is24HourTime,
        currentTimeHour,
        currentTimeMinute,
        temperatureScale,
        actualTemperature,
        targetTemperature,
        temperatureRange,
        isHeating,
        heatMode,
        pumpsState,
        lightsState,
        blowerState,
        misterState,
        auxState,
        wifiState
    };
}

// isValidSpaByteArray function
function isValidSpaByteArray(decodedData) {
    const VALID_SPA_BYTE_ARRAY = [32, 255, 175]; // Adjusted for JavaScript byte values
    for (let i = 0; i < VALID_SPA_BYTE_ARRAY.length; i++) {
        if (decodedData[i] !== VALID_SPA_BYTE_ARRAY[i]) {
            return false;
        }
    }
    return true;
}

// Request a file from the spa and return its base64 data. Throws when the request fails or has no data.
async function requestDeviceFile(deviceId, filePath) {
    const requestOptions = createRequestOptions(deviceId, filePath);
    let response;
    try {
        response = await httpsRequest(requestOptions, createXmlRequestBody(deviceId, filePath));
    } catch (error) {
        throw new Error(`BWA ${filePath} request failed: ${error.message}`);
    }

    if (!response || typeof response !== 'string') {
        throw new Error(`BWA ${filePath} request failed: no XML in the response`);
    }

    const data = extractDataFromXML(response);
    if (!data) {
        throw new Error(`BWA ${filePath} request failed: no data in the response`);
    }

    return data;
}

// Function to handle the device configuration request
async function handleDeviceConfigurationRequest(deviceId) {
    return parseDeviceConfigurationData(await requestDeviceFile(deviceId, 'DeviceConfiguration.txt'));
}

// Function to handle the panel update request
async function handlePanelUpdateRequest(deviceId) {
    return parsePanelData(await requestDeviceFile(deviceId, 'PanelUpdate.txt'));
}

// Create options for httpsRequest
function createRequestOptions(deviceId, path) {
    return {
        hostname: 'bwgapi.balboawater.com',
        path: '/devices/sci',
        method: 'POST',
        headers: {
            Authorization: `Bearer ${globalState.token}`,
            'Content-Type': 'application/xml'
        }
    };
}

// Create XML body for request
function createXmlRequestBody(deviceId, filePath) {
    return `<sci_request version="1.0"><file_system><targets><device id="${deviceId}"/></targets><commands><get_file path="${filePath}"/></commands></file_system></sci_request>`;
}
// SpaControl class integration
class SpaControl {
    constructor(deviceId) {
        this.deviceId = deviceId;
    }

    async sendCommand(targetName, command) {
        const commandXml = this.buildCommandXml(targetName, command);

        const requestOptions = {
            hostname: 'bwgapi.balboawater.com',
            path: '/devices/sci',
            method: 'POST',
            headers: {
                Authorization: `Bearer ${globalState.token}`,
                'Content-Type': 'application/xml'
            }
        };

        try {
            return await httpsRequest(requestOptions, commandXml);
        } catch (error) {
            throw new Error(`BWA command ${targetName} ${command} failed: ${error.message}`);
        }
    }

    buildCommandXml(targetName, data) {
        return `<sci_request version="1.0"><data_service><targets><device id="${this.deviceId}"/></targets><requests><device_request target_name="${targetName}">${data}</device_request></requests></data_service></sci_request>`;
    }

    async turnOn(buttonNumber) {
        // The command to turn on might have a specific format or data
        await this.sendCommand('Button', buttonNumber + ':on');
    }

    async turnOff(buttonNumber) {
        // The command to turn off might have a specific format or data
        await this.sendCommand('Button', buttonNumber + ':off');
    }
}

// The update* functions return true when they sent a command and false when the spa was
// already in the requested state. They throw when a request fails.

//Update the pump
async function updatePumpStatus(deviceId, pumpNumber, turnOn) {
    const pumpButtonMap = {
        1: 4, // Pump 1 maps to Balboa API Button #4
        2: 5, // Pump 2 maps to Balboa API Button #5
        3: 6, // Pump 3 maps to Balboa API Button #6
        4: 7, // Pump 4 maps to Balboa API Button #7
        5: 8, // Pump 5 maps to Balboa API Button #8
        6: 9 // Pump 6 maps to Balboa API Button #9
    };

    const buttonNumber = pumpButtonMap[pumpNumber];
    if (buttonNumber === undefined) {
        throw new Error(`Invalid pump number: ${pumpNumber}`);
    }

    const currentPanelData = await handlePanelUpdateRequest(deviceId);

    const currentPumpState = currentPanelData.pumpsState[`Pump${pumpNumber}`];
    if ((turnOn && currentPumpState === 'off') || (!turnOn && currentPumpState !== 'off')) {
        const spaControl = new SpaControl(deviceId);
        if (turnOn) {
            await spaControl.turnOn(buttonNumber);
        } else {
            await spaControl.turnOff(buttonNumber);
        }
        return true;
    }
    return false;
}

//Update the lights
async function updateLightStatus(deviceId, lightNumber, turnOn) {
    const lightButtonMap = {
        1: 17, // Light 1 maps to Balboa API Button #17
        2: 18 // Light 2 maps to Balboa API Button #18
    };

    const buttonNumber = lightButtonMap[lightNumber];
    if (buttonNumber === undefined) {
        throw new Error(`Invalid light number: ${lightNumber}`);
    }

    const currentPanelData = await handlePanelUpdateRequest(deviceId);

    const currentLightState = currentPanelData.lightsState[`Light${lightNumber}`];
    if ((turnOn && currentLightState === 'off') || (!turnOn && currentLightState !== 'off')) {
        const spaControl = new SpaControl(deviceId);
        if (turnOn) {
            await spaControl.turnOn(buttonNumber);
        } else {
            await spaControl.turnOff(buttonNumber);
        }
        return true;
    }
    return false;
}

//Update the AUX
async function updateAuxStatus(deviceId, auxNumber, turnOn) {
    const auxButtonMap = {
        1: 22, // Aux 1 maps to Balboa API Button #22
        2: 23 // Aux 2 maps to Balboa API Button #23
    };

    const buttonNumber = auxButtonMap[auxNumber];
    if (buttonNumber === undefined) {
        throw new Error(`Invalid auxiliary number: ${auxNumber}`);
    }

    const currentPanelData = await handlePanelUpdateRequest(deviceId);

    const currentAuxState = currentPanelData.auxState[`Aux${auxNumber}`];
    if ((turnOn && currentAuxState === 'off') || (!turnOn && currentAuxState !== 'off')) {
        const spaControl = new SpaControl(deviceId);
        if (turnOn) {
            await spaControl.turnOn(buttonNumber);
        } else {
            await spaControl.turnOff(buttonNumber);
        }
        return true;
    }
    return false;
}

//Update Blower
async function updateBlowerStatus(deviceId, turnOn) {
    const blowerButtonNumber = 12; // Blower maps to Balboa API Button #12

    const currentPanelData = await handlePanelUpdateRequest(deviceId);

    const currentBlowerState = currentPanelData.blowerState;
    if ((turnOn && currentBlowerState === 'off') || (!turnOn && currentBlowerState !== 'off')) {
        const spaControl = new SpaControl(deviceId);
        if (turnOn) {
            await spaControl.turnOn(blowerButtonNumber);
        } else {
            await spaControl.turnOff(blowerButtonNumber);
        }
        return true;
    }
    return false;
}

//Update Mister status
async function updateMisterStatus(deviceId, turnOn) {
    const misterButtonNumber = 14; // Mister maps to Balboa API Button #14

    const currentPanelData = await handlePanelUpdateRequest(deviceId);

    const currentMisterState = currentPanelData.misterState;
    if ((turnOn && currentMisterState === 'off') || (!turnOn && currentMisterState !== 'off')) {
        const spaControl = new SpaControl(deviceId);
        if (turnOn) {
            await spaControl.turnOn(misterButtonNumber);
        } else {
            await spaControl.turnOff(misterButtonNumber);
        }
        return true;
    }
    return false;
}

// Button mappings
const BUTTON_MAP = {
    // ... other mappings ...
    TempRange: 80,
    HeatMode: 81
};

// Function to update the temperature range
async function updateTemperatureRange(deviceId, setToHigh, override = false) {
    const tempRangeButtonNumber = BUTTON_MAP.TempRange; // TempRange button number from a map
    const currentPanelData = await handlePanelUpdateRequest(deviceId);

    if (!currentPanelData.temperatureRange) {
        throw new Error('Temperature range not found in panel data');
    }
    const currentTempRangeState = currentPanelData.temperatureRange.toLowerCase();

    // Explicitly check for 'low' or 'high' to ensure case-insensitive comparison
    if ((setToHigh && (currentTempRangeState === 'low' || override)) || (!setToHigh && (currentTempRangeState === 'high' || override))) {
        const spaControl = new SpaControl(deviceId);
        await spaControl.sendCommand('Button', tempRangeButtonNumber.toString());
        return true;
    }
    return false;
}

/// Function to update the heat mode
async function updateHeatMode(deviceId, setToReady) {
    const heatModeButtonNumber = BUTTON_MAP.HeatMode; // HeatMode button number from a map
    const currentPanelData = await handlePanelUpdateRequest(deviceId);

    const currentHeatModeState = currentPanelData.heatMode;
    // Corrected logic: Toggle state only if not in the desired state
    if ((setToReady && currentHeatModeState !== 'Ready') || (!setToReady && currentHeatModeState !== 'Rest')) {
        const spaControl = new SpaControl(deviceId);
        await spaControl.sendCommand('Button', heatModeButtonNumber.toString());
        return true;
    }
    return false;
}

//Set the temp of the spa
async function updateTemperature(deviceId, newTemperature) {
    const currentPanelData = await handlePanelUpdateRequest(deviceId);

    const temperatureScale = currentPanelData.temperatureScale;
    let convertedTemperature = newTemperature;

    // Convert the new temperature based on the temperature scale
    if (temperatureScale === 'C') {
        // If the system is in Celsius, and it expects the setpoint to be double the actual value
        convertedTemperature = newTemperature * 2;
    }

    // Send the command using SpaControl
    const spaControl = new SpaControl(deviceId);
    await spaControl.sendCommand('SetTemp', `${convertedTemperature}`);
    return true;
}

module.exports = {
    handleDeviceConfigurationRequest,
    handlePanelUpdateRequest,
    loginAndGetToken,
    updatePumpStatus,
    updateBlowerStatus,
    updateLightStatus,
    updateTemperature,
    updateTemperatureRange,
    updateHeatMode
};
