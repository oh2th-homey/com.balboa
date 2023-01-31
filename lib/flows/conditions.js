exports.init = async function (homey) {
    const condition_ONLINE = homey.flow.getConditionCard('condition_ONLINE')
    condition_ONLINE.registerRunListener( async (args, state) =>  {
       homey.app.log('[condition_ONLINE]', state, {...args, device: 'LOG'});
       return await args.device.getCapabilityValue(`measure_online`) === true;
    });

    const condition_LIGHT = homey.flow.getConditionCard('condition_LIGHT')
    condition_LIGHT.registerRunListener( async (args, state) =>  {
       homey.app.log('[condition_LIGHT]', state, {...args, device: 'LOG'});
       return await args.device.getCapabilityValue(`action_light_state`) === true;
    });

    const condition_HEATER = homey.flow.getConditionCard('condition_HEATER')
    condition_HEATER.registerRunListener( async (args, state) =>  {
       homey.app.log('[condition_HEATER]', state, {...args, device: 'LOG'});
       return await args.device.getCapabilityValue(`action_heater_mode`) === true;
    });

    const condition_RUNMODE = homey.flow.getConditionCard('condition_RUNMODE')
    condition_RUNMODE.registerRunListener( async (args, state) =>  {
       homey.app.log('[condition_RUNMODE]', state, {...args, device: 'LOG'});
       return await args.device.getCapabilityValue(`measure_runmode`) === true;
    });


    const condition_HEATER_STATE = homey.flow.getConditionCard('condition_HEATER_state')
    condition_HEATER_STATE.registerRunListener( async (args, state) =>  {
       homey.app.log('[condition_HEATER_STATE]', state, {...args, device: 'LOG'});
       return await args.device.getCapabilityValue(`measure_heater`) === true;
    });

    const condition_pump_state = homey.flow.getConditionCard('condition_pump_state');
    condition_pump_state.registerRunListener(async (args, state) => {
        homey.app.log('[condition_pump_state]', state, {...args, device: 'LOG'});
       return await args.device.getCapabilityValue(`condition_pump_state`) === true;
    });
    
    const condition_pump_state_1 = homey.flow.getConditionCard('condition_pump_state_1');
    condition_pump_state_1.registerRunListener(async (args, state) => {
        homey.app.log('[condition_pump_state_1]', state, {...args, device: 'LOG'});
        return await args.device.getCapabilityValue(`condition_pump_state.1`) === true;
    });

    const condition_pump_state_2 = homey.flow.getConditionCard('condition_pump_state_2');
    condition_pump_state_2.registerRunListener(async (args, state) => {
        homey.app.log('[condition_pump_state_2]', state, {...args, device: 'LOG'});
        return await args.device.getCapabilityValue(`condition_pump_state.2`) === true;
    });

    const condition_blower_state = homey.flow.getConditionCard('condition_blower_state');
    condition_blower_state.registerRunListener(async (args, state) => {
        homey.app.log('[condition_blower_state]', state, {...args, device: 'LOG'});
       return await args.device.getCapabilityValue(`condition_blower_state`) === true;
    });
    
    const condition_blower_state_1 = homey.flow.getConditionCard('condition_blower_state_1');
    condition_blower_state_1.registerRunListener(async (args, state) => {
        homey.app.log('[condition_blower_state_1]', state, {...args, device: 'LOG'});
        return await args.device.getCapabilityValue(`condition_blower_state.1`) === true;
    });

    const condition_blower_state_2 = homey.flow.getConditionCard('condition_blower_state_2');
    condition_blower_state_2.registerRunListener(async (args, state) => {
        homey.app.log('[condition_blower_state_2]', state, {...args, device: 'LOG'});
        return await args.device.getCapabilityValue(`condition_blower_state.2`) === true;
    });
};
