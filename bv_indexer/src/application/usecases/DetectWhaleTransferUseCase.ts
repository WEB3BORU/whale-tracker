import { Transfer, ToType } from '../../domain/entities/Transfer.js';
import { IWhaleWalletRepository } from '../../domain/repositories/IWhaleWalletRepository.js';
import { IExchangeAddressRepository } from '../../domain/repositories/IExchangeAddressRepository.js';

export interface DetectionResult {
  isWhale: boolean;
  isAlert: boolean;
  toType: ToType;
}

export class DetectWhaleTransferUseCase {
  constructor(
    private readonly whaleWalletRepo: IWhaleWalletRepository,
    private readonly exchangeAddressRepo: IExchangeAddressRepository,
  ) {}

  async execute(transfer: Transfer): Promise<DetectionResult> {
    const whaleWallet = await this.whaleWalletRepo.findByAddress(transfer.from);
    if (!whaleWallet) {
      return { isWhale: false, isAlert: false, toType: 'unknown' };
    }

    const isExchange = await this.exchangeAddressRepo.isExchange(transfer.to);
    const toType: ToType = isExchange ? 'exchange' : 'unknown';

    return {
      isWhale: true,
      isAlert: isExchange,
      toType,
    };
  }
}
