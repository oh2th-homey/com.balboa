const Homey = require('homey');
const crypto = require('crypto');

const algorithm = 'aes-256-ctr';
const secretKey = Homey.env.SECRET;
const secretKeyLegacy = Homey.env.SECRET_OLD;
const iv = crypto.randomBytes(16);

sleep = async function (ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
};

encrypt = function (text, legacy = false) {
    const secret = legacy ? secretKeyLegacy : secretKey;
    const cipher = crypto.createCipheriv(algorithm, secret, iv);
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
    return `${iv.toString('hex')}+${encrypted.toString('hex')}`;
};

decrypt = function (hash, legacy = false) {
    if (hash === null) {
        return hash;
    }

    const secret = legacy ? secretKeyLegacy : secretKey;
    const splittedHash = hash.split('+');
    const decipher = crypto.createDecipheriv(algorithm, secret, Buffer.from(splittedHash[0], 'hex'));

    const decrpyted = Buffer.concat([decipher.update(Buffer.from(splittedHash[1], 'hex')), decipher.final()]);

    return decrpyted.toString();
};

toCelsius = function (value) {
    return roundHalf((parseFloat(value) - 32) * (5 / 9));
};

toFahrenheit = function (value) {
    return roundHalf(parseFloat(value) * (9/5) + 32);
};

roundHalf = function (num) {
    return Math.round(num * 2) / 2;
};

// Format a capability listener value ({ capability: value, … }) for one log line.
formatCommand = function (value) {
    return Object.entries(value)
        .map(([key, val]) => `${key} ${val}`)
        .join(', ');
};

module.exports = {
    sleep,
    encrypt,
    decrypt,
    toCelsius,
    toFahrenheit,
    roundHalf,
    formatCommand
};
