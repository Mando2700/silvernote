import { describe, expect, it } from 'vitest';

import { parseForm4 } from '@/lib/finance/form4';

const XML = `<?xml version="1.0"?>
<ownershipDocument>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer><officerTitle>Chief Financial Officer</officerTitle></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-09-01</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>1,000</value></transactionShares><transactionPricePerShare><value>50.25</value></transactionPricePerShare></transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>12000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-09-02</value></transactionDate>
      <transactionCoding><transactionCode>F</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>300</value></transactionShares><transactionPricePerShare><value>0</value></transactionPricePerShare></transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;

describe('parseForm4', () => {
  it('reads owner, role and each transaction', () => {
    const rows = parseForm4(XML, { accession: 'a', filedAt: '2026-09-03' });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ owner: 'Doe Jane', role: 'Chief Financial Officer', kind: 'buy', shares: 1000, price: 50.25, value: 50250, ownedAfter: 12000 });
    expect(rows[1]).toMatchObject({ kind: 'other', code: 'F', price: null });
  });
});
