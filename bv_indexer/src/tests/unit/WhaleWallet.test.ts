import { describe, it, expect } from 'vitest';
import { WhaleWallet } from '../../domain/entities/WhaleWallet.js';

describe('WhaleWallet Entity', () => {
  describe('create()', () => {
    it('유효한 이더리움 주소로 생성된다', () => {
      // given
      const address = '0xAbCd1234567890abcdef1234567890ABCDEF1234';

      // when
      const wallet = WhaleWallet.create(address);

      // then
      expect(wallet.address).toBe(address);
      expect(wallet.isActive).toBe(true);
    });

    it('label을 함께 지정할 수 있다', () => {
      // given
      const address = '0xAbCd1234567890abcdef1234567890ABCDEF1234';
      const label = 'Binance Hot Wallet';

      // when
      const wallet = WhaleWallet.create(address, label);

      // then
      expect(wallet.label).toBe(label);
    });

    it('0x로 시작하지 않는 주소면 에러를 던진다', () => {
      // given
      const invalidAddress = 'AbCd1234567890abcdef1234567890ABCDEF1234ab';

      // when / then
      expect(() => WhaleWallet.create(invalidAddress)).toThrowError(
        '유효하지 않은 이더리움 주소입니다'
      );
    });

    it('42자가 아닌 주소면 에러를 던진다', () => {
      // given
      const shortAddress = '0x1234';

      // when / then
      expect(() => WhaleWallet.create(shortAddress)).toThrowError(
        '유효하지 않은 이더리움 주소입니다'
      );
    });
  });

  describe('deactivate()', () => {
    it('비활성화하면 isActive가 false가 된다', () => {
      // given
      const wallet = WhaleWallet.create('0xAbCd1234567890abcdef1234567890ABCDEF1234');

      // when
      wallet.deactivate();

      // then
      expect(wallet.isActive).toBe(false);
    });
  });
});
