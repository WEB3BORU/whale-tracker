import { describe, it, expect } from 'vitest';
import { WhaleWallet } from '../../domain/entities/WhaleWallet.js';

const VALID_ADDRESS = '0xAbCd1234567890abcdef1234567890ABCDEF1234';
const VALID_TOKEN   = '0x17205fab260a7a6383a81452cE6315A39370Db97';

describe('WhaleWallet Entity', () => {
  describe('create()', () => {
    it('유효한 주소와 토큰 주소로 생성된다', () => {
      // given / when
      const wallet = WhaleWallet.create(VALID_ADDRESS, VALID_TOKEN);

      // then
      expect(wallet.address).toBe(VALID_ADDRESS);
      expect(wallet.tokenAddress).toBe(VALID_TOKEN);
      expect(wallet.isActive).toBe(true);
    });

    it('label을 함께 지정할 수 있다', () => {
      // given / when
      const wallet = WhaleWallet.create(VALID_ADDRESS, VALID_TOKEN, 'Binance Hot Wallet');

      // then
      expect(wallet.label).toBe('Binance Hot Wallet');
    });

    it('0x로 시작하지 않는 지갑 주소면 에러를 던진다', () => {
      // given
      const invalid = 'AbCd1234567890abcdef1234567890ABCDEF1234ab';

      // when / then
      expect(() => WhaleWallet.create(invalid, VALID_TOKEN)).toThrowError(
        '유효하지 않은 이더리움 주소입니다'
      );
    });

    it('42자가 아닌 지갑 주소면 에러를 던진다', () => {
      // given / when / then
      expect(() => WhaleWallet.create('0x1234', VALID_TOKEN)).toThrowError(
        '유효하지 않은 이더리움 주소입니다'
      );
    });

    it('유효하지 않은 토큰 주소면 에러를 던진다', () => {
      // given / when / then
      expect(() => WhaleWallet.create(VALID_ADDRESS, '0xinvalid')).toThrowError(
        '유효하지 않은 토큰 컨트랙트 주소입니다'
      );
    });
  });

  describe('deactivate()', () => {
    it('비활성화하면 isActive가 false가 된다', () => {
      // given
      const wallet = WhaleWallet.create(VALID_ADDRESS, VALID_TOKEN);

      // when
      wallet.deactivate();

      // then
      expect(wallet.isActive).toBe(false);
    });
  });
});
