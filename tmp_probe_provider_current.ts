import { getAckiWalletActivity } from "./src/services/ackiProvider";

const input = process.argv[2] || "ackerman";

const wallet = await getAckiWalletActivity(input);

console.log(JSON.stringify({
  input: wallet.input,
  inputType: wallet.inputType,
  name: wallet.name,
  address: wallet.address,
  lastPaid: wallet.lastPaid,
  miningStats: wallet.miningStats,
  popitGame: wallet.popitGame ? {
    address: wallet.popitGame.address,
    accountId: wallet.popitGame.accountId,
    dappId: wallet.popitGame.dappId,
    lastPaid: wallet.popitGame.lastPaid,
    lastTransactionLt: wallet.popitGame.lastTransactionLt,
    currentTaps: wallet.popitGame.currentTaps,
    tapHistory: wallet.popitGame.tapHistory,
    lockedNackl: wallet.popitGame.lockedNackl,
    lockedUpdatedAt: wallet.popitGame.lockedUpdatedAt,
    lockedTokens: wallet.popitGame.lockedTokens,
    decodedState: wallet.popitGame.decodedState
  } : null
}, null, 2));
