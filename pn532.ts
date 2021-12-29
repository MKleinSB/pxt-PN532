// MakeCode extension for PN532 NFC RFID module
// original code from https://github.com/1010Technologies/pxt-makerbit-rfid
// MIT License Copyright (c) 2021 Roger Wagner translation by M.Klein

let RFID_DEBUG = false;

const PN532_COMMAND_GETFIRMWAREVERSION = 0x02;
const PN532_COMMAND_SAMCONFIGURATION = 0x14;
const PN532_COMMAND_RFCONFIGURATION = 0x32;
const PN532_HOSTTOPN532 = 0xD4;
const PN532_COMMAND_INDATAEXCHANGE = 0x40;
const PN532_COMMAND_INLISTPASSIVETARGET = 0x4A;

enum HexDigits {
    //% block="default"
    d0 = 0,
    //% block="1"
    d1,
    //% block="2"
    d2,
    //% block="3"
    d3,
    //% block="4"
    d4,
    //% block="5"
    d5,
    //% block="6"
    d6,
    //% block="7"
    d7,
    //% block="8"
    d8,
    //% block="9"
    d9,
    //% block="10"
    d10,
    //% block="11"
    d11,
    //% block="12"
    d12,
    //% block="13"
    d13,
    //% block="14"
    d14,
    //% block="15"
    d15,
    //% block="16"
    d16
}

function MakerBit_convertNumberToHex(value: number, digits: HexDigits) : string {
  let hex = "";
  let d: number = digits;
  if (d == 0) {
    d = 16;
  }
  for (let pos = 1; pos <= d; pos++) {
    let remainder = value & 0xF;
    if (remainder < 10) {
      hex = remainder.toString() + hex;
    } else {
      hex = String.fromCharCode(55 + remainder) + hex;
    }
    value = value >> 4;
    if (value < 0 && value > -268435456) {
      value += 268435456;
    }
    if (digits == 0 && value == 0 && (pos % 2) == 0) break;
  }
  return hex;
}


function RFID_WriteCommand(cmd: number[]) {
    let cmdlist: number[] = [0, 0, 0xFF];
    let checksum = 0xFF;
    cmdlist.push(cmd.length + 1);
    checksum += cmd.length + 1;
    cmdlist.push(255 - cmd.length);
    checksum += 255 - cmd.length;
    cmdlist.push(PN532_HOSTTOPN532);
    checksum += PN532_HOSTTOPN532;
    cmd.forEach(function (value) {
        cmdlist.push(value);
        checksum += value;
    });
    cmdlist.push(~(checksum & 0xFF));
    cmdlist.push(0);
    let bufr = pins.createBufferFromArray(cmdlist);
    pins.i2cWriteBuffer(0x24, bufr);
    basic.pause(50);
}

function RFID_ReadData(nbytes: number) : number[] {
    let bufr = pins.i2cReadBuffer(0x24, nbytes + 1, false);
    basic.pause(50);
    return bufr.slice(1).toArray(NumberFormat.UInt8LE);
}

function RFID_ReadAck() : boolean {
    let result = RFID_ReadData(6);
    const pn532ack = [0x00, 0x00, 0xFF, 0x00, 0xFF, 0x00];
    return result.every((v, i) => v === pn532ack[i]);
}

function RFID_SendCommandCheckAck(cmd: number[]) : boolean {
    RFID_WriteCommand(cmd);
    return RFID_ReadAck();
}

function RFID_GetFirmwareVersion() : number {
    if (!RFID_SendCommandCheckAck([PN532_COMMAND_GETFIRMWAREVERSION])) {
        return 0;
    }
    let result = RFID_ReadData(12);

    // Check the first part of the message.
    const pn532response_firmwarevers = [0x00, 0x00, 0xFF, 0x06, 0xFA, 0xD5];
    if (!pn532response_firmwarevers.every((v, i) => v === result[i])) {
        return 0;
    }

    let response = result[7] << 8;
    response = (response | result[8]) << 8;
    response = (response | result[9]) << 8;
    response = response | result[10];
    return response;
}

function RFID_SetPassiveActivationRetries(maxRetries: number) {
    const pn532_packetbuffer = [PN532_COMMAND_RFCONFIGURATION,
        5,    // Config item 5 (MaxRetries)
        0xFF, // MxRtyATR (default = 0xFF)
        0x01, // MxRtyPSL (default = 0x01)
        maxRetries];
    RFID_SendCommandCheckAck(pn532_packetbuffer);
}

// brief  Configures the SAM (Secure Access Module)
function RFID_SAMConfig() : boolean {
    const pn532_packetbuffer = [PN532_COMMAND_SAMCONFIGURATION,
        0x01, // normal mode;
        0x14, // timeout 50ms * 20 = 1 second
        0x01] // use IRQ pin! (CT TODO: Check later)

    if (!RFID_SendCommandCheckAck(pn532_packetbuffer))
        return false;

    // read data packet
    const result = RFID_ReadData(8);
    return (result[6] == 0x15);
}

let RFID_initialized = false;
let RFID_startedPassive = false;


function RFID_ReadDetectedPassiveTargetID() : number[] {

  let pn532_packetbuffer;
  
  if (!RFID_startedPassive) {
    pn532_packetbuffer = [PN532_COMMAND_INLISTPASSIVETARGET,
        1, // max 1 cards at once (we can set this to 2 later)
        0];  // card baud rate
    RFID_SendCommandCheckAck(pn532_packetbuffer);
    RFID_startedPassive = true;
  }

  // read data packet
  pn532_packetbuffer = RFID_ReadData(20);

  // check some basic stuff

  /* ISO14443A card response should be in the following format:

    byte            Description
    -------------   ------------------------------------------
    b0..6           Frame header and preamble
    b7              Tags Found
    b8              Tag Number (only one used in this example)
    b9..10          SENS_RES
    b11             SEL_RES
    b12             NFCID Length
    b13..NFCIDLen   NFCID                                      */

    if (pn532_packetbuffer[7] != 1)
        return [0];

    // If we successfully got a response, reset our passive read.
    RFID_startedPassive = false;

    let sens_res = pn532_packetbuffer[9];
    sens_res <<= 8;
    sens_res |= pn532_packetbuffer[10];

    /* Card appears to be Mifare Classic */
    const uidLength = pn532_packetbuffer[12];
    const uid = pn532_packetbuffer.slice(13, 13 + uidLength);
    return uid;
}


function RFID_DoInitialize() : void {
  const version = RFID_GetFirmwareVersion();
  const chip = ((version >> 24) & 0xFF);
  if (chip == 0) {
    return;
  }
  const tens = Math.floor(chip / 16);
  const ones = chip % 16;
  if (RFID_DEBUG) {
    serial.writeString("Found chip PN5" + tens + ones + "\n");
    serial.writeString("Firmware version " + ((version >> 16) & 0xFF) +
      "." + ((version >> 8) & 0xFF) + "\n");
  }

  // Set the max number of retry attempts to read from a card
  // This prevents us from waiting forever for a card, which is
  // the default behaviour of the PN532.
  RFID_SetPassiveActivationRetries(255);
  const samconfig = RFID_SAMConfig();
  RFID_initialized = true;
}


function RFID_ReadPassiveTargetID() : number[] {
    if (!RFID_initialized) {
      RFID_DoInitialize();
      if (!RFID_initialized) {
        return [0];
      }
    }
    const uid = RFID_ReadDetectedPassiveTargetID();
    if (RFID_DEBUG) {
      serial.writeString("Found RFID: " +
        MakerBit_convertNumberToHex(RFID_ConvertUIDtoNumber(uid), 8) + "\n");
    }
    return uid;
}


const enum RFID_key {
  AUTH_A = 0,
  AUTH_B = 1
}

function RFID_MifareAuthenticateBlock(uid: number[], blockNumber: number,
  key: number, keyData: number[]) : boolean {

  // Prepare the authentication command //
  let pn532_packetbuffer = [PN532_COMMAND_INDATAEXCHANGE, // Data Exchange Header
    1,                    // Max card numbers
    ([0x60, 0x61])[key],  // MIFARE_CMD_AUTH_A or MIFARE_CMD_AUTH_B
    blockNumber];               // Block Number (1K = 0..63, 4K = 0..255
  pn532_packetbuffer = pn532_packetbuffer.concat(keyData);
  pn532_packetbuffer = pn532_packetbuffer.concat(uid);

  if (!RFID_SendCommandCheckAck(pn532_packetbuffer))
    return false;

  // Read the response packet
  pn532_packetbuffer = RFID_ReadData(12);

  // Auth success should be bytes 5-7: 0xD5 0x41 0x00. Just check byte 7.
  if (pn532_packetbuffer[7] != 0x00) {
    return false;
  }

  return true;
}


function RFID_MifareWriteDataBlock(blockNumber: number,
  dataPayload: number[]): boolean {
    const MIFARE_CMD_WRITE = 0xA0;

    /* Prepare the first command */
  let pn532_packetbuffer = [PN532_COMMAND_INDATAEXCHANGE, 
    1,                /* Card number */
    MIFARE_CMD_WRITE, /* Mifare Write command = 0xA0 */
    blockNumber]; /* Block Number (0..63 for 1K, 0..255 for 4K) */
  pn532_packetbuffer = pn532_packetbuffer.concat(dataPayload);

  if (!RFID_SendCommandCheckAck(pn532_packetbuffer)) {
    if (RFID_DEBUG) {
      serial.writeString("Failed to receive ACK for write command\n");
    }
    return false;
  }

  basic.pause(10);

  /* Read the response packet */
  pn532_packetbuffer = RFID_ReadData(26);

  return true;
}


/* This assumes that the first block of the sector has already been
   authenticaed.
*/
function RFID_MifareWriteNDEFPayload(sectorNumber: number,
  typeFields: number[], payload: string) : boolean
{

  // Make sure we're within a 1K limit for the sector number
  if ((sectorNumber < 1) || (sectorNumber > 15))
    return false;

  // Make sure the payload will fit
  const maxLen = 40 - typeFields.length;
  if ((payload.length < 1) || (payload.length > maxLen))
    return false;

  // record header 0xD1 in bits:
  //   Bit 7 = MB = 1: first record of NDEF message
  //   Bit 6 = ME = 1: last record of NDEF message
  //   Bit 5 = CF = 0: last or only record of chain
  //   Bit 4 = SR = 1: short record length field
  //   Bit 3 = IL = 0: no ID/ID length fields
  //   Bit 2..0 = TNF = 0x1: Type field represents an NFC Forum well-known type name

  // Sector buffer with pre-formatted TLV wrapper and NDEF message
  // https://stackoverflow.com/questions/37220910/how-to-interpret-ndef-content-on-mifare-classic-1k
  // TLV = tag-length-value
  let buffer1to3 = [
    0x00,  // Null TLV (ignore, process next byte)
    0x00,  // Null TLV (ignore, process next byte)
    0x03,  // NDEF message TLV
    payload.length + typeFields.length + 3,  // NDEF message length
    0xD1,  // record header (see above)
    0x01,  // type length = 1 byte
    payload.length + typeFields.length - 1];

  for (let i=0; i < typeFields.length; i++) {
    buffer1to3.push(typeFields[i]);
  }

  for (let i=0; i < payload.length; i++) {
    buffer1to3.push(payload.charCodeAt(i) & 0xFF);
  }

  buffer1to3.push(0xFE);  // Terminator TLV

  for (let i=0; i < maxLen - payload.length; i++) {
    buffer1to3.push(0x00);
  }

  // 0xD3 0xF7 0xD3 0xF7 0xD3 0xF7 must be used for key A in NDEF records
  let buffer4 = [0xD3, 0xF7, 0xD3, 0xF7, 0xD3, 0xF7, 0x7F, 0x07,
                 0x88, 0x40, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];

  // Now write all four blocks back to the card
  if (!(RFID_MifareWriteDataBlock(sectorNumber * 4, buffer1to3.slice(0, 16))))
    return false;
  if (!(RFID_MifareWriteDataBlock((sectorNumber * 4) + 1, buffer1to3.slice(16, 32))))
    return false;
  if (!(RFID_MifareWriteDataBlock((sectorNumber * 4) + 2, buffer1to3.slice(32, 48))))
    return false;
  if (!(RFID_MifareWriteDataBlock((sectorNumber * 4) + 3, buffer4)))
    return false;

  return true;
}


function RFID_MifareFormatNDEF() : boolean
{
  const sectorbuffer1 = [0x14, 0x01, 0x03, 0xE1, 0x03, 0xE1, 0x03, 0xE1,
    0x03, 0xE1, 0x03, 0xE1, 0x03, 0xE1, 0x03, 0xE1];
  const sectorbuffer2 = [0x03, 0xE1, 0x03, 0xE1, 0x03, 0xE1, 0x03, 0xE1,
    0x03, 0xE1, 0x03, 0xE1, 0x03, 0xE1, 0x03, 0xE1];
  const sectorbuffer3 = [0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x78, 0x77,
    0x88, 0xC1, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];

  // Note 0xA0 0xA1 0xA2 0xA3 0xA4 0xA5 must be used for key A
  // for the MAD sector in NDEF records (sector 0)

  // Write block 1 and 2 to the card
  if (!(RFID_MifareWriteDataBlock(1, sectorbuffer1)))
    return false;
  if (!(RFID_MifareWriteDataBlock(2, sectorbuffer2)))
    return false;
  // Write key A and access rights card
  if (!(RFID_MifareWriteDataBlock(3, sectorbuffer3)))
    return false;

  return true;
}


function RFID_MifareWritePayload(payload: string, type: string)
{
  let uid = RFID_ReadPassiveTargetID();

  const keya = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];

  // // First see if we need to reformat the card for NDEF.
  let success = RFID_MifareAuthenticateBlock(uid, 0, RFID_key.AUTH_A, keya);
  if (success) {
    if (RFID_DEBUG) {
      serial.writeString("Formatting card for NDEF\n");
    }
    if (!RFID_MifareFormatNDEF()) {
      if (RFID_DEBUG) {
        serial.writeString("Unable to format the card for NDEF\n");
      }
      return;
    }
  }

  // // Now see if this is a newly-formatted card (still old key)
  // // or if we are rewriting an existing NDEF URL.
  if (RFID_DEBUG) {
    serial.writeString("Trying original (non-NDEF) key.\n");
  }

  success = RFID_MifareAuthenticateBlock(uid, 4, RFID_key.AUTH_A, keya);

  if (!success) {
    if (RFID_DEBUG) {
      serial.writeString("Doesn't seem to be non-NDEF. Trying NDEF key.\n");
    }
    uid = RFID_ReadPassiveTargetID(); // Reset PN532
    const keya_ndef = [ 0xD3, 0xF7, 0xD3, 0xF7, 0xD3, 0xF7 ];
    success = RFID_MifareAuthenticateBlock(uid, 4, RFID_key.AUTH_A, keya_ndef);
    if (!success) {
      if (RFID_DEBUG) {
        serial.writeString("Authentication failed as NDEF key.\n");
      }
      return;
    }
  }

  const NDEF_URIPREFIX_HTTP_WWWDOT = 1;

  if (RFID_DEBUG) {
    serial.writeString("Found authentication key, writing payload...\n");
  }

  if (type == "U")
  {
    const typeFields = [
      0x55,  // ASCII "U" for URI urn:nfc:wkt:U
      NDEF_URIPREFIX_HTTP_WWWDOT];  // 1 for http://, 2 for https://, etc.
    success = RFID_MifareWriteNDEFPayload(1, typeFields, payload);
  } else if (type == "T") {
    const typeFields = [
      0x54, // ASCII "T" for URI urn:nfc:wkt:T
      0x02, // Language code size
      0x65, 0x6E];  // Language = English, 'en',
    success = RFID_MifareWriteNDEFPayload(1, typeFields, payload);
  } else {
    success = false;
  }

  if (RFID_DEBUG) {
    if (success) {
      serial.writeString("Done writing: " + payload + "\n");
    } else {
      serial.writeString("Write failed.\n");
    }
  }
}


function RFID_MifareReadDataBlock(blockNumber: number): number[] {
  /* Prepare the command */
  const MIFARE_CMD_READ = 0x30;
  let pn532_packetbuffer = [PN532_COMMAND_INDATAEXCHANGE,
    1,               /* Card number */
    MIFARE_CMD_READ, /* Mifare Read command = 0x30 */
    blockNumber]; /* Block Number (0..63 for 1K, 0..255 for 4K) */

  if (!RFID_SendCommandCheckAck(pn532_packetbuffer)) {
    if (RFID_DEBUG) {
      serial.writeString("Failed to receive ACK for read command\n");
    }
    return [0];
  }

  basic.pause(10);

  /* Read the response packet */
  pn532_packetbuffer = RFID_ReadData(26);

  /* If byte 8 isn't 0x00 we probably have an error */
  if (pn532_packetbuffer[7] != 0x00) {
    if (RFID_DEBUG) {
      serial.writeString("Unexpected response\n");
      serial.writeNumbers(pn532_packetbuffer);
    }
    return [0];
  }

  /* Copy the 16 data bytes to the output buffer        */
  /* Block content starts at byte 9 of a valid response */
  let result = pn532_packetbuffer.slice(8, 24);
  if (RFID_DEBUG) {
    serial.writeString("Data block: ");
    serial.writeNumbers(result);
  }
  return result;
}


function RFID_ExtractTLVPayload(payload: number[]): number[] {
  for (let i=0; i < payload.length - 2; i++) {
    // Look for TLV start-of-message tag, get length, then extract.
    if (payload[i] == 0x03) {
      const len = payload[i + 1];
      if (len > 0) {
        return payload.slice(i + 2, i + 2 + len);
      }
      i++;
    }
  }
  return [0];
}


/* This assumes that the first block of the sector has already been
   authenticaed.
*/
function RFID_MifareReadNDEFPayload(sectorNumber: number): string {
  let result1 = RFID_MifareReadDataBlock(sectorNumber * 4);
  if (result1.length <= 1)
    return "";
  let result2 = RFID_MifareReadDataBlock(sectorNumber * 4 + 1);
  if (result2.length <= 1)
    return "";
  let result3 = RFID_MifareReadDataBlock(sectorNumber * 4 + 2);
  if (result3.length <= 1)
    return "";
  let result = result1.concat(result2).concat(result3);

  result = RFID_ExtractTLVPayload(result);

  if (result.length < 6) {
    return "";
  }
  if (result[0] != 0xD1 || result[1] != 1) {
    return "";
  }

  let str = "";
  let i = result.length;
  if (result[3] == 0x54) {  // Text payload
    i = 7;
  } else if (result[3] == 0x55) {  // URI payload
    i = 5;
  }
  for ( ; i < result.length; i++) {
    str += String.fromCharCode(result[i]);
  }
  return str
}


function RFID_MifareReadPayload() : string {
  const uid = RFID_ReadPassiveTargetID();

  const keya_ndef = [ 0xD3, 0xF7, 0xD3, 0xF7, 0xD3, 0xF7 ];
  let success = RFID_MifareAuthenticateBlock(uid, 4, RFID_key.AUTH_A, keya_ndef);
  if (!success) {
    if (RFID_DEBUG) {
      serial.writeString("Authentication failed as NDEF key.\n");
    }
    return "";
  }

  let result = RFID_MifareReadNDEFPayload(1);
  if (RFID_DEBUG) {
    serial.writeString("Result: " + result + "\n");
  }

   return result;
}


function RFID_ConvertUIDtoNumber(uid: number[]) : number {
  return (uid[0] << 24) + (uid[1] << 16) + (uid[2] << 8) + uid[3];
}


//% weight=99 color=#1a5276 icon="\uf2c2" block="NFC 532"
//% category="NFC"
namespace nfc {

  const REPEAT_TIMEOUT_MS = 200;
  const MICROBIT_MAKERBIT_RFID_FOUND = 1010;
  let rfidBusy = false;

  control.inBackground(() =>
  {
    while (true) {
      // sleep to save CPU cylces
      basic.pause(REPEAT_TIMEOUT_MS);
      if (!rfidBusy) {
        let uid = RFID_ReadPassiveTargetID();
        if (uid.length == 4) {
          const uid32 = RFID_ConvertUIDtoNumber(uid);
          control.raiseEvent(MICROBIT_MAKERBIT_RFID_FOUND, uid32);
        }
      }
    }
  });


  /**
   * Do something when a specific button is pressed or released on the remote control.
   * @param button the button to be checked
   * @param action the trigger action
   * @param handler body code to run when the event is raised
   */

  //% blockId=makerbit_rfid_on_presented
  //% block="on RFID presented"
  //% block.loc.de="wenn RFID erkannt"
  //% weight=95
  export function onRFIDPresented(handler: () => void)
  {
    if (RFID_DEBUG) {
      serial.writeString("onRFIDPresented\n");
    }
    control.onEvent(
      MICROBIT_MAKERBIT_RFID_FOUND,
      EventBusValue.MICROBIT_EVT_ANY,
      () => {
        rfidBusy = true;
        handler();
        rfidBusy = false;
      }
    );
  }


  /**
   * Get the UID from an RFID (v030)
   */

  //% blockId="makerbit_rfid_get_uid"
  //% block="RFID Seriennummer (UID)"
  //% weight=90
  export function rfidGetUID() : number {
    // 'uid' will be 4 bytes (Mifare Classic) or 7 bytes (Mifare Ultralight)
    const uid = RFID_ReadPassiveTargetID();
    basic.pause(10);
    if (uid.length == 4) {
      const uid32 = RFID_ConvertUIDtoNumber(uid);
      return uid32;
    }
    return 0;
  }

  /**
   * Write a text string to an RFID. Max 36 characters.
   */

  //% blockId="makerbit_rfid_write_string"
  //% block="RFID write string $text"
  //% block.loc.de="RFID schreibe Text $text"
  //% text.defl="Hi!"
  //% weight=85
  export function rfidWriteString(text: string) {
    RFID_MifareWritePayload(text, "T");
  }

  /**
   * Read a text string from an RFID.
   */
 
  //% blockId="makerbit_rfid_read_string"
  //% block="RFID read string"
  //% block.loc.de="RFID lies Text"
  //% weight=80
  export function rfidReadString() : string {
    return RFID_MifareReadPayload();
  }

  /**
   * Write a URL to an RFID. Do not include the http://. Max 38 characters.
   */

  //% blockId="makerbit_rfid_write_url"
  //% block="RFID write URL $url"
  //% block.loc.de="RFID schreibe URL $url"
  //% url.defl="1010technologies.com"
  //% weight=75
  export function rfidWriteURL(url: string) {
    RFID_MifareWritePayload(url, "U");
  }

  /**
   * Convert an integer number to a hexadecimal string,
   * with an optional number of digits. Negative numbers are treated
   * as 32-bit integers.
   */
  //% blockId="makerbit_convert_number_hexstring"
  //% block="convert $value to hex, $digits digits"
  //% block.loc.de="konvertiere $value zu hexadezimal, $digits Stellen"
  //% weight=70
  export function convertNumberToHex(value: number, digits: HexDigits) : string {
    return MakerBit_convertNumberToHex(value, digits);
  }

}

