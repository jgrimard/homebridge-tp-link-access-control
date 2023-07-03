import {
  AccessoryPlugin,
  API,
  Logging,
  PlatformConfig,
  StaticPlatformPlugin,
} from 'homebridge';
import {TPLinkDevice} from './switch-accessory';
import TPLink from './tplinkApi';

export class TPLinkAccessControlPlatform implements StaticPlatformPlugin {
  public readonly tplink: TPLink;
  private connected = false;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.tplink = new TPLink(this.config.ipAddress, this.config.password, this.log);
  }

  // initialize the connection to the TP Link router
  async init(): Promise<void> {
    if (!this.config) {
      throw new Error('Config is missing for this plugin, disabling plugin.');
    }
    if (!this.config.ipAddress || !this.config.password) {
      throw new Error('Config is missing IP address or Password, disabling plugin.');
    }
    this.connected = await this.tplink.connect();
    if (!this.connected) {
      throw new Error('Could not connect to TP Link router. Exiting.');
    } else {
      this.log.info('Connected to TP Link router.');
    }
  }

  // This callback method is called when Homebridge is finished loading.
  // It will initialize API and load all devices from the config file
  async accessories(callback: (foundAccessories: AccessoryPlugin[]) => void): Promise<void> {
    try {
      await this.init();
    } catch(error){
      if (error instanceof Error) {
        this.log.error('Initialization Error. Exiting.: ', error.message);
        if (error.stack) {
          this.log.debug(error.stack);
        }
        callback([]);// return an empty array to to the callback to stop this plugin so Homebridge doesn't crash.
        return;
      }
    }
    if (!this.config.devices || this.config.devices.length === 0) {
      this.log.error('No devices configured. Exiting.');
      callback([]);
      return;
    }
    // retrieve list of devices from Plugin's config
    const deviceArray: AccessoryPlugin[] = [];
    for (const device of this.config.devices) {
      this.log.debug('Adding accessory from config: ', device.name + ' ' + device.mac);
      deviceArray.push(new TPLinkDevice(this, this.log, device.name, device.mac));
    }
    // array of all devices to add to homebridge
    callback(deviceArray);
  }
}