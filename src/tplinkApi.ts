/* eslint-disable @typescript-eslint/no-explicit-any */
//
//TP-Link API by Jason Grimard 2023
//Tested and working with Archer AX6000
//Based on prior API work by Michal Chvila
//

import * as crypto from 'crypto';
import { Logger } from 'homebridge';
import forge from 'node-forge';
import fetch from 'node-fetch';
import { AbortSignal } from 'node-fetch/externals';

export default class TPLink {
  private HEADERS = { //default headers for all requests
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'User-Agent': 'Homebridge TP-Link Access Control',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
  };

  private token: string; // stok token from router
  private rsaKeyPw: string[] = []; // (n, e) RSA public key from router for encrypting the password
  private rsaKeyAuth: string[] = []; // (n, e, seq) RSA public key from router for encrypting signature
  private md5HashPw: string; // md5 of username and password, used to sign data, not login
  private aesKey: string[] = []; // random AES key for encrypting the body of the request and decrypting the response
  private cookies: string[] = []; // cookies from login response
  public loggingIn: boolean; // true if currently logging in, false if not

  constructor(
    private readonly ip: string,
    private readonly password: string,
    private readonly log: Logger,
  ) {
    this.ip = ip;
    this.password = password;
    this.token = '';
    this.md5HashPw = '';
    this.loggingIn = false;
  }

  // Create URL from ip address, endpoint, form, and STOK token
  private getURL(endpoint: string, form: string): string {
    this.log.debug('Returning url: ' + `http://${this.ip}/cgi-bin/luci/;stok=${this.token}/${endpoint}?form=${form}`);
    return `http://${this.ip}/cgi-bin/luci/;stok=${this.token}/${endpoint}?form=${form}`;
  }

  public async connect(): Promise<boolean> {
    if (this.loggingIn) {
      this.log.debug('Already logging in, waiting for login to complete');
      // wait for login to complete before returning
      // if this takes more than 10 seconds, something is wrong and we should change the loggingIn flag to false
      let count = 0;
      while (this.loggingIn) {
        //sleep for 100ms
        await new Promise((resolve) => setTimeout(resolve, 100));
        count++;
        if (count > 100) {
          this.log.error('Error logging in, login is taking too long');
          this.loggingIn = false;
          return Promise.reject('Error logging in, login is taking too long');
        }
      }
      return true;
    }
    this.loggingIn = true;
    this.token = ''; // clear the token
    // hash the username and password. The username is always admin
    this.md5HashPw = this.hashPw('admin', this.password);
    // get the public rsa key for encrypting the password
    this.rsaKeyPw = await this.getRSAPublicKeyPassword();
    // get the public rsa key for encrypting the auth token / signature
    this.rsaKeyAuth = await this.getRSAPublicKeyAuth();
    // generate random AES key
    this.aesKey = this.generateAESKey();
    // encrypt the password
    const encryptedPassword = this.encryptPassword(this.password);
    // authenticate and get the auth token
    try {
      this.token = await this.login(encryptedPassword);
      // this.log.debug('Successfully connected to TPLink, token: ' + this.token);
    } catch (error) {
      this.loggingIn = false;
      throw error;
    }
    this.loggingIn = false;
    return true;
  }

  // NOT CURRENTLY USED IN PLUGIN
  public async logout(): Promise<boolean> {
    const url = this.getURL('admin/system', 'logout');
    const data = {
      'operation': 'write',
    };
    const response = await this.request(url, data, true);
    if (response.success === true) {
      this.log.debug('Successfully logged out of TPLink');
      return true;
    } else {
      this.log.error('Error logging out of TPLink', response);
      return false;
    }
  }

  // NOT CURRENTLY USED IN PLUGIN
  // get list of connected devices that are available to block
  public async getConnectedDevices(): Promise<string[]> {
    const url = this.getURL('admin/access_control', 'black_devices');
    const data = {
      'operation': 'load',
    };
    const response = await this.request(url, data, true);
    if (response.success === true) {
      const devices: string[] = [];
      if (Object.keys(response.data).length > 0) { // test for empty object
        for (const device of response.data) {
          devices.push(`${device.mac} - ${device.name}`);
        }
      } else {  // no connected devices return an empty array
        this.log.info('No connected devices found');
      }
      return devices;
    } else {
      throw new Error('Error getting connected devices: ' + JSON.stringify(response));
    }
  }

  // get list of blocked devices return mac address only.  Index is used when unblocking devices.
  public async getBlockedDevices(): Promise<string[]> {
    const url = this.getURL('admin/access_control', 'black_list');
    const data = {
      'operation': 'load',
    };
    const response = await this.request(url, data, true);
    if (response.success === true) {
      const devices: string[] = [];
      if (Object.keys(response.data).length > 0) { // test for empty object
        for (const device of response.data) {
          this.log.debug(`Found blocked device named ${device.name} with mac address ${device.mac}`);
          devices.push(device.mac);
        }
      }
      return devices;
    } else {
      throw new Error('Error getting blocked devices: ' + JSON.stringify(response));
    }
  }

  // block device by mac address
  public async blockDevice(macAddress: string): Promise<boolean> {
    const url = this.getURL('admin/access_control', 'black_devices');
    const deviceData = {
      'mac': macAddress,
      'host': 'NOT HOST',
    };
    // TP-Link uses a weird encoding for the device data
    let deviceDataJson = JSON.stringify(deviceData);
    // wrap device data json in square brackets
    deviceDataJson = '[' + deviceDataJson + ']';
    const encodedDeviceData = encodeURIComponent(deviceDataJson);
    const data = {
      'operation': 'block',
      'data': [encodedDeviceData],
    };
    const response = await this.request(url, data, true);
    if (response.success === true) {
      this.log.info(`Successfully blocked device with mac address ${macAddress}`);
    } else {
      this.log.error('Error blocking device', response);
      return Promise.reject('Error blocking device');
    }
    return true;
  }

  // unblock device by mac address
  public async unblockDevice(macAddress: string): Promise<boolean> {
    const url = this.getURL('admin/access_control', 'black_list');
    const blockedDevices = await this.getBlockedDevices();
    const index = blockedDevices.indexOf(macAddress);
    if (index > -1) {
      const data = {
        'key': 'anything',
        'index': index.toString(),
        'operation': 'remove',
      };
      const response = await this.request(url, data, true);
      if (response.success === true) {
        this.log.info(`Successfully unblocked device with mac address ${macAddress}`);
        return true;
      } else {
        this.log.error('Error unblocking device', response);
        return Promise.reject('Error unblocking device');
      }
    } else {
      this.log.debug(`Device with mac address ${macAddress} not found in blocked devices`);
      return false;
    }
  }

  // NOT CURRENTLY USED IN PLUGIN
  // get LED status
  public async getLEDStatus(): Promise<boolean> {
    const url = this.getURL('admin/ledgeneral', 'setting');
    const data = {
      'operation': 'read',
    };
    const response = await this.request(url, data, true);
    if (response.success === true) {
      return Promise.resolve(response.data.enable === 'on');
    } else {
      this.log.error('Error getting LED status', response);
      return Promise.reject('Error getting LED status');
    }
  }

  // get Login Status (uses same as getLEDStatus to test)
  public async getLoggedInStatus(): Promise<boolean> {
    const url = this.getURL('admin/ledgeneral', 'setting');
    const data = {
      'operation': 'read',
    };
    const response = await this.request(url, data, true);
    if (response.success === true) {
      return true;
    } else {
      return false;
    }
  }

  // NOT CURRENTLY USED IN PLUGIN
  // set LED status true = on, false = off
  // router only allows toggling, so we need to get the current status first
  public async setLEDStatus(status: boolean): Promise<boolean> {
    this.log.debug('Setting LED status to ' + status);
    const currentStatus = await this.getLEDStatus();
    if (currentStatus !== status) {
      const url = this.getURL('admin/ledgeneral', 'setting');
      const data = {
        'operation': 'write',
        'led_status': 'toggle',
      };
      const response = await this.request(url, data, true);
      if (response.success === true) {
        return Promise.resolve(true);
      } else {
        this.log.error('Error getting LED status', response);
        return Promise.reject('Error getting LED status');
      }
    } else {
      this.log.info('LED status is already ' + status);
      return Promise.resolve(true);
    }
  }

  // login to the router
  // return value: (stok token) token for authentication
  private async login(encryptedPassword: string, forceLogin = true): Promise<string> {
    const url = this.getURL('login', 'login');
    const data = {
      'operation': 'login',
      'password': encryptedPassword,
    };
    if (forceLogin) {
      data['confirm'] = 'true';
    }
    const response = await this.request(url, data, true, true);
    if (response.success === true) {
      return response.data.stok;
    } else {
      throw new Error(`Login Error (Probably wrong password): ${JSON.stringify(response.data)}`);
    }
  }

  // Returns an object containing the response.data from the router
  async request(url: string, data: any, encrypt = false, isLogin = false): Promise<any> {
    let formData: any;
    if (encrypt) { // encrypt the body data
      const dataStr = this.formatBodyToEncrypt(data);
      //generate AES cipher
      if (this.aesKey === undefined) {
        this.log.error('AES key not found');
      }
      const aesEncryptor = forge.cipher.createCipher('AES-CBC', this.aesKey[0]);
      aesEncryptor.start({iv: this.aesKey[1]});
      aesEncryptor.update(forge.util.createBuffer(dataStr, 'utf8'));
      aesEncryptor.finish();
      // encrypt the body
      const encryptedData = aesEncryptor.output;
      // encode encrypted binary data to base64
      const encryptedDataStr = forge.util.encode64(encryptedData.getBytes());
      // get encrypted signature
      const signature = this.getSignature(encryptedDataStr.length, isLogin);
      // signature needs to go first in the form
      formData = {
        'sign': signature,
        'data': encryptedDataStr,
      };
    } else { // not encrypted, just send the body data
      formData = data;
    }
    const bodyParams = new URLSearchParams();
    for (const key in formData) {
      bodyParams.append(key, formData[key]);
    }
    // add cookies to temp headers.  Don't append to this.HEADERS
    const tempHeaders = this.HEADERS;
    if (this.cookies !== undefined) {
      let cookieStr = '';
      for (const cookieName in this.cookies) {
        cookieStr += cookieName + '=' + this.cookies[cookieName] + '; ';
      }
      tempHeaders['Cookie'] = cookieStr;
    }
    // setup abortcontroller to limit fetch requests to 5 seconds
    const timeoutTime = 5000;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutTime);
    // send request
    let responseText = '';
    let response: any;
    try {
      response = await fetch(url, {
        method: 'post',
        body: bodyParams,
        headers: this.HEADERS,
        signal: abortController.signal as AbortSignal,
      });
      responseText = await response.text(); //need text first incase response is not JSON, since we can only use once.
      clearTimeout(timeoutId); // clear timeout after receiving response
    } catch(error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out, verify IP address of router.');
      } else if (error.code === 'EHOSTUNREACH') {
        throw new Error('Verify the IP address of your router. ' + error.message);
      } else {
        throw error;
      }
    }
    let responseData;
    try { // try to parse json
      responseData = JSON.parse(responseText);
    } catch (error) { // if JSON.parse fails, create a json object with the responseText in data
      this.log.debug('The response is not json, we will create an object with the responseText in data:');
      responseData = {data: responseText};
    }
    const responseCookies = response.headers.raw()['set-cookie'];
    // this.log.debug('Received response from TPLink', responseData);
    // parse cookies
    if (responseCookies !== undefined) {
      // this.log.debug('Received cookies from TPLink', responseCookies);
      for (const cookie of responseCookies) {
        const cookieName = cookie.split('=')[0];
        const cookieValue = cookie.split('=')[1].split(';')[0]; // remove anything after the first ';'
        this.cookies[cookieName] = cookieValue;
      }
    }
    if (encrypt) { // decrypt the response
      // decode base64 string from response
      const encryptedResponseData = forge.util.decode64(responseData.data);
      // decrypt the response using our AES key
      const aesDecryptor = forge.cipher.createDecipher('AES-CBC', this.aesKey[0]);
      aesDecryptor.start({iv: this.aesKey[1]});
      aesDecryptor.update(forge.util.createBuffer(encryptedResponseData));
      aesDecryptor.finish();
      const responseStr = aesDecryptor.output.toString();
      try { // try to parse the response as json
        return JSON.parse(responseStr);
      } catch (error) { // if it fails, return the response as an object with data
        this.log.debug('Response is not json, returning as an object with data:');
        return {data: responseStr};
      }
    } else { // not encrypted, just return the responseData
      return responseData;
    }
  }

  // concatinates a variable number of strings and return md5 hash
  private hashPw(...args: string[]): string {
    let result = '';
    for (const arg of args) {
      result += arg;
    }
    return crypto.createHash('md5').update(result).digest('hex');
  }

  // get the public rsa key from the router
  // return value: (n, e) RSA public key for encrypting the password as array of two strings
  private async getRSAPublicKeyPassword(): Promise<string[]> {
    const url = this.getURL('login', 'keys');
    const data = {
      'operation': 'read',
    };
    const response = await this.request(url, data);
    if (response.success === true) {
      return response.data.password;
    } else {
      throw new Error('Error getting RSA public key for password from TPLink: ' + JSON.stringify(response));
    }
  }

  // get the public rsa key from the router
  // return value: (n, e, seq) RSA public key for encrypting the signature
  private async getRSAPublicKeyAuth(): Promise<string[]> {
    const url = this.getURL('login', 'auth');
    const data = {
      'operation': 'read',
    };
    const response = await this.request(url, data);
    if (response.success === true) {
      const authPublicKey = response.data.key;
      authPublicKey.push(response.data.seq.toString());
      // this.log.debug('Successfully got RSA public key for signature from TPLink', authPublicKey);
      return authPublicKey;
    } else {
      throw new Error('Error getting RSA public key for Auth from TPLink: ' + JSON.stringify(response));
    }
  }

  // generate a random AES key
  private generateAESKey(): string[] {
    const keyLen = 16/2;
    const IVLen = 16/2;
    const key = forge.util.bytesToHex(forge.random.getBytesSync(keyLen));
    const iv = forge.util.bytesToHex(forge.random.getBytesSync(IVLen));
    return [key, iv];
  }

  // encrypt the password using RSA public key
  private encryptPassword(password: string): string {
    const BigInteger = forge.jsbn.BigInteger;
    const modulus = new BigInteger(this.rsaKeyPw[0], 16);
    const exponent = new BigInteger(this.rsaKeyPw[1], 16);
    const publicKey = forge.pki.rsa.setPublicKey(modulus, exponent);
    const publicKeyPem = forge.pki.publicKeyToPem(publicKey);
    this.log.debug('Successfully created Password public key\n', publicKeyPem);
    // encrypt password with public key
    const encrypted = publicKey.encrypt(forge.util.encodeUtf8(password));
    const encryptedHex = forge.util.bytesToHex(encrypted);
    return encryptedHex;
  }

  // Generate encrypted signature for the request
  private getSignature(bodyDataLength: number, isLogin = false): string {
    // aesKey:         Generated pseudo-random AES key (CBC, PKCS7) [key, iv]
    // rsaKeyAuth:     RSA public key from the TP-Link API endpoint (login?form=auth) [key, iv, sequence]
    // md5HashPw:      MD5 hash of the username+password as string, only used for signing, not login
    // bodyDataLength: Gength of the encrypted body message
    // isLogin:        Set to True for login request
    let signData = '';
    if (isLogin) {
    // on login we also send our AES key, which is used for end to end encryption
      const aesKeyString = `k=${this.aesKey[0]}&i=${this.aesKey[1]}`;
      signData = `${aesKeyString}&h=${this.md5HashPw}&s=${parseInt(this.rsaKeyAuth[2]) + bodyDataLength}`;
    } else { // not login
      signData = `h=${this.md5HashPw}&s=${parseInt(this.rsaKeyAuth[2]) + bodyDataLength}`;
    }
    // encrypt signData with Auth RSA public key
    const BigInteger = forge.jsbn.BigInteger;
    const modulus = new BigInteger(this.rsaKeyAuth[0], 16);
    const exponent = new BigInteger(this.rsaKeyAuth[1], 16);
    const publicKey = forge.pki.rsa.setPublicKey(modulus, exponent);
    const publicKeyPem = forge.pki.publicKeyToPem(publicKey);
    this.log.debug('Successfully created auth public key\n', publicKeyPem);
    // encrypt signature data chunked into 53 byte chunks
    let signature = '';
    const chunkSize = 53;
    let position = 0;
    while (position < signData.length) {
      const chunk = signData.slice(position, position + chunkSize);
      signature += forge.util.bytesToHex(publicKey.encrypt(forge.util.encodeUtf8(chunk)));
      position += chunkSize;
    }
    return signature;
  }

  private formatBodyToEncrypt(data: any): string {
    // format form data into a string
    const data_arr: string[] = [];
    for (const [attr, value] of Object.entries(data)) {
      data_arr.push(`${attr}=${value}`);
    }
    return data_arr.join('&');
  }
}
