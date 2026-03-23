const bip39 = require('bip39');

const mnemonic = bip39.generateMnemonic(256); // 24 words

console.log('WALLET_SEED=' + mnemonic);
