// index.js
    require('dotenv').config();
    const { Connection, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      console.error("Private key not found in .env file");
      process.exit(1);
    }

    const recipientPublicKey = process.env.RECIPIENT_PUBLIC_KEY;
    if (!recipientPublicKey) {
      console.error("Recipient public key not found in .env file");
      process.exit(1);
    }

    const raydiumPoolId = process.env.RAYDIUM_POOL_ID;
    if (!raydiumPoolId) {
      console.error("Raydium pool ID not found in .env file");
      process.exit(1);
    }

    const baseTokenMint = process.env.BASE_TOKEN_MINT;
    if (!baseTokenMint) {
      console.error("Base token mint not found in .env file");
      process.exit(1);
    }

    const quoteTokenMint = process.env.QUOTE_TOKEN_MINT;
    if (!quoteTokenMint) {
      console.error("Quote token mint not found in .env file");
      process.exit(1);
    }

    const keypair = Keypair.fromSecretKey(Uint8Array.from(privateKey.split(',').map(Number)));
    const publicKey = keypair.publicKey;

    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

    let db;

    async function initializeDatabase() {
      try {
        const { createClient } = await import('@libsql/client');
        db = createClient({
          url: 'file:agent.db'
        });
        await db.execute('CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, status TEXT, data TEXT)');
      } catch (error) {
        console.error("Error initializing database:", error);
        process.exit(1);
      }
    }


    async function getBalance() {
      const balance = await connection.getBalance(publicKey);
      console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
      return balance;
    }

    async function transferSol(toPublicKey, amount) {
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: toPublicKey,
          lamports: amount * LAMPORTS_PER_SOL,
        })
      );

      const signature = await connection.sendTransaction(transaction, [keypair]);
      console.log(`Transaction sent: ${signature}`);
      await connection.confirmTransaction(signature);
      console.log(`Transaction confirmed: ${signature}`);
    }

    async function addTask(type, data) {
      try {
        await db.execute({
          sql: 'INSERT INTO tasks (type, status, data) VALUES (?, ?, ?)',
          args: [type, 'pending', JSON.stringify(data)]
        });
      } catch (error) {
        console.error("Error adding task:", error);
      }
    }

    async function getPendingTasks() {
      try {
        const result = await db.execute({
          sql: 'SELECT * FROM tasks WHERE status = ?',
          args: ['pending']
        });
        return result.rows.map(row => ({
          id: row[0],
          type: row[1],
          status: row[2],
          data: JSON.parse(row[3])
        }));
      } catch (error) {
        console.error("Error getting pending tasks:", error);
        return [];
      }
    }

    async function updateTaskStatus(id, status) {
      try {
        await db.execute({
          sql: 'UPDATE tasks SET status = ? WHERE id = ?',
          args: [status, id]
        });
      } catch (error) {
        console.error("Error updating task status:", error);
      }
    }

    async function processTasks() {
      const tasks = await getPendingTasks();
      for (const task of tasks) {
        console.log(`Processing task ${task.id} of type ${task.type}`);
        try {
          if (task.type === 'transfer') {
            try {
              const toPublicKey = new PublicKey(task.data.to);
              await transferSol(toPublicKey, task.data.amount);
            } catch (error) {
              console.error(`Invalid public key: ${task.data.to}`, error);
              await updateTaskStatus(task.id, 'failed');
              continue;
            }
          } else if (task.type === 'dex_trade') {
            try {
              const raydium = require('@raydium-io/raydium-sdk-v2');
              const Liquidity = raydium.Liquidity;
              const Market = raydium.Market;
              const TOKEN_PROGRAM_ID = raydium.TOKEN_PROGRAM_ID;

              const poolInfo = await Liquidity.getPoolInfo(connection, new PublicKey(raydiumPoolId));
              const marketInfo = await Market.getMarketInfo(connection, poolInfo.marketId);
              const baseMint = new PublicKey(baseTokenMint);
              const quoteMint = new PublicKey(quoteTokenMint);
              const baseAmount = 0.001; // Example amount
              const quoteAmount = 0;

              const swapTransaction = await Liquidity.makeSwapTransaction({
                connection,
                poolKeys: poolInfo,
                userKeys: {
                  owner: keypair,
                  payer: keypair,
                },
                baseMint,
                quoteMint,
                baseAmount,
                quoteAmount,
                fixedSide: 'in',
                slippage: 0.01,
                programId: TOKEN_PROGRAM_ID,
                marketInfo
              });

              const signature = await connection.sendTransaction(swapTransaction, [keypair]);
              console.log(`DEX trade transaction sent: ${signature}`);
              await connection.confirmTransaction(signature);
              console.log(`DEX trade transaction confirmed: ${signature}`);
            } catch (error) {
              console.error(`Error processing DEX trade:`, error);
              await updateTaskStatus(task.id, 'failed');
            }
          }
          // Add more task types here
          await updateTaskStatus(task.id, 'completed');
        } catch (error) {
          console.error(`Error processing task ${task.id}:`, error);
          await updateTaskStatus(task.id, 'failed');
        }
      }
    }

    async function main() {
      console.log("Agent started");
      await initializeDatabase();
      await getBalance();

      // Example: Add a transfer task
      await addTask('transfer', { to: recipientPublicKey, amount: 0.01 });

      // Example: Add a DEX trade task
      await addTask('dex_trade', {});

      while (true) {
        await processTasks();
        await new Promise(resolve => setTimeout(resolve, 10000)); // Check for new tasks every 10 seconds
      }
    }

    main();
