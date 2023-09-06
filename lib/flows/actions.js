exports.init = async function (homey) {
    const action_update_data = homey.flow.getActionCard('action_update_data_flow');
    action_update_data.registerRunListener(async (args, state) => {
        await args.device.onCapability_UPDATE_DATA(true);
    });

    const action_pump_state = homey.flow.getActionCard('action_pump_state_flow');
    action_pump_state.registerRunListener(async (args, state) => {
        await args.device.onCapability_ACTION({'action_pump_state': !!parseInt(args.action_on_off)});
    });
    
    const action_pump_state_1 = homey.flow.getActionCard('action_pump_state_flow_1');
    action_pump_state_1.registerRunListener(async (args, state) => {
        await args.device.onCapability_ACTION({'action_pump_state.1': !!parseInt(args.action_on_off)});
    });

    const action_pump_state_2 = homey.flow.getActionCard('action_pump_state_flow_2');
    action_pump_state_2.registerRunListener(async (args, state) => {
        await args.device.onCapability_ACTION({'action_pump_state.2': !!parseInt(args.action_on_off)});
    });

    const action_light_state = homey.flow.getActionCard('action_light_state_flow');
    action_light_state.registerRunListener(async (args, state) => {
        await args.device.onCapability_ACTION({'action_light_state': !!parseInt(args.action_on_off)});
    });

    const action_blower_state = homey.flow.getActionCard('action_blower_state_flow');
    action_blower_state.registerRunListener(async (args, state) => {
        await args.device.onCapability_ACTION({'action_blower_state': !!parseInt(args.action_on_off)});
    });

    const action_blower_state_1 = homey.flow.getActionCard('action_blower_state_flow_1');
    action_blower_state_1.registerRunListener(async (args, state) => {
        await args.device.onCapability_ACTION({'action_blower_state.1': !!parseInt(args.action_on_off)});
    });

    const action_blower_state_2 = homey.flow.getActionCard('action_blower_state_flow_2');
    action_blower_state_2.registerRunListener(async (args, state) => {
        await args.device.onCapability_ACTION({'action_blower_state.2': !!parseInt(args.action_on_off)});
    });

    const action_heater_mode = homey.flow.getActionCard('action_heater_mode_flow');
    action_heater_mode.registerRunListener(async (args, state) => {
        await args.device.onCapability_ACTION({'action_heater_mode': !!parseInt(args.action_on_off)});
    });

    const action_temp_range = homey.flow.getActionCard('action_temp_range_flow');
    action_temp_range.registerRunListener(async (args, state) => {
        await args.device.onCapability_ACTION({'action_temp_range': !!parseInt(args.action_temp_range)});
    });

    const action_heater_mode_on_flow = homey.flow.getActionCard('action_heater_mode_on_flow');
    action_heater_mode_on_flow.registerRunListener(async (args, state) => {
        await args.device.onCapability_ACTION({'action_heater_mode': true});
    });

    const action_heater_mode_off_flow = homey.flow.getActionCard('action_heater_mode_off_flow');
    action_heater_mode_off_flow.registerRunListener(async (args, state) => {
        await args.device.onCapability_ACTION({'action_heater_mode': false});
    });
};