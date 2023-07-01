
<p align="center">
<img src="./images/Homebridge%20TP-Link%20Logo.png" width="450">
</p>

<span align="center">

# Homebridge-TP-Link-Access-Control

Homebridge plugin to integrate TP-Link Access Control into HomeKit

[![npm](https://img.shields.io/npm/v/homebridge-tp-link-access-control/latest?label=latest)](https://www.npmjs.com/package/homebridge-tp-link-access-control)
[![npm](https://img.shields.io/npm/dt/homebridge-tp-link-access-control)](https://www.npmjs.com/package/homebridge-tp-link-access-control)
![GitHub issues](https://img.shields.io/github/issues/jgrimard/homebridge-tp-link-access-control)
![GitHub top language](https://img.shields.io/github/languages/top/jgrimard/homebridge-tp-link-access-control)

</span>

### Plugin Information

- This plugin allows you to view and control network access to devices connected to your TP-Link router within HomeKit.
- It is great for parents who want to control their children's access to the internet either manually or on a schedule.
  - iPads, tablets, Fire TV sticks, etc. can be disabled or enabled on a schedule to limit screen time.
- Tested and working with the following routers:
  - Archer AX6000 v1.0 - FW: 1.3.0 Build 20221208 rel.45145(5553)
  - Archer C2300 v2.0 - FW: 1.1.1 Build 20200918 rel.67850(4555)



### Prerequisites

- To use this plugin, you will need to already have:
  - [Node](https://nodejs.org): Latest version of Node: `v18` or `v20`.
  - [Homebridge](https://homebridge.io): `v1.6.1` - refer to link for more information and installation instructions.

### Setup

- UI Installation (Recommended):
  - Install the plugin by searching for `TP-Link Access Control` in the Homebridge UI
  - Click on settings for the plugin and enter the following:
    - Router IP address
    - Local Password for the router
  - Add Devices to control
    - Name: Name of the device to be displayed in HomeKit
    - MAC Address: MAC address of the device to be controlled (use - as separator)
    - Click `Add Device` to add additional devices to the list
  - Click `Save` to save the settings
  - Restart Homebridge

- Manual Installation (Optional, for installation without UI):
  - Install the plugin by running `npm install -g homebridge-tp-link-access-control`
  - Add the following to the `platforms` section of your Homebridge `config.json` file:

  ```json
  {
      "platform": "tp-link-access-control",
      "ipAddress": "192.168.1.1",
      "password": "my-secret-password",
      "devices": [
          {
              "name": "Kid's Tablet",
              "mac": "70-2E-BC-DA-44-8B"
          },
          {
              "name": "Son's iPad",
              "mac": "7C-24-99-5D-3A-AC"
          },
          {
              "name": "Bedroom Fire Stick",
              "mac": "5C-41-5A-AD-81-BD"
          }
      ]
  }
  ```
  - Restart Homebridge.



### Credits

- To [@Electry](https://github.com/Electry/TPLink-C2300-APIClient) who developed the python TPLink-C2300-APIClient. It gave me a great starting point for the API of this plugin.

- To the creators and contributors of [Homebridge](https://homebridge.io) who make this plugin possible.

### Disclaimer

- I am not affiliated with TP-Link and this plugin is a personal project that I maintain in my free time.
- Use this plugin entirely at your own risk - please see licence for more information.