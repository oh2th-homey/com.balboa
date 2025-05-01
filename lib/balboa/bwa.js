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

    try {
        // Perform login request
        const loginResponse = await httpsRequest(loginOptions, loginData);
        // Set global state with token and device ID

        if(loginResponse.token) {
            globalState.setToken(loginResponse.token);
        } else {
            console.error('Login Error:', loginResponse);
            throw new Error('Login Error');
        }
        if(loginResponse.device && loginResponse.device.device_id) {
            globalState.setDeviceId(loginResponse.device.device_id);
        } else {
            console.error('Login Error:', loginResponse);
            throw new Error('Login Error');
        }
        return loginResponse;
    } catch (error) {
        console.error('Login Error:', error.message);
        throw error;
    }
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

    // Validate SPA byte array
    // if (!isValidSpaByteArray(decoded)) {
    //     console.error('BWA Cloud Spa Error: Encoded data is not valid SPA panel data. Is the Spa Online?');
    //     return false;
    // }

    // Parse common data
    const is24HourTime = (decoded[13] & 2) !== 0;
    const currentTimeHour = decoded[7];
    const currentTimeMinute = decoded[8];
    const temperatureScale = (decoded[13] & 1) === 0 ? 'F' : 'C';
    const actualTemperature = temperatureScale === 'C' ? decoded[6] / 2 : decoded[6];
    const targetTemperature = temperatureScale === 'C' ? decoded[24] / 2 : decoded[24];
    const isHeating = (decoded[14] & 48) !== 0;
    const heatingMode = (decoded[14] & 4) === 4 ? 'high' : 'low';

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

    // Parsed panel data
    const panelData = {
        is24HourTime,
        currentTimeHour,
        currentTimeMinute,
        temperatureScale,
        actualTemperature,
        targetTemperature,
        isHeating,
        heatingMode,
        heatMode,
        pumpsState,
        lightsState,
        blowerState,
        misterState,
        auxState,
        wifiState
    };

    // Return the parsed panel data
    return {
        is24HourTime,
        currentTimeHour,
        currentTimeMinute,
        temperatureScale,
        actualTemperature,
        targetTemperature,
        isHeating,
        heatingMode,
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

// Function to handle the device configuration request
async function handleDeviceConfigurationRequest(deviceId) {
    const requestOptions = createRequestOptions(deviceId, 'DeviceConfiguration.txt');
    try {
        const response = await httpsRequest(requestOptions, createXmlRequestBody(deviceId, 'DeviceConfiguration.txt'));
        const decodedData = await parseDeviceConfigurationData(extractDataFromXML(response));
        console.log('Decoded Device Configuration:', decodedData);
        return decodedData;
    } catch (error) {
        console.error('Device Configuration Request Error:', error.message);
    }
}

// Function to handle the panel update request
async function handlePanelUpdateRequest(deviceId) {
    const requestOptions = createRequestOptions(deviceId, 'PanelUpdate.txt');
    try {
        const response = await httpsRequest(requestOptions, createXmlRequestBody(deviceId, 'PanelUpdate.txt'));
        if (!response) {
            console.error('No response received for panel update request');
            return {};
        }

        const extractedData = extractDataFromXML(response);
        if (!extractedData) {
            console.error('Failed to extract data from XML');
            return {};
        }

        const panelData = parsePanelData(extractedData);
        if (!panelData) {
            console.error('Failed to parse panel data');
            return {};
        }

        console.log('Panel Update Data:', panelData);
        return panelData;
    } catch (error) {
        console.error('Panel Update Request Error:', error.message);
        return {};
    }
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

    async sendCommand(buttonNumber, command) {
        const commandXml = this.buildCommandXml(buttonNumber, command);
        console.log(`Sending command: ${command} to button number: ${buttonNumber}`); // Debugging line
        console.log(`Command data: ${command}`); // Log the command data

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
            const response = await httpsRequest(requestOptions, commandXml);
            console.log('Command Response:', response);
        } catch (error) {
            console.error('Error sending command:', error);
        }
    }

    buildCommandXml(targetName, data) {
        // Construct the XML string
        const xml = `<sci_request version="1.0"><data_service><targets><device id="${this.deviceId}"/></targets><requests><device_request target_name="${targetName}">${data}</device_request></requests></data_service></sci_request>`;

        // Log the XML string for debugging
        console.log('Generated XML:', xml);

        return xml;
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
        console.error('Invalid pump number:', pumpNumber);
        return;
    }

    const currentPanelData = await handlePanelUpdateRequest(deviceId);
    if (!currentPanelData) {
        console.error('Failed to get current panel data');
        return;
    }

    const currentPumpState = currentPanelData.pumpsState[`Pump${pumpNumber}`];
    if ((turnOn && currentPumpState === 'off') || (!turnOn && currentPumpState !== 'off')) {
        const spaControl = new SpaControl(deviceId);
        if (turnOn) {
            await spaControl.turnOn(buttonNumber);
        } else {
            await spaControl.turnOff(buttonNumber);
        }
    } else {
        console.log(`Pump ${pumpNumber} is already in the desired state.`);
    }
}

//Update the lights
async function updateLightStatus(deviceId, lightNumber, turnOn) {
    const lightButtonMap = {
        1: 17, // Light 1 maps to Balboa API Button #17
        2: 18 // Light 2 maps to Balboa API Button #18
    };

    const buttonNumber = lightButtonMap[lightNumber];
    if (buttonNumber === undefined) {
        console.error('Invalid light number:', lightNumber);
        return;
    }

    const currentPanelData = await handlePanelUpdateRequest(deviceId);
    if (!currentPanelData) {
        console.error('Failed to get current panel data');
        return;
    }

    const currentLightState = currentPanelData.lightsState[`Light${lightNumber}`];
    if ((turnOn && currentLightState === 'off') || (!turnOn && currentLightState !== 'off')) {
        const spaControl = new SpaControl(deviceId);
        if (turnOn) {
            await spaControl.turnOn(buttonNumber);
        } else {
            await spaControl.turnOff(buttonNumber);
        }
    } else {
        console.log(`Light ${lightNumber} is already in the desired state.`);
    }
}

//Update the AUX
async function updateAuxStatus(deviceId, auxNumber, turnOn) {
    const auxButtonMap = {
        1: 22, // Aux 1 maps to Balboa API Button #22
        2: 23 // Aux 2 maps to Balboa API Button #23
    };

    const buttonNumber = auxButtonMap[auxNumber];
    if (buttonNumber === undefined) {
        console.error('Invalid auxiliary number:', auxNumber);
        return;
    }

    const currentPanelData = await handlePanelUpdateRequest(deviceId);
    if (!currentPanelData) {
        console.error('Failed to get current panel data');
        return;
    }

    const currentAuxState = currentPanelData.auxState[`Aux${auxNumber}`];
    if ((turnOn && currentAuxState === 'off') || (!turnOn && currentAuxState !== 'off')) {
        const spaControl = new SpaControl(deviceId);
        if (turnOn) {
            await spaControl.turnOn(buttonNumber);
        } else {
            await spaControl.turnOff(buttonNumber);
        }
    } else {
        console.log(`Aux ${auxNumber} is already in the desired state.`);
    }
}

//Update Blower
async function updateBlowerStatus(deviceId, turnOn) {
    const blowerButtonNumber = 12; // Blower maps to Balboa API Button #12

    const currentPanelData = await handlePanelUpdateRequest(deviceId);
    if (!currentPanelData) {
        console.error('Failed to get current panel data');
        return;
    }

    const currentBlowerState = currentPanelData.blowerState;
    if ((turnOn && currentBlowerState === 'off') || (!turnOn && currentBlowerState !== 'off')) {
        const spaControl = new SpaControl(deviceId);
        if (turnOn) {
            await spaControl.turnOn(blowerButtonNumber);
        } else {
            await spaControl.turnOff(blowerButtonNumber);
        }
    } else {
        console.log('Blower is already in the desired state.');
    }
}

//Update Mister status
async function updateMisterStatus(deviceId, turnOn) {
    const misterButtonNumber = 14; // Mister maps to Balboa API Button #14

    const currentPanelData = await handlePanelUpdateRequest(deviceId);
    if (!currentPanelData) {
        console.error('Failed to get current panel data');
        return;
    }

    const currentMisterState = currentPanelData.misterState;
    if ((turnOn && currentMisterState === 'off') || (!turnOn && currentMisterState !== 'off')) {
        const spaControl = new SpaControl(deviceId);
        if (turnOn) {
            await spaControl.turnOn(misterButtonNumber);
        } else {
            await spaControl.turnOff(misterButtonNumber);
        }
    } else {
        console.log('Mister is already in the desired state.');
    }
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

    if (!currentPanelData) {
        console.error('Failed to get current panel data');
        return;
    }

    const currentTempRangeState = currentPanelData.heatingMode.toLowerCase();
    console.log(`Current state: ${currentTempRangeState}, Set to high: ${setToHigh}`);

    // Explicitly check for 'low' or 'high' to ensure case-insensitive comparison
    if (setToHigh && (currentTempRangeState === 'low' || override)) {
        const spaControl = new SpaControl(deviceId);
        await spaControl.sendCommand('Button', tempRangeButtonNumber.toString());
        console.log(`Temperature range set to high`);
    } else if (!setToHigh && (currentTempRangeState === 'high' || override)) {
        const spaControl = new SpaControl(deviceId);
        await spaControl.sendCommand('Button', tempRangeButtonNumber.toString());
        console.log(`Temperature range set to low`);
    } else {
        console.log(`Temperature range is already set to ${currentTempRangeState}`);
    }
}

/// Function to update the heat mode
async function updateHeatMode(deviceId, setToReady) {
    const heatModeButtonNumber = BUTTON_MAP.HeatMode; // HeatMode button number from a map
    const currentPanelData = await handlePanelUpdateRequest(deviceId);

    if (!currentPanelData) {
        console.error('Failed to get current panel data');
        return;
    }

    const currentHeatModeState = currentPanelData.heatMode;
    // Corrected logic: Toggle state only if not in the desired state
    if ((setToReady && currentHeatModeState !== 'Ready') || (!setToReady && currentHeatModeState !== 'Rest')) {
        const spaControl = new SpaControl(deviceId);
        await spaControl.sendCommand('Button', heatModeButtonNumber.toString());
        console.log(`Heat mode set to ${setToReady ? 'Ready' : 'Rest'}`);
    } else {
        console.log(`Heat mode is already set to ${currentHeatModeState}`);
    }
}

//Set the temp of the spa
async function updateTemperature(deviceId, newTemperature) {
    const currentPanelData = await handlePanelUpdateRequest(deviceId);
    if (!currentPanelData) {
        console.error('Failed to get current panel data');
        return;
    }

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
    console.log(`Temperature update command sent: ${newTemperature}${temperatureScale} (Converted: ${convertedTemperature})`);
}

async function bwaCommand(action, stateValue = 'off') {
    try {
        // Login and acquire a token.
        // await loginAndGetToken('user', 'pass');

        // Check if the token and device ID are available.
        if (!globalState.token || !globalState.device_id) {
            console.log('Login failed or did not return the expected data.');
            return;
        }

        // Use a switch statement to handle different actions
        switch (action) {
            case 'configureDevice':
                // Handle device configuration requests.
                return await handleDeviceConfigurationRequest(globalState.device_id);

            case 'updatePanel':
                // Handle panel update requests.
                return await handlePanelUpdateRequest(globalState.device_id);

            case 'turnOnPump1':
                // Update pump statuses based on stateValue ('on' or 'off').
                return await updatePumpStatus(globalState.device_id, 1, stateValue === 'on');

            case 'turnOnPump2':
                // Update pump statuses based on stateValue ('on' or 'off').
                return await updatePumpStatus(globalState.device_id, 2, stateValue === 'on');

            case 'turnOnLight':
                // Update light statuses based on stateValue ('on' or 'off').
                return await updateLightStatus(globalState.device_id, 1, stateValue === 'on');

            case 'turnOnBlower':
                // Update blower status based on stateValue ('on' or 'off').
                return await updateBlowerStatus(globalState.device_id, stateValue === 'on');

            case 'updateHeatMode':
                // Determine the heat mode setting based on stateValue
                let setHeatMode;
                switch (stateValue) {
                    case 'Ready':
                    case 'Ready in Rest':
                        setHeatMode = true;
                        break;
                    case 'Rest':
                        setHeatMode = false;
                        break;
                    default:
                        console.log(`Unknown stateValue: ${stateValue}`);
                        return; // Exit if stateValue is not recognized
                }

                // Update heat mode if stateValue is recognized
                return await updateHeatMode(globalState.device_id, setHeatMode);

            case 'updateTemperatureRange':
                // Update temperature settings based on stateValue ('High' or 'Low').
                const ToHigh = stateValue === 'High';

                return await updateTemperatureRange(globalState.device_id, ToHigh);

            case 'updateTemperature':
                // Update Target temperature to new temprature.
                return await updateTemperature(globalState.device_id, stateValue);

            default:
                // Handle invalid decision parameters.
                console.log('Invalid decision parameter.');
                break;
        }
    } catch (error) {
        // Catch and log any errors that occur during execution.
        console.error('Main Function Error:', error.message);
    }
}

// Example call to the main function with a decision string.
// bwaCommand('updatePanel', 'off');
// bwaCommand('configureDevice', 'off');

module.exports = { handleDeviceConfigurationRequest, handlePanelUpdateRequest, loginAndGetToken, updatePumpStatus, updateBlowerStatus, updateLightStatus, updateTemperature, updateTemperatureRange, updateHeatMode };
