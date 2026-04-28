export interface SyncState {
  tokenAddress: string;
  lastProcessedBlock: bigint;
  batchSyncedBlock: bigint | null;
  isSyncing: boolean;
}

export interface ISyncStateRepository {
  getOrCreate(tokenAddress: string): Promise<SyncState>;
  setSyncing(tokenAddress: string, isSyncing: boolean): Promise<void>;
  updateBatchSyncedBlock(tokenAddress: string, blockNumber: bigint): Promise<void>;
  updateLastProcessedBlock(tokenAddress: string, blockNumber: bigint): Promise<void>;
}
