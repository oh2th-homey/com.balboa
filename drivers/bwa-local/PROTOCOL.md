# Balboa BWA Local Protocol Documentation

This document describes the local TCP protocol used to communicate with Balboa BWA spa systems.

## Connection

- **Port:** 4257 (TCP)
- **Protocol:** Binary messages with CRC-8 checksum

## Message Format

All messages follow this structure:

```
[0x7e] [length] [channel] [message_type] [payload...] [crc] [0x7e]
```

| Byte | Description |
|------|-------------|
| 0x7e | Start/end delimiter |
| length | Total message length (including delimiters) |
| channel | Always 0x0a 0xbf for standard messages |
| message_type | See Message Types below |
| payload | Variable, depends on message type |
| crc | CRC-8 checksum |

## CRC-8 Calculation

**Critical:** The CRC algorithm uses non-standard initial and final XOR values.

```javascript
// Initial CRC value
let crc = 0x02;  // NOT 0x00!

// Process each byte through CRC table
for (let i = 0; i < data.length; i++) {
    crc = crcTable[crc ^ data[i]];
}

// Final XOR
return crc ^ 0x02;  // NOT just crc!
```

**CRC Table (Polynomial 0x07):**
```javascript
const crcTable = [
    0x00, 0x07, 0x0e, 0x09, 0x1c, 0x1b, 0x12, 0x15, 0x38, 0x3f, 0x36, 0x31, 0x24, 0x23, 0x2a, 0x2d,
    0x70, 0x77, 0x7e, 0x79, 0x6c, 0x6b, 0x62, 0x65, 0x48, 0x4f, 0x46, 0x41, 0x54, 0x53, 0x5a, 0x5d,
    0xe0, 0xe7, 0xee, 0xe9, 0xfc, 0xfb, 0xf2, 0xf5, 0xd8, 0xdf, 0xd6, 0xd1, 0xc4, 0xc3, 0xca, 0xcd,
    0x90, 0x97, 0x9e, 0x99, 0x8c, 0x8b, 0x82, 0x85, 0xa8, 0xaf, 0xa6, 0xa1, 0xb4, 0xb3, 0xba, 0xbd,
    0xc7, 0xc0, 0xc9, 0xce, 0xdb, 0xdc, 0xd5, 0xd2, 0xff, 0xf8, 0xf1, 0xf6, 0xe3, 0xe4, 0xed, 0xea,
    0xb7, 0xb0, 0xb9, 0xbe, 0xab, 0xac, 0xa5, 0xa2, 0x8f, 0x88, 0x81, 0x86, 0x93, 0x94, 0x9d, 0x9a,
    0x27, 0x20, 0x29, 0x2e, 0x3b, 0x3c, 0x35, 0x32, 0x1f, 0x18, 0x11, 0x16, 0x03, 0x04, 0x0d, 0x0a,
    0x57, 0x50, 0x59, 0x5e, 0x4b, 0x4c, 0x45, 0x42, 0x6f, 0x68, 0x61, 0x66, 0x73, 0x74, 0x7d, 0x7a,
    0x89, 0x8e, 0x87, 0x80, 0x95, 0x92, 0x9b, 0x9c, 0xb1, 0xb6, 0xbf, 0xb8, 0xad, 0xaa, 0xa3, 0xa4,
    0xf9, 0xfe, 0xf7, 0xf0, 0xe5, 0xe2, 0xeb, 0xec, 0xc1, 0xc6, 0xcf, 0xc8, 0xdd, 0xda, 0xd3, 0xd4,
    0x69, 0x6e, 0x67, 0x60, 0x75, 0x72, 0x7b, 0x7c, 0x51, 0x56, 0x5f, 0x58, 0x4d, 0x4a, 0x43, 0x44,
    0x19, 0x1e, 0x17, 0x10, 0x05, 0x02, 0x0b, 0x0c, 0x21, 0x26, 0x2f, 0x28, 0x3d, 0x3a, 0x33, 0x34,
    0x4e, 0x49, 0x40, 0x47, 0x52, 0x55, 0x5c, 0x5b, 0x76, 0x71, 0x78, 0x7f, 0x6a, 0x6d, 0x64, 0x63,
    0x3e, 0x39, 0x30, 0x37, 0x22, 0x25, 0x2c, 0x2b, 0x06, 0x01, 0x08, 0x0f, 0x1a, 0x1d, 0x14, 0x13,
    0xae, 0xa9, 0xa0, 0xa7, 0xb2, 0xb5, 0xbc, 0xbb, 0x96, 0x91, 0x98, 0x9f, 0x8a, 0x8d, 0x84, 0x83,
    0xde, 0xd9, 0xd0, 0xd7, 0xc2, 0xc5, 0xcc, 0xcb, 0xe6, 0xe1, 0xe8, 0xef, 0xfa, 0xfd, 0xf4, 0xf3
];
```

---

## Message Types

### Status Request (Send)
Request current spa status.

```
Type: 0x12
Payload: (none)
```

### Status Response (Receive)
Spa status update (sent periodically or in response to request).

```
Type: 0xff 0xaf 0x13
Payload bytes:
  [5]  - Priming flag (bit 0)
  [6]  - Current temperature (raw value, see Temperature section)
  [7]  - Hour
  [8]  - Minute
  [9]  - Heater mode (0=Ready, 1=Rest, 2=ReadyInRest)
  [10] - Flags: bit 2=TempScale (0=F, 1=C), bit 4=TimeFormat (0=12h, 1=24h)
  [11] - Heater status (bits 0-1: 0=OFF, 1=Heating, 2=Heat Waiting)
  [12] - Pump status byte 1
  [15] - Pump status byte 2
  [14] - Circulation pump and blower status
  [17] - Light status
  [20] - Target temperature (raw value)
  [24] - Temperature range (bit 2)
```

### Configuration Request (Send)
Request spa configuration (pumps, blower, lights present).

```
Type: 0x04
Payload: (none)
```

### Configuration Response (Receive)
Spa configuration (which components are installed).

```
Type: 0x0a 0xbf 0x94
Payload bytes:
  [4] - Pump 1-4 presence (2 bits each)
        Bits 0-1: Pump 1 (00=none, 01=1-speed, 10=2-speed)
        Bits 2-3: Pump 2
        Bits 4-5: Pump 3
        Bits 6-7: Pump 4
  [5] - Pump 5-6 presence (2 bits each)
        Bits 0-1: Pump 5
        Bits 2-3: Pump 6
  [6] - Lights (2 bits each)
        Bits 0-1: Light 1
        Bits 2-3: Light 2
  [7] - Blower (bits 2-3, NOT bits 0-1)
  [8] - Aux/Mister
        Bit 0: Aux1
        Bit 1: Aux2
        Bit 4: Mister
```

### Toggle Command (Send)
Toggle a device on/off.

```
Type: 0x11
Payload: [button_code]
```

**Button Codes:**
| Code | Device |
|------|--------|
| 0x04 | Pump 1 |
| 0x05 | Pump 2 |
| 0x06 | Pump 3 |
| 0x07 | Pump 4 |
| 0x08 | Pump 5 |
| 0x09 | Pump 6 |
| 0x0c | Blower |
| 0x11 | Light 1 |
| 0x12 | Light 2 |

### Set Temperature (Send)
Set target temperature.

```
Type: 0x20
Payload: [temperature_value]
```

Temperature value is raw (double the Celsius value, e.g., 40°C = 80).

### Set Temperature Range (Send)
Set high/low temperature range mode.

```
Type: 0x50
Payload: (none) - toggles between high and low
```

### Set Heater Mode (Send)
Set heating mode (Ready/Rest).

```
Type: 0x51
Payload: (none) - toggles between Ready and Rest
```

---

## Temperature Encoding

Temperatures are encoded as integers:
- **Fahrenheit:** Raw value = °F
- **Celsius:** Raw value = °C × 2 (e.g., 38.5°C = 77)

Check bit 2 of byte 10 in status to determine scale (0=F, 1=C).

---

## Example: Complete Toggle Pump 1 Command

```
7e 08 0a bf 11 04 XX 7e
│   │  │     │  │  │  └─ End delimiter
│   │  │     │  │  └──── CRC (calculated)
│   │  │     │  └─────── Button code (Pump 1 = 0x04)
│   │  │     └────────── Message type (toggle = 0x11)
│   │  └──────────────── Channel (0x0a 0xbf)
│   └─────────────────── Length (8 bytes total)
└─────────────────────── Start delimiter
```

---

## Implementation Notes

1. **Reconnection:** The spa may close connections; implement auto-reconnect
2. **Polling:** Request status every few seconds for real-time updates
3. **Config first:** Send config request (0x04) on connect to determine installed components
4. **Command locking:** After sending a toggle, ignore status updates for ~2 seconds to prevent UI flicker

---

## Files Reference

| File | Purpose |
|------|---------|
| `lib/balboa/local.js` | Core protocol implementation |
| `drivers/BWA/device.js` | Homey device integration |
| `drivers/BWA/driver.js` | Pairing and discovery |
