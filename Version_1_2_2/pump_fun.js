const {
    Connection,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
    Keypair,
    Transaction,
    sendAndConfirmTransaction,
    ComputeBudgetProgram
} = require('@solana/web3.js');
const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
const fetch = require('node-fetch');
const bs58 = require('bs58');
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');

const GLOBAL = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
const FEE_RECIPIENT = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOC_TOKEN_ACC_PROG = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const RENT = new PublicKey("SysvarRent111111111111111111111111111111111");
const PUMP_FUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMP_FUN_ACCOUNT = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
const SYSTEM_PROGRAM_ID = SystemProgram.programId;

const PRIVATE_KEY = 'YOUR_PRIVATE_KEY_HERE'; 
const BUY_AMOUNT_SOL = 0.0001; // Adjust SOL amount as needed
const PROFIT_PERCENTAGE = 10000;
const CUSTOM_RPC_URL = 'YOUR_RPC_URL_HERE'; 

const STATE_FILE = path.join(__dirname, 'purchasedCoins.json');
const savePurchasedCoins = (coins) => {
    fs.writeFileSync(STATE_FILE, JSON.stringify(coins, null, 2), 'utf-8');
};

const loadPurchasedCoins = () => {
    if (fs.existsSync(STATE_FILE)) {
        const data = fs.readFileSync(STATE_FILE, 'utf-8');
        return JSON.parse(data);
    }
    return [];
};

let purchasedCoins = loadPurchasedCoins();

const getKeyPairFromPrivateKey = (key) => Keypair.fromSecretKey(new Uint8Array(bs58.decode(key)));

const bufferFromUInt64 = (value) => {
    let buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(value));
    return buffer;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getCoinDataByAddress = async (address) => {
    const response = await fetch(`https://frontend-api.pump.fun/coins/${address}`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
};

const fetchLatestCoins = async () => {
    const response = await fetch('https://frontend-api.pump.fun/coins?offset=0&limit=10&sort=created_timestamp&order=DESC&includeNsfw=true');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
};

const createTransaction = async (connection, instructions, payer, priorityFeeInSol = 0) => {
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 });
    const transaction = new Transaction().add(modifyComputeUnits);
    if (priorityFeeInSol > 0) {
        const microLamports = priorityFeeInSol * 1_000_000_000;
        const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports });
        transaction.add(addPriorityFee);
    }
    transaction.add(...instructions);
    transaction.feePayer = payer;
    transaction.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
    return transaction;
};

const sendAndConfirmTransactionWrapper = async (connection, transaction, signers, maxRetries = 3) => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const signature = await sendAndConfirmTransaction(connection, transaction, signers, {
                skipPreflight: true,
                preflightCommitment: 'confirmed',
                commitment: 'confirmed'
            });
            console.log('Transaction confirmed with signature:', signature);
            return signature;
        } catch (error) {
            console.error(`Attempt ${attempt + 1} failed:`, error);
            if (attempt === maxRetries - 1) throw error;
            await sleep(2000);
            transaction.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
        }
    }
};

const displayLatestCoins = async () => {
    const latestCoins = await fetchLatestCoins();
    console.log('Latest 10 Coins:');
    latestCoins.forEach((coin, index) => {
        console.log(`${index + 1}. ${coin.name} (${coin.symbol})`);
    });
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedCoin',
            message: 'Select a coin to view details or return to menu:',
            choices: latestCoins.map((coin, index) => ({
                name: `${coin.name} (${coin.symbol})`,
                value: index
            })).concat({ name: 'Return to menu', value: 'return' })
        }
    ]);

    return answers.selectedCoin === 'return' ? null : latestCoins[answers.selectedCoin];
};

const displayCoinDetails = async (coin) => {
    console.log(`
    Name: ${coin.name}
    Symbol: ${coin.symbol}
    Description: ${coin.description}
    Creator: ${coin.creator}
    USD Market Cap: ${coin.usd_market_cap}
    SOL Market Cap: ${coin.market_cap}
    Created At: ${new Date(coin.created_timestamp).toLocaleString()}
    `);
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `What would you like to do with ${coin.name}?`,
            choices: [
                { name: 'Buy this coin', value: 'buy' },
                { name: 'Return to latest 10 coins', value: 'return' }
            ]
        }
    ]);

    return answers.action;
};

const buyCoin = async (connection, payer, coinData, solIn, priorityFeeInSol = 0.001, slippageDecimal = 0.25) => {
    try {
        const owner = payer.publicKey;
        const mintPubkey = new PublicKey(coinData.mint);

        const tokenAccountAddress = await getAssociatedTokenAddress(mintPubkey, owner, false);
        const tokenAccountInfo = await connection.getAccountInfo(tokenAccountAddress);

        const instructions = [];
        if (!tokenAccountInfo) {
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    payer.publicKey,
                    tokenAccountAddress,
                    payer.publicKey,
                    mintPubkey
                )
            );
        }

        const solInLamports = solIn * LAMPORTS_PER_SOL;
        const tokenOut = Math.floor(solInLamports * coinData.virtual_token_reserves / coinData.virtual_sol_reserves);
        const solInWithSlippage = solIn * (1 + slippageDecimal);
        const maxSolCost = Math.floor(solInWithSlippage * LAMPORTS_PER_SOL);

        const keys = [
            { pubkey: GLOBAL, isSigner: false, isWritable: false },
            { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
            { pubkey: mintPubkey, isSigner: false, isWritable: false },
            { pubkey: new PublicKey(coinData.bonding_curve), isSigner: false, isWritable: true },
            { pubkey: new PublicKey(coinData.associated_bonding_curve), isSigner: false, isWritable: true },
            { pubkey: tokenAccountAddress, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: false, isWritable: true },
            { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: RENT, isSigner: false, isWritable: false },
            { pubkey: PUMP_FUN_ACCOUNT, isSigner: false, isWritable: true },
            { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false }
        ];

        const data = Buffer.concat([
            Buffer.from([0]),
            bufferFromUInt64(solInLamports),
            bufferFromUInt64(maxSolCost),
            bufferFromUInt64(tokenOut)
        ]);

        instructions.push(new TransactionInstruction({
            keys,
            programId: PUMP_FUN_PROGRAM,
            data
        }));

        const transaction = await createTransaction(connection, instructions, payer, priorityFeeInSol);
        const signature = await sendAndConfirmTransactionWrapper(connection, transaction, [payer]);

        purchasedCoins.push({
            name: coinData.name,
            symbol: coinData.symbol,
            amount: solIn,
            signature
        });

        savePurchasedCoins(purchasedCoins);
        console.log('Coin purchased successfully:', coinData.name);
    } catch (error) {
        console.error('Error during coin purchase:', error);
    }
};

const buyCoinByAddress = async (connection, payer, contractAddress, solAmount, priorityFeeInSol = 0.001) => {
    try {
        const coinData = await getCoinDataByAddress(contractAddress);
        if (!coinData) {
            console.error(`Coin data not found for contract address: ${contractAddress}`);
            return;
        }
        await buyCoin(connection, payer, coinData, solAmount, priorityFeeInSol);
    } catch (error) {
        console.error('Error buying coin by address:', error);
    }
};

const main = async () => {
    const connection = new Connection(CUSTOM_RPC_URL, 'confirmed');
    const payer = getKeyPairFromPrivateKey(PRIVATE_KEY);

    while (true) {
        console.log('\nPump Fun Coin Buyer Menu:');
        const answers = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Choose an action:',
                choices: [
                    { name: 'View latest 10 coins', value: 'latest' },
                    { name: 'Buy by contract address', value: 'buyByAddress' },
                    { name: 'View purchased coins', value: 'purchased' },
                    { name: 'Exit', value: 'exit' }
                ]
            }
        ]);

        switch (answers.action) {
            case 'latest':
                const selectedCoin = await displayLatestCoins();
                if (selectedCoin) {
                    const action = await displayCoinDetails(selectedCoin);
                    if (action === 'buy') {
                        await buyCoin(connection, payer, selectedCoin, BUY_AMOUNT_SOL);
                    }
                }
                break;

            case 'buyByAddress':
                const contractAddress = await promptForContractAddress();
                await buyCoinByAddress(connection, payer, contractAddress, BUY_AMOUNT_SOL);
                break;

            case 'purchased':
                console.log('Purchased Coins:');
                purchasedCoins.forEach((coin, index) => {
                    console.log(`${index + 1}. ${coin.name} (${coin.symbol}): ${coin.amount} SOL (Tx: ${coin.signature})`);
                });
                break;

            case 'exit':
                console.log('Exiting Pump Fun Coin Buyer.');
                return;
        }
    }
};

const promptForContractAddress = async () => {
    const answer = await inquirer.prompt({
        type: 'input',
        name: 'contractAddress',
        message: 'Enter the contract address of the coin:',
        validate: function (value) {
            if (value.trim().length === 0) {
                return 'Please enter a valid contract address.';
            }
            return true;
        }
    });
    return answer.contractAddress.trim();
};

main().catch((error) => {
    console.error('Error in main execution:', error);
});
