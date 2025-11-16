import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from "@solana/web3.js";
import type { PhantomProvider } from "../../types/phantom";

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

export function getProvider(): PhantomProvider | undefined {
  if ("solana" in window) {
    const provider = window.solana as PhantomProvider;
    if (provider.isPhantom) {
      return provider;
    }
  }
  return undefined;
}

export async function ensureConnected(): Promise<PublicKey> {
  const provider = getProvider();
  if (!provider) {
    throw new Error("Phantom wallet not found! Please install it from phantom.app");
  }

  try {
    const response = await provider.connect();
    return response.publicKey;
  } catch (error) {
    throw new Error("User rejected wallet connection");
  }
}

export async function sendSol(
  toAddress: string,
  amountSol: number
): Promise<{ signature: string; explorerUrl: string }> {
  const provider = getProvider();
  if (!provider || !provider.publicKey) {
    throw new Error("Wallet not connected");
  }

  try {
    const recipient = new PublicKey(toAddress);
 const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.publicKey,
        toPubkey: recipient,
        lamports,
      })
    );

    transaction.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;
    transaction.feePayer = provider.publicKey;

    const signedTransaction = await provider.signTransaction(transaction);

    const signature = await connection.sendRawTransaction(
      signedTransaction.serialize()
    );

    await connection.confirmTransaction(signature, "confirmed");

    const explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

    return { signature, explorerUrl };
  } catch (error: any) {
    console.error("Error sending SOL:", error);
    
    if (error.message?.includes("User rejected")) {
      throw new Error("Transaction cancelled by user");
    } else if (error.message?.includes("insufficient")) {
      throw new Error("Insufficient SOL balance in wallet");
    } else if (error.message?.includes("blockhash")) {
      throw new Error("Network congestion - please try again");
    } else {
      throw new Error(error.message || "Failed to send SOL");
    }
  }
}

export async function getBalance(address: string): Promise<number> {
  try {
    const publicKey = new PublicKey(address);
    const balance = await connection.getBalance(publicKey);
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error("Error getting balance:", error);
    return 0;
  }
}