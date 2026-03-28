const BalboaLocal = require('./lib/balboa/local');

// Mock message from a Balboa spa (real test vector from research)
// Data: 1DFFAF13000064070700000100000400000000000000000064000000
// CRC: C2
const dataHex = '1DFFAF13000064070700000100000400000000000000000064000000';
const dataToCrc = Buffer.from(dataHex, 'hex');
const expectedCRC = 0xc2;

const bl = new BalboaLocal();
const crc = bl._calculateCRC(dataToCrc);

console.log('Data to CRC:', dataHex);
console.log('Calculated CRC:', crc.toString(16));
console.log('Expected CRC:', expectedCRC.toString(16));

if (crc === expectedCRC) {
    console.log('✅ CRC matches!');
} else {
    console.log('❌ CRC mismatch!');
}
