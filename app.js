"use strict";

const Homey = require("homey");
const flowActions = require('./lib/flows/actions');
const flowConditions = require('./lib/flows/conditions');

class App extends Homey.App {
  async onInit() {
    this.log(`${this.homey.manifest.id} v${this.homey.manifest.version} started`);

    await flowActions.init(this.homey);
    await flowConditions.init(this.homey);
  }
}

module.exports = App;
