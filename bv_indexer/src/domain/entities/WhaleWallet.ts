export class WhaleWallet {
  readonly address: string;
  readonly tokenAddress: string;
  readonly label: string | undefined;
  readonly createdAt: Date;
  private _isActive: boolean;

  private constructor(address: string, tokenAddress: string, label?: string) {
    this.address = address;
    this.tokenAddress = tokenAddress;
    this.label = label;
    this.createdAt = new Date();
    this._isActive = true;
  }

  static create(address: string, tokenAddress: string, label?: string): WhaleWallet {
    if (!WhaleWallet.isValidAddress(address)) {
      throw new Error('유효하지 않은 이더리움 주소입니다');
    }
    if (!WhaleWallet.isValidAddress(tokenAddress)) {
      throw new Error('유효하지 않은 토큰 컨트랙트 주소입니다');
    }
    return new WhaleWallet(address, tokenAddress, label);
  }

  get isActive(): boolean {
    return this._isActive;
  }

  deactivate(): void {
    this._isActive = false;
  }

  private static isValidAddress(address: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(address);
  }
}
