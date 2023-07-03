import {
  AccessoryPlugin,
  HAP,
  Logging,
  Service,
} from 'homebridge';
import {TPLinkAccessControlPlatform} from './platform';
import TPLink from './tplinkApi';

export class TPLinkDevice implements AccessoryPlugin {
  private readonly log: Logging;
  private switchOn = true; // show as on in HomeKit by default when starting up
  name: string;
  macAddress: string;
  private readonly tpLink: TPLink;
  hap: HAP;
  private readonly switchService: Service;
  private readonly informationService: Service;

  constructor(
    private readonly platform: TPLinkAccessControlPlatform,
    log: Logging,
    name: string,
    macAddress: string,
  ) {
    this.platform = platform;
    this.hap = platform.api.hap;
    this.log = log;
    this.name = name;
    this.macAddress = macAddress;
    this.tpLink = this.platform.tplink;
    this.switchService = new this.hap.Service.Switch(name);
    this.switchService.getCharacteristic(this.hap.Characteristic.On)
      .onGet(async () => {
        // return cached state instantly then update the switch as soon as we have the info from the router.
        const getStatus = async () => { // This function will run in the background and update the switch state when it is done.
          try {
            const isLoggedIn = await this.tpLink.getLoggedInStatus();
            if (!isLoggedIn) {
              if (!this.tpLink.loggingIn) {
                this.log.debug('Not logged in, attempting to log in.');
              }
              await this.tpLink.connect();
            }
            const blockedDevices = await this.tpLink.getBlockedDevices();
            const blocked = blockedDevices.includes(this.macAddress);
            this.switchOn = !blocked;  // If the device is blocked, the switch should be off.
            this.switchService.getCharacteristic(this.hap.Characteristic.On).updateValue(this.switchOn);
            this.log.debug(`${this.name} was returned to .onGet as ${this.switchOn}.`);
          } catch (error) {
            this.log.error('Error from onGet: ', error);
          }
        };
        getStatus(); // call the function to get the status in the background
        return this.switchOn; //return cached state instantly
      })
      .onSet(async (value) => {
        const setStatus = async () => { // This function will run in the background and update the switch state when it is done.
          try {
            const isLoggedIn = await this.tpLink.getLoggedInStatus();
            if (!isLoggedIn) {
              await this.tpLink.connect();
            }
            if (value) { // if the device is being turned on
              await this.tpLink.unblockDevice(this.macAddress);
              this.log.debug(`${this.name}(${this.macAddress}) was unblocked.`);
              this.switchOn = value as boolean; // update the switch state
              this.switchService.getCharacteristic(this.hap.Characteristic.On).updateValue(this.switchOn);
            } else { // else the device is being turned off
              await this.tpLink.blockDevice(this.macAddress);
              this.log.debug(`${this.name}(${this.macAddress}) was blocked.`);
              this.switchOn = value as boolean; // update the switch state
              this.switchService.getCharacteristic(this.hap.Characteristic.On).updateValue(this.switchOn);
            }
          } catch (error) {
            this.log.error(`Error setting ${this.name}(${this.macAddress}): `, error);
          }
        };
        setStatus(); // call the function to set the status in the background
        return; // return instantly
      });
    this.informationService = new this.hap.Service.AccessoryInformation()
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'TP-Link')
      .setCharacteristic(this.hap.Characteristic.Model, 'TP-Link Router')
      .setCharacteristic(this.hap.Characteristic.SerialNumber, this.macAddress);
    this.log.debug('Device \'%s\' created!', name);
  }

  /*
   * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
   * Typical this only ever happens at the pairing process.
   */
  identify(): void {
    this.log('Identify!');
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [
      this.informationService,
      this.switchService,
    ];
  }

}
