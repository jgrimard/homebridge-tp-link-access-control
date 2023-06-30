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

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.tplink = new TPLink(this.config.ipAddress, this.config.password, log);
    this.api.on('didFinishLaunching', () => {
      this.init().then(() => {  // call init() to set up the connection to the TP Link router
        this.log.info('TP Link Access Control Platform finished initializing.');
      });
    },
    );
  }

  // initialize the connection to the TP Link router
  async init(): Promise<void> {
    try {
      const connected = await this.tplink.connect();
      if (!connected) {
        this.log.error('Could not connect to TP Link router. Exiting.');
        return;
      } else {
        this.log.debug('Connected to TP Link router.');
      }
    } catch (e) {
      this.log.error('Error connecting to TP Link router: ', e);
      return;
    }
  }

  // This callback method is called when Homebridge is finished loading.  It will add all devices from the config file
  accessories(callback: (foundAccessories: AccessoryPlugin[]) => void): void {
    if (!this.config.devices || this.config.devices.length === 0) {
      this.log.error('No devices configured. Exiting.');
      return;
    }
    // retrieve list of devices from Plugin's config
    const deviceArray: AccessoryPlugin[] = [];
    for (const device of this.config.devices) {
      this.log.debug('Adding new accessory: ', device.name + ' ' + device.mac);
      deviceArray.push(new TPLinkDevice(this, this.log, device.name, device.mac));
    }
    // array of all devices to add to homebridge
    callback(deviceArray);
  }
}