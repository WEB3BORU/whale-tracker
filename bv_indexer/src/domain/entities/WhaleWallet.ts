export class WhaleWallet {
  readonly address: string;
  readonly label: string | undefined;
  readonly createdAt: Date;
  private _isActive: boolean;

  private constructor(address: string, label?: string) {
    this.address = address;
    this.label = label;
    this.createdAt = new Date();
    this._isActive = true;
  }

  static create(address: string, label?: string): WhaleWallet {
    if (!WhaleWallet.isValidAddress(address)) {
      throw new Error('유효하지 않은 이더리움 주소입니다');
    }
    return new WhaleWallet(address, label);
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
