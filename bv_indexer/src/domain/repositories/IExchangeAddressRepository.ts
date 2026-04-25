export interface IExchangeAddressRepository {
  isExchange(address: string): Promise<boolean>;
}
