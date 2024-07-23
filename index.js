import { ethers } from "ethers";
import "dotenv/config";
import { Wallet } from "ethers";
import {
    ERC20_ABI,
    UNISWAP_FACTOR_ABI,
    UNISWAP_QUOTER_ABI,
    UNISWAP_ROUTER_ABI,
    UNISWAP_V3_POOL_ABI,
} from "./abi.js";

// Uniswap Deployment Addresses
const POOL_FACTORY_CONTRACT_ADDRESS =
    "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const QUOTER_CONTRACT_ADDRESS = "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3";
const SWAP_ROUTER_CONTRACT_ADDRESS =
    "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";

const token0Address = "0xd46Ed33de33cA5E01Fe816Ca4dce4252EE95E67F"; // MUSDT
const token1Address = "0x0c9B1c83C41dA5368934E77FB316CdBB66163d90"; // MUSDC
const POOL_FEES = 0.01 * 10000; // 0.001% fee
// (0.05, 0.3, 1, 0.01) => (500, 3000, 10000, 100)

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new Wallet(process.env.PRIVATE_KEY, provider);

async function main(swapAmount) {
    const token0 = new ethers.Contract(token0Address, ERC20_ABI, signer);
    const token1 = new ethers.Contract(token1Address, ERC20_ABI, signer);

    const Token0 = {
        address: token0Address,
        symbol: await token0.symbol(),
        decimals: await token0.decimals(),
    };
    const Token1 = {
        address: token1Address,
        symbol: await token1.symbol(),
        decimals: await token1.decimals(),
    };

    const factoryContract = new ethers.Contract(
        POOL_FACTORY_CONTRACT_ADDRESS,
        UNISWAP_FACTOR_ABI,
        signer
    );
    const quoterContract = new ethers.Contract(
        QUOTER_CONTRACT_ADDRESS,
        UNISWAP_QUOTER_ABI,
        signer
    );

    const amountIn = ethers.parseUnits(
        swapAmount.toString(),
        await Token0.decimals
    );
    try {
        const { poolContract, token0, token1, fee } = await getPoolInfo(
            factoryContract,
            token0Address,
            token1Address
        );

        console.log(`-------------------------------`);
        console.log(`Fetching Quote for: ${Token0.symbol} to ${Token1.symbol}`);
        console.log(`-------------------------------`);
        console.log(`Swap Amount: ${ethers.formatEther(amountIn)}`);

        const quotedAmountOut = await quoteAndLogSwap(
            quoterContract,
            fee,
            signer,
            amountIn,
            Token0,
            Token1
        );
        const params = await prepareSwapParams(
            poolContract,
            signer,
            amountIn,
            quotedAmountOut[0].toString(),
            Token0,
            Token1
        );
        const swapRouter = new ethers.Contract(
            SWAP_ROUTER_CONTRACT_ADDRESS,
            UNISWAP_ROUTER_ABI,
            signer
        );
        await approveToken(token0Address, ERC20_ABI, amountIn, signer);
        await executeSwap(swapRouter, params, signer);
    } catch (error) {
        console.error("An error occurred:", error.message);
    }
}

async function approveToken(tokenAddress, tokenABI, amount, wallet) {
    try {
        const tokenContract = new ethers.Contract(
            tokenAddress,
            tokenABI,
            wallet
        );

        const approveTransaction =
            await tokenContract.approve.populateTransaction(
                SWAP_ROUTER_CONTRACT_ADDRESS,
                ethers.parseEther(amount.toString())
            );

        const transactionResponse = await wallet.sendTransaction(
            approveTransaction
        );
        console.log(`-------------------------------`);
        console.log(`Sending Approval Transaction...`);
        console.log(`-------------------------------`);
        console.log(`Transaction Sent: ${transactionResponse.hash}`);
        console.log(`-------------------------------`);
        const receipt = await transactionResponse.wait();
        console.log(
            `Approval Transaction Confirmed! https://sepolia.etherscan.io/tx/${receipt.hash}`
        );
    } catch (error) {
        console.error("An error occurred during token approval:", error);
        throw new Error("Token approval failed");
    }
}
async function getPoolInfo(factoryContract, tokenInAddress, tokenOutAddress) {
    const poolAddress = await factoryContract.getPool(
        tokenInAddress,
        tokenOutAddress,
        POOL_FEES
    );
    if (poolAddress === "0x0000000000000000000000000000000000000000") {
        throw new Error("Failed to get pool address");
    }
    const poolContract = new ethers.Contract(
        poolAddress,
        UNISWAP_V3_POOL_ABI,
        provider
    );
    const [token0, token1, fee] = await Promise.all([
        poolContract.token0(),
        poolContract.token1(),
        poolContract.fee(),
    ]);
    return { poolContract, token0, token1, fee };
}
async function quoteAndLogSwap(
    quoterContract,
    fee,
    signer,
    amountIn,
    Token0,
    Token1
) {
    const quotedAmountOut =
        await quoterContract.quoteExactInputSingle.staticCall({
            tokenIn: Token0.address,
            tokenOut: Token1.address,
            fee: fee,
            recipient: signer.address,
            deadline: Math.floor(new Date().getTime() / 1000 + 60 * 10),
            amountIn: amountIn,
            sqrtPriceLimitX96: 0,
        });
    console.log(`-------------------------------`);
    console.log(
        `Token Swap will result in: ${ethers.formatUnits(
            quotedAmountOut[0].toString(),
            Token1.decimals
        )} ${Token1.symbol} for ${ethers.formatEther(amountIn)} ${
            Token0.symbol
        }`
    );
    const amountOut = ethers.formatUnits(quotedAmountOut[0], Token1.decimals);
    return amountOut;
}
async function prepareSwapParams(
    poolContract,
    signer,
    amountIn,
    amountOut,
    Token0,
    Token1
) {
    return {
        tokenIn: Token0.address,
        tokenOut: Token1.address,
        fee: await poolContract.fee(),
        recipient: signer.address,
        amountIn: amountIn,
        amountOutMinimum: amountOut,
        sqrtPriceLimitX96: 0,
    };
}
async function executeSwap(swapRouter, params, signer) {
    const transaction = await swapRouter.exactInputSingle.populateTransaction(
        params
    );
    const receipt = await signer.sendTransaction(transaction);
    console.log(`-------------------------------`);
    console.log(`Receipt: https://sepolia.etherscan.io/tx/${receipt.hash}`);
    console.log(`-------------------------------`);
}

main(100);
