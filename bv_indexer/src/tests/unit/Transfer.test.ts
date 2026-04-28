import { describe, it, expect } from 'vitest';
import { Transfer, ToType } from '../../domain/entities/Transfer.js';

const validProps = {
  txHash:       '0xabcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
  logIndex:     0,
  tokenAddress: '0x17205fab260a7a6383a81452cE6315A39370Db97',
  from:         '0xAbCd1234567890abcdef1234567890ABCDEF1234',
  to:           '0x1234567890abcdef1234567890ABCDEF12345678',
  value:        1000000n,
  blockNumber:  19000000n,
  blockTimestamp: new Date('2024-01-01T00:00:00Z'),
  toType:       'unknown' as ToType,
};

describe('Transfer Entity', () => {
  describe('create()', () => {
    it('유효한 데이터로 생성된다', () => {
      // given / when
      const transfer = Transfer.create(validProps);

      // then
      expect(transfer.txHash).toBe(validProps.txHash);
      expect(transfer.tokenAddress).toBe(validProps.tokenAddress);
      expect(transfer.from).toBe(validProps.from);
      expect(transfer.value).toBe(1000000n);
    });

    it('유효하지 않은 txHash면 에러를 던진다', () => {
      // given
      const props = { ...validProps, txHash: '0xinvalid' };

      // when / then
      expect(() => Transfer.create(props)).toThrowError('유효하지 않은 트랜잭션 해시입니다');
    });

    it('value가 0이면 에러를 던진다', () => {
      // given
      const props = { ...validProps, value: 0n };

      // when / then
      expect(() => Transfer.create(props)).toThrowError('전송량은 0보다 커야 합니다');
    });
  });

  describe('isAlertTarget', () => {
    it('toType이 exchange면 알림 대상이다', () => {
      // given / when
      const transfer = Transfer.create({ ...validProps, toType: 'exchange' });

      // then
      expect(transfer.isAlertTarget).toBe(true);
    });

    it('toType이 unknown이면 알림 대상이 아니다', () => {
      // given / when
      const transfer = Transfer.create({ ...validProps, toType: 'unknown' });

      // then
      expect(transfer.isAlertTarget).toBe(false);
    });
  });

  describe('uniqueId', () => {
    it('uniqueId는 txHash-logIndex 형태다', () => {
      // given / when
      const transfer = Transfer.create({ ...validProps, logIndex: 3 });

      // then
      expect(transfer.uniqueId).toBe(`${validProps.txHash}-3`);
    });
  });
});
