import 'dotenv/config';

// Network configuration from environment
const ALCHEMY_WSS = process.env.ALCHEMY_WSS;

if (!ALCHEMY_WSS) {
  console.error('❌ Missing ALCHEMY_WSS in environment');
  console.error('   Copy .env.example to .env and fill in your keys');
  process.exit(1);
}

export const WSS_URL = ALCHEMY_WSS;

// Contract addresses
export const CONTRACTS = {
  WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
} as const;

// ERC-20 Transfer event signature (keccak256 of "Transfer(address,address,uint256)")
export const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
