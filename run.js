const { ethers } = require("ethers");
require("dotenv").config();
const readline = require("readline");

const RPC_URL = "https://rpc.testnet.fluent.xyz";
const CHAIN_ID = 20994;

const LOOTBOX_CA = "0x7468edC3E94F8e6D1d198497C8b93AD638468047";
const MARKETPLACE_CA = "0x147b072d57bD5bB762871e13766DBA19AEF7bA8E";
const PUMPPALS_CONTRACT = "0x02715A523169f08c1005EE9B91FB767fd4C85A3a";
const COLLECTION_BRONZE = "0xf56410f2365e97D585683270b9c90A312E9c38fD";
const COLLECTION_SILVER = "0x4e1B2c561796951F76CEe2748b910a6d69ff985C";

const BRONZE_PRICE = ethers.parseEther("0.005");
const SILVER_PRICE = ethers.parseEther("0.085");

const LOOTBOX_ABI = [
    "function openWithETH(address collection) payable",
    "event LootboxOpen(address indexed opener, address indexed collection, uint256[] cardTokenIds, uint256 timestamp)"
];

const MARKETPLACE_ABI = [
    "function buyCard(uint256 _listingId) payable",
    "event CardBuy(address indexed buyer, uint256 indexed listingId, address collection, uint256 tokenId, uint256 price, address royaltyRecipient, uint256 royaltyAmount, uint256 timestamp)"
];

const ERC1155_ABI = [
    "function balanceOf(address account, uint256 id) view returns (uint256)",
    "function maxId() view returns (uint256)",
    "function exists(uint256 id) view returns (bool)",
    "function setApprovalForAll(address operator, bool approved)",
    "function isApprovedForAll(address account, address operator) view returns (bool)"
];

const PUMPPALS_ABI = [
    {
        "inputs": [
            {"internalType":"address","name":"collection","type":"address"},
            {"internalType":"uint256[]","name":"tokenIds","type":"uint256[]"}
        ],
        "name":"combineCards",
        "outputs":[],
        "stateMutability":"nonpayable",
        "type":"function"
    },
    {
        "inputs": [],
        "name": "paused",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function"
    }
];

async function sendLegacyTransaction(contract, methodName, args, value = 0) {
    const provider = contract.runner.provider;
    const wallet = contract.runner;
    
    let gasPrice;
    try {
        if (typeof provider.getGasPrice === 'function') {
            gasPrice = await provider.getGasPrice();
        } else {
            const feeData = await provider.getFeeData();
            gasPrice = feeData.gasPrice;
        }
    } catch {
        gasPrice = ethers.parseUnits("1.2", "gwei");
    }
    
    let gasLimit;
    try {
        const estimate = await contract.estimateGas[methodName](...args, { value });
        gasLimit = estimate * BigInt(120) / BigInt(100); 
    } catch (error) {
        console.log("Estimasi gas gagal, menggunakan default 500000");
        gasLimit = BigInt(500000);
    }
    
    const txData = {
        to: contract.target,
        data: contract.interface.encodeFunctionData(methodName, args),
        gasPrice,
        gasLimit,
        value,
        type: 0 
    };
    
    const tx = await wallet.sendTransaction(txData);
    console.log(`Transaksi dikirim: ${tx.hash}`);
    
    const receipt = await tx.wait();
    console.log(`Transaksi berhasil! Block: ${receipt.blockNumber}, Gas Used: ${receipt.gasUsed.toString()}`);
    
    return receipt;
}

async function ensureApproval() {
    const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    const nftContract = new ethers.Contract(COLLECTION_BRONZE, ERC1155_ABI, wallet);
    
    const isApproved = await nftContract.isApprovedForAll(wallet.address, PUMPPALS_CONTRACT);
    
    if (isApproved) {
        console.log("✅ Approval sudah diatur sebelumnya");
        return true;
    }
    
    console.log("🔐 Approval belum diberikan, melakukan set approval...");
    
    try {
        await sendLegacyTransaction(
            nftContract,
            "setApprovalForAll",
            [PUMPPALS_CONTRACT, true]
        );
        console.log("✅ Approval berhasil diatur");
        return true;
    } catch (error) {
        console.error(`❌ Gagal mengatur approval: ${error.reason || error.message}`);
        return false;
    }
}

async function buyCard(listingId, price) {
    const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    console.log(`\n🛒 Membeli kartu dengan listing ID: ${listingId}`);
    console.log(`Menggunakan wallet: ${wallet.address}`);
    
    const marketplace = new ethers.Contract(MARKETPLACE_CA, MARKETPLACE_ABI, wallet);
    
    try {
        const receipt = await sendLegacyTransaction(
            marketplace, 
            "buyCard", 
            [listingId], 
            price
        );
        
        const eventTopic = marketplace.interface.getEvent("CardBuy").topicHash;
        const log = receipt.logs.find(log => log.topics[0] === eventTopic);
        
        if (log) {
            const eventData = marketplace.interface.parseLog(log);
            const [buyer, , collection, tokenId] = eventData.args;
            console.log(`✅ Berhasil membeli kartu! Token ID: ${tokenId}`);
        } else {
            console.log("⚠️ Event CardBuy tidak ditemukan");
        }
        
        return true;
    } catch (error) {
        console.error(`❌ Gagal membeli kartu: ${error.reason || error.message}`);
        return false;
    }
}

async function openLootbox(collection, price, name) {
    const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    console.log(`\n🎫 [${name}] Membuka lootbox untuk koleksi: ${collection}`);
    console.log(`Menggunakan wallet: ${wallet.address}`);
    
    const lootboxContract = new ethers.Contract(LOOTBOX_CA, LOOTBOX_ABI, wallet);
    
    try {
        const receipt = await sendLegacyTransaction(
            lootboxContract, 
            "openWithETH", 
            [collection], 
            price
        );
        
        const eventTopic = lootboxContract.interface.getEvent("LootboxOpen").topicHash;
        const log = receipt.logs.find(log => log.topics[0] === eventTopic);
        
        if (log) {
            const eventData = lootboxContract.interface.parseLog(log);
            const [opener, , tokenIds] = eventData.args;
            console.log(`✅ Berhasil membuka lootbox! Token ID didapat: ${tokenIds.join(", ")}`);
        } else {
            console.log("⚠️ Event LootboxOpen tidak ditemukan");
        }
        
        return true;
    } catch (error) {
        console.error(`❌ Gagal membuka lootbox: ${error.reason || error.message}`);
        return false;
    }
}

async function combineCards() {
    const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    console.log("\n🔄 Memulai proses Combine Cards");
    console.log(`Menggunakan wallet: ${wallet.address}`);
    
    console.log("\n🔐 [WAJIB] Memastikan approval untuk PumpPals...");
    const approvalSuccess = await ensureApproval();
    
    if (!approvalSuccess) {
        console.log("❌ Proses dihentikan karena gagal set approval");
        return false;
    }
    
    console.log("✅ Approval sudah dipastikan, melanjutkan ke combine...");
    
    const nftContract = new ethers.Contract(COLLECTION_BRONZE, ERC1155_ABI, provider);
    const pumpPalsContract = new ethers.Contract(PUMPPALS_CONTRACT, PUMPPALS_ABI, wallet);
    
    try {
        const maxId = await nftContract.maxId();
        console.log(`🔢 Max ID: ${maxId}`);
        
        const tokenBalances = [];
        for (let id = 1; id <= maxId; id++) {
            try {
                const exists = await nftContract.exists(id);
                if (!exists) continue;
                
                const balance = await nftContract.balanceOf(wallet.address, id);
                const numBalance = Number(balance);
                if (numBalance > 0) {
                    tokenBalances.push({ id, balance: numBalance });
                }
            } catch (error) {
                console.error(`⚠️ Error pada token ID ${id}: ${error.message}`);
            }
        }
        
        console.log("📦 Token yang dimiliki:", tokenBalances);
        
        if (tokenBalances.length === 0) {
            console.log("⚠️ Tidak ada token Bronze yang dimiliki");
            return false;
        }
        
        const MIN_TOKENS = 2;
        const tokenGroups = [];
        for (const token of tokenBalances) {
            if (token.balance >= MIN_TOKENS) {
                const groupsCount = Math.floor(token.balance / MIN_TOKENS);
                for (let i = 0; i < groupsCount; i++) {
                    tokenGroups.push(Array(MIN_TOKENS).fill(token.id));
                }
            }
        }
        
        if (tokenGroups.length === 0) {
            console.log("⚠️ Tidak ada token yang bisa digabungkan (minimal 2 token dengan ID sama)");
            return false;
        }
        
        console.log(`🔍 Ditemukan ${tokenGroups.length} kelompok untuk digabungkan`);
        
        for (const group of tokenGroups) {
            console.log(`\n🔗 Menggabungkan token: ${group.join(", ")}`);
            
            try {
                const isPaused = await pumpPalsContract.paused();
                if (isPaused) {
                    console.log("⏸️ Kontrak di-pause, tidak bisa menggabungkan");
                    return false;
                }
            } catch (error) {
                console.error(`⚠️ Gagal memeriksa status kontrak: ${error.message}`);
            }
            
            try {
                console.log("⏳ Mengirim transaksi combine...");
                await sendLegacyTransaction(
                    pumpPalsContract,
                    "combineCards",
                    [COLLECTION_BRONZE, group]
                );
                console.log("✅ Combine berhasil!");
            } catch (error) {
                console.error(`❌ Gagal menggabungkan kartu: ${error.reason || error.message}`);
            }
            
            console.log("⏳ Menunggu 15 detik sebelum transaksi berikutnya...");
            await new Promise(resolve => setTimeout(resolve, 15000));
        }
        
        return true;
    } catch (error) {
        console.error(`❌ Gagal menggabungkan kartu: ${error.reason || error.message}`);
        return false;
    }
}

function showMenu() {
    console.log("\n========================================");
    console.log("🚀 PUMP PALS AUTOMATION TOOL | BACTIAR291");
    console.log("========================================");
    console.log("1. 🛒 Beli Kartu Bronze (Marketplace)");
    console.log("2. 🎫 Buka Lootbox Bronze (0.005 ETH)");
    console.log("3. 🥈 Buka Lootbox Silver (0.085 ETH)");
    console.log("4. 🔄 Set Approval untuk PumpPals");
    console.log("5. 🔗 Combine Cards (WAJIB approval)");
    console.log("6. 🚀 Full Cycle (Beli/Buka + Approval + Combine)");
    console.log("7. ❌ Keluar");
    console.log("========================================");
}

async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    while (true) {
        showMenu();
        
        const choice = await new Promise(resolve => {
            rl.question("Pilih aksi (1-7): ", resolve);
        });

        switch (choice) {
            case '1': 
                const listingId = await new Promise(resolve => {
                    rl.question("Masukkan Listing ID (contoh: 6): ", resolve);
                });
                const price = await new Promise(resolve => {
                    rl.question("Masukkan harga (ETH, contoh: 0.01): ", resolve);
                });
                await buyCard(Number(listingId), ethers.parseEther(price));
                break;
                
            case '2': 
                await openLootbox(COLLECTION_BRONZE, BRONZE_PRICE, "BRONZE");
                break;
                
            case '3': 
                await openLootbox(COLLECTION_SILVER, SILVER_PRICE, "SILVER");
                break;
                
            case '4': 
                await ensureApproval();
                break;
                
            case '5': 
                await combineCards();
                break;
                
            case '6': 
                const fullChoice = await new Promise(resolve => {
                    rl.question("Pilih sumber kartu (1=Beli, 2=Buka): ", resolve);
                });
                
                if (fullChoice === '1') {
                    const listingId = await new Promise(resolve => {
                        rl.question("Masukkan Listing ID (contoh: 6): ", resolve);
                    });
                    const price = await new Promise(resolve => {
                        rl.question("Masukkan harga (ETH, contoh: 0.01): ", resolve);
                    });
                    await buyCard(Number(listingId), ethers.parseEther(price));
                } else {
                    await openLootbox(COLLECTION_BRONZE, BRONZE_PRICE, "BRONZE");
                }
                
                await new Promise(resolve => setTimeout(resolve, 10000));
                await combineCards();
                break;
                
            case '7': 
                console.log("👋 Sampai jumpa!");
                rl.close();
                return;
                
            default:
                console.log("⚠️ Pilihan tidak valid");
                break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

main().catch(error => {
    console.error("❌ Error utama:", error);
    process.exit(1);
});
