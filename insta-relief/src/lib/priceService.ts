interface ConversionResult {
  usdAmount: number;
  solAmount: number;
  exchangeRate: number;
  timestamp: string;
}

let priceCache: number | null = null;
let cacheTime = 0;

export async function fetchSOLPrice(): Promise<number> {
  // Use cached price if less than 1 minute old
  if (priceCache !== null && Date.now() - cacheTime < 60000) {
    return priceCache;
  }

  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
    );
    const data = await res.json();
    priceCache = data.solana.usd;
    cacheTime = Date.now();
    return data.solana.usd;
  } catch (error) {
    return priceCache !== null ? priceCache : 150;
  }
}

export async function convertUSDtoSOL(
  usdAmount: number,
  bufferPercent: number = 2
): Promise<ConversionResult> {
  const price = await fetchSOLPrice();
  const baseSOL = usdAmount / price;
  // Add buffer for price volatility
  const withBuffer = baseSOL * (1 + bufferPercent / 100);

  return {
    usdAmount,
    solAmount: withBuffer,
    exchangeRate: price,
    timestamp: new Date().toISOString(),
  };
}