// Code written in javascript

// User input values
const clientSeed = '';
const serverSeed = '';
const nonce = 0;

// Suits: D -> Diamonds, H -> Hearts, S -> Spades, C -> Clubs

// Index of 0 to 51: 2D to AC
const CARDS = [
  '2D', '2H', '2S', '2C', '3D', '3H', '3S', '3C', '4D', '4H',
  '4S', '4C', '5D', '5H', '5S', '5C', '6D', '6H', '6S', '6C',
  '7D', '7H', '7S', '7C', '8D', '8H', '8S', '8C', '9D', '9H',
  '9S', '9C', '10D', '10H', '10S', '10C', 'JD', 'JH', 'JS',
  'JC', 'QD', 'QH', 'QS', 'QC', 'KD', 'KH', 'KS', 'KC', 'AD',
  'AH', 'AS', 'AC',
];

// Converts a hex string (e.g. "deadbeef") into a Uint8Array of bytes
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Converts a Uint8Array of bytes back into a hex string (e.g. [222, 173, 190, 239] → "deadbeef")
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Computes a HMAC-SHA256 using the Web Crypto API
// keyHex: hex-encoded key (e.g. server seed)
// message: Uint8Array to be signed
async function generateHMAC_SHA256(keyHex, message) {
  const keyBytes = hexToBytes(keyHex);

  // Import raw key for HMAC use
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  // Generate HMAC signature
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);
  return bytesToHex(new Uint8Array(signature)); // Return signature as hex
}

// Generates a single card from a SHA-256 hash (hex string)
// Uses rejection sampling to ensure fair distribution across 52 possible cards
function generateInfiniteDeckCard(hashHex) {
  const hashBytes = hexToBytes(hashHex);

  for (let i = 0; i <= hashBytes.length - 4; i += 4) {
    const view = new DataView(
      hashBytes.buffer,
      hashBytes.byteOffset + i,
      4,
    );
    const value = view.getUint32(0); // Read 4 bytes as big-endian unsigned integer
    const max = 52 * Math.floor(0x100000000 / 52); // Bias-free range
    if (value < max) {
      const index = value % 52; // Fair card index
      return CARDS[index];
    }
  }

  throw new Error('Failed to generate unbiased card value from hash');
}

// Combines all steps to return a Blackjack card result
// Inputs: serverSeed, clientSeed, nonce, cursor
async function getCard(serverSeed, clientSeed, nonce, cursor) {
  // Prepare input message for HMAC: public seed + nonce + cursor
  const message = new TextEncoder().encode(
    `${clientSeed}:${nonce}:${cursor}`
  );

  // Compute HMAC hash
  const hash = await generateHMAC_SHA256(serverSeed, message);

  // Generate and return card using the hash
  const card = generateInfiniteDeckCard(hash);
  return card;
}

async function validateBlackjackResult(serverSeed, clientSeed, nonce) {
  const cards = [];

  for (let cursor = 0; cursor < 50; cursor++) {
    cards.push(await getCard(serverSeed, clientSeed, nonce, cursor));
  }

  return cards;
}

// Run the validateBlackjackResult function if input values are provided
if (serverSeed && serverSeed.trim() !== '' && clientSeed && clientSeed.trim() !== '' && nonce >= 0) {
  validateBlackjackResult(serverSeed, clientSeed, nonce).then(result => {
    console.log("Suits: D -> Diamonds, H -> Hearts, S -> Spades, C -> Clubs");
    console.log("Next 50 cards in the deck:", result);
  });
} else {
  console.log("Please provide valid serverSeed, clientSeed, and nonce (>=0) before running.");
}
