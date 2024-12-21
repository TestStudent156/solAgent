// generate-wallet.js
    const { Keypair } = require('@solana/web3.js');
    const keypair = Keypair.generate();
    const privateKey = keypair.secretKey.toString();
    const publicKey = keypair.publicKey.toString();

    console.log('Public Key:', publicKey);
    console.log('Private Key:', privateKey);
    console.log('IMPORTANT: Store the private key securely!');
